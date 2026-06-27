"use strict";

const cache = require("./cacheService");

const PRICE_HISTORY_CACHE_KEY = "xlm:usd:history:7d";
const PRICE_HISTORY_TTL_SECONDS = 5 * 60;

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

module.exports = {
  getXlmUsd7dHistory,
  PRICE_HISTORY_TTL_SECONDS,
};
