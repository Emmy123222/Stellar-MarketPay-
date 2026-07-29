"use strict";

/**
 * horizonClient.js
 *
 * Wraps all outbound Horizon API calls with:
 *  - Concurrency limiting via p-limit (max 5 concurrent requests)
 *  - Automatic retry with exponential back-off on HTTP 429 (Too Many Requests)
 *  - Prometheus histogram tracking request latency
 */

const pLimit = require("p-limit");
const promClient = require("prom-client");

// ── Prometheus histogram ─────────────────────────────────────────────────────
// Guard against double-registration if the module is hot-reloaded in tests.
let horizonLatency;
const existingMetric = promClient.register.getSingleMetric(
  "stellar_marketpay_horizon_request_duration_seconds"
);
if (existingMetric) {
  horizonLatency = existingMetric;
} else {
  horizonLatency = new promClient.Histogram({
    name: "stellar_marketpay_horizon_request_duration_seconds",
    help: "Latency of Horizon API requests in seconds",
    labelNames: ["method", "status"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  });
}

// ── Retry config ─────────────────────────────────────────────────────────────
const RETRY_MAX_ATTEMPTS = 5;     // max extra attempts after first failure

/** Overridable for tests: default base delay between retries in ms. */
let _retryBaseDelayMs = 100;

/** @internal – allow tests to speed up retries without touching real timers. */
function _setRetryBaseDelay(ms) {
  _retryBaseDelayMs = ms;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the error looks like an HTTP 429 response.
 * The Horizon SDK wraps responses as { response: { status: 429 } }.
 */
function isRateLimitError(err) {
  if (!err) return false;
  if (err.response && err.response.status === 429) return true;
  if (err.status === 429) return true;
  return false;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Execute a single Horizon call with retry-on-429 and latency tracking.
 *
 * @param {Function} fn     - Zero-argument async function that performs the call.
 * @param {string}  method  - Label for the Prometheus metric.
 * @returns {Promise<*>}
 */
async function executeWithRetry(fn, method) {
  const endTimer = horizonLatency.startTimer({ method });
  let attempt = 0;
  let delay = _retryBaseDelayMs;

  for (;;) {
    try {
      const result = await fn();
      endTimer({ status: "success" });
      return result;
    } catch (err) {
      if (isRateLimitError(err) && attempt < RETRY_MAX_ATTEMPTS) {
        attempt += 1;
        console.warn(
          `[HorizonClient] Rate limited (429) on '${method}'. ` +
            `Retry ${attempt}/${RETRY_MAX_ATTEMPTS} in ${delay} ms…`
        );
        await sleep(delay);
        delay *= 2; // exponential back-off
      } else {
        endTimer({ status: "error" });
        throw err;
      }
    }
  }
}

// ── Concurrency limiter (module-level singleton) ──────────────────────────────
const HORIZON_CONCURRENCY = 5;
const limit = pLimit(HORIZON_CONCURRENCY);

/**
 * Call a Horizon API function with concurrency limiting, retry, and metrics.
 *
 * @param {Function} fn      - Zero-argument async function wrapping the Horizon call.
 * @param {string}  [method] - Optional descriptive label for metrics.
 * @returns {Promise<*>}
 */
function callWithLimit(fn, method) {
  const label = method || fn.name || "unknown";
  return limit(() => executeWithRetry(fn, label));
}

module.exports = {
  callWithLimit,
  /** Exposed for testing – do NOT use in production. */
  executeWithRetry,
  _setRetryBaseDelay,
  horizonLatency,
  limit,
};
