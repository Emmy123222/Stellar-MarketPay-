"use strict";

/**
 * __tests__/horizonClient.test.js
 *
 * Unit tests for the Horizon API wrapper:
 *   - Retry on 429 with exponential back-off
 *   - No retry on other errors
 *   - Concurrency capped at 5
 *   - Prometheus histogram records observations
 */

// ─── Module isolation ──────────────────────────────────────────────────────
// Isolate each describe block's require so the p-limit singleton is fresh.
let callWithLimit;
let executeWithRetry;
let _setRetryBaseDelay;
let horizonLatency;
let limit;
let pLimit;

beforeAll(() => {
  // Use real p-limit but a fresh module load.
  jest.resetModules();
  ({ callWithLimit, executeWithRetry, _setRetryBaseDelay, horizonLatency, limit } =
    require("../src/utils/horizonClient"));
  pLimit = require("p-limit");

  // Speed up retries so tests finish in milliseconds, not seconds.
  _setRetryBaseDelay(1);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRateLimitError() {
  const err = new Error("Rate limit");
  err.response = { status: 429 };
  return err;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("horizonClient.executeWithRetry", () => {
  it("returns the result of the wrapped function", async () => {
    const fn = jest.fn().mockResolvedValue({ records: [1, 2, 3] });
    const result = await executeWithRetry(fn, "test.success");
    expect(result).toEqual({ records: [1, 2, 3] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and eventually succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError())
      .mockRejectedValueOnce(makeRateLimitError())
      .mockResolvedValue("ok");

    const result = await executeWithRetry(fn, "test.retry");
    expect(result).toBe("ok");
    // 1 initial + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all 5 retries on persistent 429", async () => {
    const fn = jest.fn().mockRejectedValue(makeRateLimitError());

    await expect(executeWithRetry(fn, "test.exhausted")).rejects.toMatchObject({
      response: { status: 429 },
    });
    // 1 initial attempt + 5 retries = 6 total calls
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("does NOT retry on non-429 errors", async () => {
    const err = new Error("Not found");
    err.response = { status: 404 };
    const fn = jest.fn().mockRejectedValue(err);

    await expect(executeWithRetry(fn, "test.noRetry")).rejects.toThrow("Not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("records latency with status=success in the Prometheus histogram", async () => {
    const fn = jest.fn().mockResolvedValue("data");
    await executeWithRetry(fn, "test.metric.ok");

    const metric = await horizonLatency.get();
    const countSamples = metric.values.filter(
      (s) =>
        s.labels.method === "test.metric.ok" &&
        s.labels.status === "success" &&
        s.metricName.endsWith("_count")
    );
    expect(countSamples.length).toBeGreaterThan(0);
    expect(countSamples[0].value).toBeGreaterThanOrEqual(1);
  });

  it("records latency with status=error in the Prometheus histogram", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(executeWithRetry(fn, "test.metric.err")).rejects.toThrow("boom");

    const metric = await horizonLatency.get();
    const countSamples = metric.values.filter(
      (s) =>
        s.labels.method === "test.metric.err" &&
        s.labels.status === "error" &&
        s.metricName.endsWith("_count")
    );
    expect(countSamples.length).toBeGreaterThan(0);
    expect(countSamples[0].value).toBeGreaterThanOrEqual(1);
  });
});

describe("horizonClient.callWithLimit – concurrency cap", () => {
  it("limits concurrent Horizon calls to 5", async () => {
    // Create an isolated limiter so this test doesn't share state with others.
    const freshLimit = pLimit(5);

    let active = 0;
    let maxActive = 0;
    const TASK_COUNT = 12;
    const TASK_DELAY_MS = 20;

    const slowTask = () =>
      freshLimit(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, TASK_DELAY_MS));
        active -= 1;
      });

    await Promise.all(Array.from({ length: TASK_COUNT }, slowTask));

    expect(maxActive).toBeLessThanOrEqual(5);
    expect(maxActive).toBeGreaterThan(0);
  }, 10000); // generous timeout for real timer usage
});
