"use strict";

const cache = require("./cacheService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger('xlmPriceService');

const PRICE_HISTORY_CACHE_KEY = "xlm:usd:history:7d";
const PRICE_HISTORY_TTL_SECONDS = 5 * 60;
const PRICE_CACHE_KEY = "xlm:price:usd";
const PRICE_TTL_SECONDS = 60;

// Minimum interval between background CoinGecko refreshes. Cache hits return
// immediately; the async refresh is throttled so N concurrent requests share
// one outbound call instead of stampeding CoinGecko.
const BACKGROUND_REFRESH_MIN_INTERVAL_MS = 50 * 1000;

let priceRefreshInflight = null;
let lastBackgroundKickAt = 0;
let historyFetchInflight = null;

function updatePriceGauge(priceUsd) {
  if (!Number.isFinite(priceUsd)) return;
  try {
    // Lazy require: metrics.js owns the shared registry and intentionally has
    // no internal deps, so this cannot create an import cycle.
    const { setXlmPriceUsd } = require("../metrics");
    setXlmPriceUsd(priceUsd);
  } catch {
    // Swallow — observability must never break the price path
  }
}

async function fetchMarketChart7d() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/stellar/market_chart?vs_currency=usd&days=7"
  );
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status}`);
  }
  return res.json();
}

function normalizeMarketChartPayload(payload) {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const points = prices
    .filter((entry) => Array.isArray(entry) && entry.length >= 2)
    .map(([timestamp, value]) => ({
      timestamp: Number(timestamp),
      priceUsd: Number(value),
    }))
    .filter((entry) => Number.isFinite(entry.timestamp) && Number.isFinite(entry.priceUsd));

  if (!points.length) {
    return {
      points: [],
      currentPriceUsd: null,
      change24hPercent: null,
    };
  }

  const latest = points[points.length - 1];
  const targetTs = latest.timestamp - 24 * 60 * 60 * 1000;
  let closest = points[0];
  let bestDelta = Math.abs(points[0].timestamp - targetTs);
  for (const point of points) {
    const delta = Math.abs(point.timestamp - targetTs);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = point;
    }
  }
  const change24hPercent =
    closest.priceUsd > 0
      ? ((latest.priceUsd - closest.priceUsd) / closest.priceUsd) * 100
      : null;

  return {
    points,
    currentPriceUsd: latest.priceUsd,
    change24hPercent,
    updatedAt: new Date(latest.timestamp).toISOString(),
  };
}

async function getXlmUsd7dHistory() {
  const cached = await cache.get(PRICE_HISTORY_CACHE_KEY);
  if (cached) return { ...cached, cached: true };

  // Singleflight concurrent cache misses so a burst shares one CoinGecko call.
  if (!historyFetchInflight) {
    historyFetchInflight = (async () => {
      const raw = await fetchMarketChart7d();
      const normalized = normalizeMarketChartPayload(raw);
      updatePriceGauge(normalized.currentPriceUsd);
      await cache.set(PRICE_HISTORY_CACHE_KEY, normalized, PRICE_HISTORY_TTL_SECONDS);
      return normalized;
    })().finally(() => {
      historyFetchInflight = null;
    });
  }

  const normalized = await historyFetchInflight;
  return { ...normalized, cached: false };
}

/**
 * Get current XLM price in USD with Redis caching and stale-while-revalidate.
 * Returns cached value immediately while background refresh runs if cache is stale.
 *
 * @returns {Promise<{priceUsd: number, cached: boolean, updatedAt: string}>}
 */
async function getCurrentXlmPrice() {
  const cached = await cache.get(PRICE_CACHE_KEY);
  if (cached) {
    // Return cached value immediately (stale-while-revalidate pattern).
    // Throttle the async kick so concurrent requests share one refresh.
    kickBackgroundRefresh();
    return { ...cached, cached: true };
  }

  // Cache miss - fetch fresh
  logger.info('Cache miss for XLM price, fetching from CoinGecko');
  const raw = await fetchMarketChart7d();
  const normalized = normalizeMarketChartPayload(raw);
  const priceData = {
    priceUsd: normalized.currentPriceUsd,
    updatedAt: normalized.updatedAt,
  };
  updatePriceGauge(priceData.priceUsd);
  await cache.set(PRICE_CACHE_KEY, priceData, PRICE_TTL_SECONDS);
  return { ...priceData, cached: false };
}

/**
 * Kick a throttled, singleflight background refresh (fire-and-forget).
 * All cache-hit requests are served from Redis; at most one outbound
 * CoinGecko call is in flight and kicks are spaced by
 * BACKGROUND_REFRESH_MIN_INTERVAL_MS.
 */
function kickBackgroundRefresh() {
  const now = Date.now();
  if (priceRefreshInflight) return;
  if (now - lastBackgroundKickAt < BACKGROUND_REFRESH_MIN_INTERVAL_MS) return;
  lastBackgroundKickAt = now;
  priceRefreshInflight = refreshPriceInBackground().finally(() => {
    priceRefreshInflight = null;
  });
  priceRefreshInflight.catch((err) => {
    logger.warn({ error: err.message }, 'Background price refresh failed');
  });
}

/**
 * Background refresh of price data (fire-and-forget).
 * Used for stale-while-revalidate pattern. Updates the Prometheus
 * `xlm_price_usd` gauge on each successful fetch.
 */
async function refreshPriceInBackground() {
  try {
    const raw = await fetchMarketChart7d();
    const normalized = normalizeMarketChartPayload(raw);
    const priceData = {
      priceUsd: normalized.currentPriceUsd,
      updatedAt: normalized.updatedAt,
    };
    updatePriceGauge(priceData.priceUsd);
    await cache.set(PRICE_CACHE_KEY, priceData, PRICE_TTL_SECONDS);
    logger.debug('Background price refresh completed');
  } catch (err) {
    logger.warn({ error: err.message }, 'Background price refresh failed');
  }
}

function __resetXlmPriceTestState() {
  priceRefreshInflight = null;
  lastBackgroundKickAt = 0;
  historyFetchInflight = null;
}

module.exports = {
  getXlmUsd7dHistory,
  getCurrentXlmPrice,
  // Alias kept for the issue wording (`xlmPriceService.getPrice()`).
  getPrice: getCurrentXlmPrice,
  PRICE_HISTORY_TTL_SECONDS,
  PRICE_TTL_SECONDS,
  BACKGROUND_REFRESH_MIN_INTERVAL_MS,
  __resetXlmPriceTestState,
};
