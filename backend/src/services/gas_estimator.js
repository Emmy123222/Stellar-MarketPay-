/**
 * src/services/gas_estimator.js
 * Dynamic Gas Price Estimator for Soroban (Issue: Dynamic Gas Price Estimator for Soroban)
 *
 * Fetches real Soroban fee stats from the Stellar Horizon/RPC APIs,
 * computes percentile-based fee tiers (Slow / Medium / Fast),
 * and caches results to avoid hammering the network on every request.
 */
"use strict";

const cache = require("./cacheService");

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = "soroban:fee:estimate";
const CACHE_TTL = 30; // seconds — refresh frequently for real-time accuracy

const STROOPS_PER_XLM = 10_000_000n;

// How many ledgers of fee history to request from Horizon fee_stats endpoint
const FEE_STATS_ENDPOINT = "/fee_stats";

// Percentile thresholds for each tier
const PERCENTILES = {
  slow: 20,    // 20th percentile — economical, might wait longer
  medium: 50,  // 50th percentile — typical confirmation speed
  fast: 90,    // 90th percentile — fast inclusion
};

// Spike detection: if fast tier is > SPIKE_MULTIPLIER × slow tier, flag a spike
const SPIKE_MULTIPLIER = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHorizonUrl() {
  const network = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
  if (process.env.HORIZON_URL) return process.env.HORIZON_URL.replace(/\/$/, "");
  return network === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

/**
 * Convert a stroops integer (number or string) to a human-readable XLM string.
 * @param {number|string|bigint} stroops
 * @returns {string}
 */
function stroopsToXlm(stroops) {
  const s = BigInt(Math.round(Number(stroops)));
  const integer = s / STROOPS_PER_XLM;
  const fraction = s % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${integer}.${fractionStr}` : integer.toString();
}

/**
 * Pick a value at a given percentile from an already-sorted numeric array.
 * @param {number[]} sorted  Ascending sorted array of numbers.
 * @param {number}   pct     Percentile (0–100).
 * @returns {number}
 */
function percentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Parse the Horizon /fee_stats response into a flat array of inclusive fee numbers
 * suitable for percentile computation.
 *
 * Horizon returns charge_rate_histogram which has buckets with min/max/count.
 * We synthesise individual data points from buckets for percentile accuracy.
 *
 * @param {Object} feeStats  Raw Horizon fee_stats JSON response.
 * @returns {number[]}       Sorted array of fee-per-operation values in stroops.
 */
function extractFeeDataPoints(feeStats) {
  const points = [];

  // fee_charged histogram gives real network data
  const histogram = feeStats?.fee_charged?.histogram;
  if (Array.isArray(histogram) && histogram.length > 0) {
    for (const bucket of histogram) {
      const min = parseInt(bucket.min, 10);
      const max = parseInt(bucket.max, 10);
      const count = parseInt(bucket.count, 10);
      if (!Number.isFinite(min) || !Number.isFinite(count) || count <= 0) continue;
      const mid = Number.isFinite(max) ? Math.round((min + max) / 2) : min;
      for (let i = 0; i < Math.min(count, 20); i++) {
        points.push(mid);
      }
    }
  }

  // Fallback: use the p-values Horizon already computed when histogram is absent
  if (!points.length) {
    const p = feeStats?.fee_charged;
    if (p) {
      const candidates = [p.p10, p.p20, p.p30, p.p40, p.p50, p.p60, p.p70, p.p80, p.p90, p.p99, p.max];
      for (const v of candidates) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) points.push(n);
      }
    }
  }

  return points.sort((a, b) => a - b);
}

/**
 * Build a single fee tier object.
 * @param {string}   label        "slow" | "medium" | "fast"
 * @param {number}   stroops      Fee in stroops.
 * @param {number|null} xlmUsd   Current XLM/USD price (optional).
 * @returns {FeeTier}
 */
function buildTier(label, stroops, xlmUsd) {
  const xlm = stroopsToXlm(stroops);
  return {
    label,
    stroops,
    xlm,
    usd: typeof xlmUsd === "number" && xlmUsd > 0 ? Number(xlm) * xlmUsd : null,
  };
}

// ─── Core estimator ───────────────────────────────────────────────────────────

/**
 * Fetch raw fee stats from Stellar Horizon.
 * @returns {Promise<Object>}
 */
async function fetchFeeStats() {
  const url = `${getHorizonUrl()}${FEE_STATS_ENDPOINT}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`Horizon fee_stats request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Compute fee tiers from a raw Horizon fee_stats object.
 * @param {Object}      feeStats  Raw Horizon response.
 * @param {number|null} xlmUsd    Current XLM/USD price for USD equivalents.
 * @returns {FeeEstimateResult}
 */
function computeTiers(feeStats, xlmUsd = null) {
  const dataPoints = extractFeeDataPoints(feeStats);

  // Base fees from Horizon's pre-computed percentiles (most reliable)
  const feeCharged = feeStats?.fee_charged || {};
  const baseMin   = parseInt(feeCharged.min   || "100", 10) || 100;
  const baseP50   = parseInt(feeCharged.p50   || "200", 10) || 200;
  const baseP90   = parseInt(feeCharged.p90   || "400", 10) || 400;

  let slowStroops, mediumStroops, fastStroops;

  if (dataPoints.length >= 5) {
    // Use our own percentile computation over histogram data
    slowStroops   = Math.max(baseMin, percentile(dataPoints, PERCENTILES.slow));
    mediumStroops = Math.max(slowStroops, percentile(dataPoints, PERCENTILES.medium));
    fastStroops   = Math.max(mediumStroops, percentile(dataPoints, PERCENTILES.fast));
  } else {
    // Fall back to Horizon's reported percentiles
    slowStroops   = baseMin;
    mediumStroops = baseP50;
    fastStroops   = baseP90;
  }

  // Enforce minimum base fee of 100 stroops (Stellar protocol minimum)
  slowStroops   = Math.max(slowStroops, 100);
  mediumStroops = Math.max(mediumStroops, slowStroops);
  fastStroops   = Math.max(fastStroops, mediumStroops);

  // Spike detection: flag when fast is 3× or more above slow
  const spikeDetected = fastStroops >= slowStroops * SPIKE_MULTIPLIER;

  // Predictive surge: apply a 20% buffer on fast tier during spikes
  if (spikeDetected) {
    fastStroops = Math.round(fastStroops * 1.2);
  }

  const networkCongestion = spikeDetected
    ? "high"
    : fastStroops >= slowStroops * 1.5
      ? "medium"
      : "low";

  return {
    slow:   buildTier("slow",   slowStroops,   xlmUsd),
    medium: buildTier("medium", mediumStroops, xlmUsd),
    fast:   buildTier("fast",   fastStroops,   xlmUsd),
    spikeDetected,
    networkCongestion,
    ledger: feeStats?.last_ledger || null,
    ledgerBaseFeeStroops: parseInt(feeStats?.ledger_base_fee || "100", 10),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @typedef {Object} FeeTier
 * @property {"slow"|"medium"|"fast"} label
 * @property {number}      stroops  Fee in stroops.
 * @property {string}      xlm      Human-readable XLM amount.
 * @property {number|null} usd      USD equivalent, or null if price unavailable.
 */

/**
 * @typedef {Object} FeeEstimateResult
 * @property {FeeTier}  slow
 * @property {FeeTier}  medium
 * @property {FeeTier}  fast
 * @property {boolean}  spikeDetected       True when the network is experiencing a fee spike.
 * @property {"low"|"medium"|"high"} networkCongestion
 * @property {string|null} ledger           Last processed ledger sequence number.
 * @property {number}   ledgerBaseFeeStroops Minimum base fee from ledger header.
 * @property {string}   updatedAt           ISO timestamp of when this estimate was computed.
 * @property {boolean}  [cached]            True when served from cache.
 */

/**
 * Retrieve the current Soroban fee estimate, using Redis cache when available.
 *
 * @param {Object}      [opts]
 * @param {boolean}     [opts.forceRefresh=false]  Bypass cache.
 * @param {number|null} [opts.xlmUsd=null]         Current XLM price in USD.
 * @returns {Promise<FeeEstimateResult>}
 */
async function getGasEstimate({ forceRefresh = false, xlmUsd = null } = {}) {
  if (!forceRefresh) {
    const cached = await cache.get(CACHE_KEY);
    if (cached) return { ...cached, cached: true };
  }

  const feeStats = await fetchFeeStats();
  const result = computeTiers(feeStats, xlmUsd);

  await cache.set(CACHE_KEY, result, CACHE_TTL);
  return { ...result, cached: false };
}

/**
 * Thin wrapper that wraps getGasEstimate with error resilience.
 * Returns a fallback estimate using protocol-minimum fees when the network call fails.
 *
 * @param {Object} [opts]
 * @returns {Promise<FeeEstimateResult>}
 */
async function getSafeGasEstimate(opts = {}) {
  try {
    return await getGasEstimate(opts);
  } catch (err) {
    console.warn("[gas_estimator] Falling back to default fees:", err.message);
    return {
      slow:   buildTier("slow",   100,  opts.xlmUsd ?? null),
      medium: buildTier("medium", 200,  opts.xlmUsd ?? null),
      fast:   buildTier("fast",   1000, opts.xlmUsd ?? null),
      spikeDetected: false,
      networkCongestion: "unknown",
      ledger: null,
      ledgerBaseFeeStroops: 100,
      updatedAt: new Date().toISOString(),
      cached: false,
      fallback: true,
    };
  }
}

module.exports = {
  getGasEstimate,
  getSafeGasEstimate,
  computeTiers,
  extractFeeDataPoints,
  stroopsToXlm,
  percentile,
  CACHE_KEY,
  CACHE_TTL,
};
