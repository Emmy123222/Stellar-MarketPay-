"use strict";

const cache = require("./cacheService");
const metrics = require("../metrics");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger('xlmPriceService');

const PRICE_HISTORY_CACHE_KEY = "xlm:usd:history:7d";
const PRICE_HISTORY_TTL_SECONDS = 5 * 60;
const PRICE_CACHE_KEY = "xlm:price:usd";
const PRICE_TTL_SECONDS = 60;
const LAST_SUCCESSFUL_PRICE_TTL_MS = 10 * 60 * 1000;

/**
 * Minimum remaining TTL (seconds) below which a background refresh is
 * triggered. Entries with more TTL remaining are served as-is with no
 * background call, preventing CoinGecko request stampedes under load.
 */
const REFRESH_THRESHOLD_SECONDS = 15;

/**
 * In-process guard so only ONE background refresh runs at a time.
 * Concurrent requests that all see a near-expiry entry will each check this
 * flag; only the first one fires the CoinGecko call.
 */
let _refreshInFlight = false;
let _lastSuccessfulPrice = null;

function setLastSuccessfulPrice(priceData) {
  if (!priceData || !Number.isFinite(priceData.priceUsd) || priceData.priceUsd <= 0) {
    return;
  }
  _lastSuccessfulPrice = {
    ...priceData,
    fetchedAt: Date.now(),
  };
}

function getLastSuccessfulPrice() {
  if (!_lastSuccessfulPrice) return null;
  const ageMs = Date.now() - (_lastSuccessfulPrice.fetchedAt || 0);
  if (ageMs > LAST_SUCCESSFUL_PRICE_TTL_MS) {
    _lastSuccessfulPrice = null;
    return null;
  }
  return { ..._lastSuccessfulPrice };
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

  const raw = await fetchMarketChart7d();
  const normalized = normalizeMarketChartPayload(raw);
  await cache.set(PRICE_HISTORY_CACHE_KEY, normalized, PRICE_HISTORY_TTL_SECONDS);
  return { ...normalized, cached: false };
}

/**
 * Read the remaining TTL (in seconds) of the price cache key directly from
 * Redis. Returns 0 when the Redis client is unavailable or the key is missing.
 *
 * @returns {Promise<number>}
 */
async function _getPriceTtl() {
  try {
    const redis = cache.getClient();
    if (!redis) return 0;
    const ttl = await redis.ttl(PRICE_CACHE_KEY);
    return ttl > 0 ? ttl : 0;
  } catch {
    return 0;
  }
}

/**
 * Get current XLM price in USD with Redis caching and stale-while-revalidate.
 *
 * Strategy:
 *  - Cache HIT with TTL > REFRESH_THRESHOLD_SECONDS → return cached, no background call.
 *  - Cache HIT with TTL ≤ REFRESH_THRESHOLD_SECONDS → return cached AND trigger exactly
 *    one background refresh (coalesced by `_refreshInFlight`).
 *  - Cache MISS → fetch synchronously, populate cache, update gauge.
 *
 * @returns {Promise<{priceUsd: number, cached: boolean, updatedAt: string}>}
 */
async function fetchCoinGeckoPrice() {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd");
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status}`);
  }

  const payload = await res.json();
  const priceUsd = Number(payload?.stellar?.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("CoinGecko price payload missing or invalid");
  }

  return {
    priceUsd,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchCoinbasePrice() {
  const res = await fetch("https://api.coinbase.com/v2/prices/XLM-USD/spot");
  if (!res.ok) {
    throw new Error(`Coinbase request failed: ${res.status}`);
  }

  const payload = await res.json();
  const priceUsd = Number(payload?.data?.amount);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("Coinbase price payload missing or invalid");
  }

  return {
    priceUsd,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchCurrentPriceWithFallback() {
  try {
    const priceData = await fetchCoinGeckoPrice();
    setLastSuccessfulPrice(priceData);
    return priceData;
  } catch (coinGeckoError) {
    metrics.xlmPriceFetchErrorsTotal.inc();
    logger.warn({ error: coinGeckoError.message }, 'CoinGecko XLM price fetch failed, trying Coinbase');

    try {
      const priceData = await fetchCoinbasePrice();
      setLastSuccessfulPrice(priceData);
      return priceData;
    } catch (coinbaseError) {
      metrics.xlmPriceFetchErrorsTotal.inc();
      logger.warn({ error: coinbaseError.message }, 'Coinbase XLM price fallback failed');
      throw coinbaseError;
    }
  }
}

async function getCurrentXlmPrice() {
  const cached = await cache.get(PRICE_CACHE_KEY);

  if (cached) {
    // Only start a background refresh when the entry is near expiry AND no
    // refresh is already running in this process.
    const ttl = await _getPriceTtl();
    if (ttl <= REFRESH_THRESHOLD_SECONDS && !_refreshInFlight) {
      logger.debug({ ttl }, 'XLM price cache near expiry — scheduling background refresh');
      refreshPriceInBackground().catch((err) => {
        logger.warn({ error: err.message }, 'Background price refresh failed');
      });
    }
    return { ...cached, cached: true };
  }

  // Cache miss — fetch fresh and populate cache.
  logger.info('Cache miss for XLM price, fetching from CoinGecko');
  try {
    const priceData = await fetchCurrentPriceWithFallback();
    await cache.set(PRICE_CACHE_KEY, priceData, PRICE_TTL_SECONDS);

    // Update Prometheus gauge on every successful fetch.
    if (typeof priceData.priceUsd === 'number') {
      metrics.xlmPriceUsd.set(priceData.priceUsd);
    }

    return { ...priceData, cached: false };
  } catch (err) {
    const stalePrice = getLastSuccessfulPrice();
    if (stalePrice) {
      logger.warn({ priceUsd: stalePrice.priceUsd }, 'Serving stale in-memory XLM price because both providers failed');
      return { ...stalePrice, cached: true };
    }
    throw err;
  }
}

/**
 * Background refresh of price data (fire-and-forget, coalesced).
 *
 * Sets `_refreshInFlight` while running so concurrent requests skip duplicate
 * calls. Clears the flag in a `finally` block so a failure does not
 * permanently block future refreshes.
 */
async function refreshPriceInBackground() {
  if (_refreshInFlight) return;
  _refreshInFlight = true;
  try {
    const priceData = await fetchCurrentPriceWithFallback();
    await cache.set(PRICE_CACHE_KEY, priceData, PRICE_TTL_SECONDS);

    // Update Prometheus gauge on every successful fetch.
    if (typeof priceData.priceUsd === 'number') {
      metrics.xlmPriceUsd.set(priceData.priceUsd);
    }

    logger.debug({ priceUsd: priceData.priceUsd }, 'Background price refresh completed');
  } catch (err) {
    logger.warn({ error: err.message }, 'Background price refresh failed');
    throw err;
  } finally {
    _refreshInFlight = false;
  }
}

module.exports = {
  getXlmUsd7dHistory,
  getCurrentXlmPrice,
  PRICE_HISTORY_TTL_SECONDS,
  PRICE_TTL_SECONDS,
  LAST_SUCCESSFUL_PRICE_TTL_MS,
  REFRESH_THRESHOLD_SECONDS,
  // Exported for testing only
  _resetRefreshInFlight: () => { _refreshInFlight = false; },
  _setLastSuccessfulPrice: (priceData) => { setLastSuccessfulPrice(priceData); },
  _resetLastSuccessfulPrice: () => { _lastSuccessfulPrice = null; },
};
