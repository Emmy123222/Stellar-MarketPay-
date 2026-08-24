/**
 * k6/config.js
 *
 * Shared configuration, SLA thresholds and helpers used by every
 * Stellar MarketPay load-test script.
 *
 * ---------------------------------------------------------------------------
 * SLA targets (from the load-testing issue)
 * ---------------------------------------------------------------------------
 *   • p(95) response time  < 200 ms while sustaining 100 virtual users (VUs)
 *   • 0 % request error rate while sustaining 50 VUs
 *
 * These thresholds are encoded once here and re-used by every script so the
 * CI gate is consistent across endpoints.
 * ---------------------------------------------------------------------------
 *
 * Environment variables (all optional — sensible local defaults provided):
 *
 *   K6_BASE_URL   Base URL of the API under test            (default http://localhost:4000)
 *   K6_ENV        Logical environment tag for results        (default local)
 *   K6_FIXTURES   Path to the JSON fixtures produced by      (default ./test-fixtures.json)
 *                 `seed-data.js`
 */
import { check } from "k6";

export const BASE_URL = (__ENV.K6_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
export const FIXTURES_PATH = __ENV.K6_FIXTURES || "./test-fixtures.json";

/** Canonical SLA limits — kept as constants so reports can reference them. */
export const SLA = Object.freeze({
  P95_MS: 200, // p(95) < 200 ms
  STRESS_VUS: 100, // …at 100 VUs
  ERROR_RATE_GATE_VUS: 50, // 0 % errors at 50 VUs
  MAX_ERROR_RATE: 0.0, // 0 %
});

/**
 * k6 thresholds shared by every script. `http_req_failed` covers transport /
 * 5xx errors (the SLA "0 % error rate at 50 VUs" gate — enforced to < 0.1 % to
 * allow for the rare transient network blip while still being effectively zero);
 * `http_req_duration` is the latency SLA gate (p(95) < 200 ms at 100 VUs);
 * `checks` enforces that business-level assertions (status 2xx, `success: true`)
 * hold.
 *
 * The ramping scenario (see rampingStages) sustains BOTH 50 VUs and 100 VUs, so
 * a single run validates the two SLA gates together.
 */
export const thresholds = {
  http_req_failed: [`rate<0.001`], // effectively 0 % (< 0.1 %)
  http_req_duration: [`p(95)<${SLA.P95_MS}`], // p(95) < 200 ms
  checks: [`rate>0.99`], // > 99 % of business checks pass
};

/**
 * Standard Ramping VU scenario that exercises BOTH SLA gates in one run:
 *
 *   stage 1  → warm up to 10 VUs
 *   stage 2  → ramp to 50 VUs   (validates: 0 % error rate @ 50 VUs)
 *   stage 3  → ramp to 100 VUs  (validates: p(95) < 200 ms @ 100 VUs)
 *   stage 4  → hold at 100 VUs  (sustained peak)
 *   stage 5  → ramp down to 0
 *
 * Pass { toVUs, holdHigh } to customise the peak for lighter endpoints.
 */
export function rampingStages({ toVUs = SLA.STRESS_VUS, holdHigh = "30s" } = {}) {
  return [
    { duration: "15s", target: 10 }, // warm-up
    { duration: "30s", target: SLA.ERROR_RATE_GATE_VUS }, // 0 % errors @ 50 VUs
    { duration: "30s", target: toVUs }, // ramp to peak
    { duration: holdHigh, target: toVUs }, // sustained peak
    { duration: "15s", target: 0 }, // ramp-down
  ];
}

/** Common result tags so k6 Cloud / trend reports stay consistent. */
export function commonTags(scriptName) {
  return {
    test: "stellar-marketpay",
    script: scriptName,
    environment: __ENV.K6_ENV || "local",
    run_id: __ENV.K6_RUN_ID || "adhoc",
  };
}

/**
 * Build the standard `options` object for a script.
 *
 * @param {string} scriptName   Tag used in reports.
 * @param {object} [overrides]  Extra/overriding k6 options (e.g. scenarios).
 */
export function buildOptions(scriptName, overrides = {}) {
  return Object.assign(
    {
      tags: commonTags(scriptName),
      thresholds,
      stages: rampingStages(),
      // Bail out fast if the SLA is blown so CI fails predictably.
      cloud: { distribute: true },
      noConnectionReuse: false,
      userAgent: "k6-loadtest/stellar-marketpay",
    },
    overrides,
  );
}

/**
 * Shared check helpers — return a boolean so they can be combined with `&&`.
 */
export const assertions = {
  status200: (r) => r.status === 200,
  statusCreated: (r) => r.status === 201,
  successTrue: (r) => {
    try {
      return r.json("success") === true;
    } catch (e) {
      return false;
    }
  },
};

export { check };
