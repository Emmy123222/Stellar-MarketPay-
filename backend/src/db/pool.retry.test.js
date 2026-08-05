"use strict";

/**
 * Tests for connectWithRetry() — issue #827
 *
 * All tests mock the pg.Pool so no live Postgres instance is required.
 * jest.useFakeTimers() is used to drive setTimeout without real-time
 * delays, keeping the suite fast.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock logger so we can assert on logged messages without noisy output.
const mockWarn  = jest.fn();
const mockInfo  = jest.fn();
const mockError = jest.fn();

jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({
    warn:  mockWarn,
    info:  mockInfo,
    error: mockError,
  }),
}));

// Mock pg.Pool — we replace `connect` per-test.
const mockConnect = jest.fn();
jest.mock("pg", () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
      on: jest.fn(),
      // Pool stats properties
      totalCount: 0,
      idleCount:  0,
      waitingCount: 0,
    })),
  };
});

// Spy on process.exit so we can assert it is called without actually exiting.
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// ─── Module under test ───────────────────────────────────────────────────────

// Must be required AFTER the mocks are in place.
const { connectWithRetry } = require("./pool");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flush all pending timers and microtasks created during a connectWithRetry()
 * call. We advance fake timers to the capped delay (30 s) per retry attempt
 * and drain micro-task queues between advances so that the Promise continuations
 * that await the setTimeout actually resolve.
 *
 * @param {number} flushCount   How many setTimeout delays to flush.
 * @param {number} maxDelayMs   The expected maximum single delay (default 30 000).
 */
async function flushRetries(flushCount, maxDelayMs = 30_000) {
  for (let i = 0; i < flushCount; i++) {
    // Advance past any pending setTimeout.
    jest.advanceTimersByTime(maxDelayMs);
    // Let the awaited setTimeout inside connectWithRetry resolve.
    await Promise.resolve();
    await Promise.resolve();
  }
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  mockConnect.mockReset();
  mockWarn.mockClear();
  mockInfo.mockClear();
  mockError.mockClear();
  mockExit.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("connectWithRetry()", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it("resolves immediately when the first connection attempt succeeds", async () => {
    const mockClient = { release: jest.fn() };
    mockConnect.mockResolvedValueOnce(mockClient);

    await connectWithRetry();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      expect.stringContaining("established")
    );
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("releases the client after a successful connect", async () => {
    const mockClient = { release: jest.fn() };
    mockConnect.mockResolvedValueOnce(mockClient);

    await connectWithRetry();

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  // ── Retry behaviour ────────────────────────────────────────────────────────

  it("retries after a transient failure and succeeds on the 2nd attempt", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("Connection refused");
    mockConnect
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry();
    // Drain the failed first attempt, then flush the 1-second back-off.
    await Promise.resolve();
    await flushRetries(1);
    await retryPromise;

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, delayMs: 1_000 }),
      expect.stringContaining("1/")
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2 }),
      expect.stringContaining("established")
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("retries after multiple transient failures and succeeds on the 5th attempt", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("ECONNREFUSED");

    // Fail 4 times, then succeed.
    mockConnect
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry();
    // Each failure is followed by a back-off; flush all 4 delays.
    await Promise.resolve();
    await flushRetries(4);
    await retryPromise;

    expect(mockConnect).toHaveBeenCalledTimes(5);
    expect(mockWarn).toHaveBeenCalledTimes(4);
    expect(mockExit).not.toHaveBeenCalled();
  });

  // ── Back-off schedule ──────────────────────────────────────────────────────

  it("uses exponential back-off delays: 1s, 2s, 4s, 8s …", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("ECONNREFUSED");

    // Fail 4 times, then succeed.
    mockConnect
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry();
    await Promise.resolve();
    await flushRetries(4);
    await retryPromise;

    const delays = mockWarn.mock.calls.map((args) => args[0].delayMs);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("caps the back-off delay at 30 seconds", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("ECONNREFUSED");

    // Fail 9 times (delays: 1,2,4,8,16,30,30,30,30), then succeed.
    const failCount = 9;
    for (let i = 0; i < failCount; i++) {
      mockConnect.mockRejectedValueOnce(connErr);
    }
    mockConnect.mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry();
    await Promise.resolve();
    await flushRetries(failCount);
    await retryPromise;

    const delays = mockWarn.mock.calls.map((args) => args[0].delayMs);
    // Every delay must be at most 30 000 ms.
    expect(delays.every((d) => d <= 30_000)).toBe(true);
    // Delays from attempt 6 onward should all be exactly 30 000 ms.
    // Schedule: 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000
    // Cap kicks in at index 5 (attempt 6: 2^5 * 1000 = 32000 → capped).
    expect(delays.slice(5)).toEqual(
      Array(delays.length - 5).fill(30_000)
    );
  });

  // ── Exhaustion / graceful shutdown ─────────────────────────────────────────

  it("calls process.exit(1) after all attempts are exhausted", async () => {
    const connErr = new Error("Postgres is down");
    // Fail all 10 attempts.
    for (let i = 0; i < 10; i++) {
      mockConnect.mockRejectedValueOnce(connErr);
    }

    const retryPromise = connectWithRetry().catch(() => {
      // swallow the re-thrown "process.exit called" error
    });
    await Promise.resolve();
    // Flush 9 back-off delays (the 10th failure triggers exit immediately).
    await flushRetries(9);
    await retryPromise;

    expect(mockConnect).toHaveBeenCalledTimes(10);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("logs an error before calling process.exit(1)", async () => {
    const connErr = new Error("Postgres is down");
    for (let i = 0; i < 10; i++) {
      mockConnect.mockRejectedValueOnce(connErr);
    }

    const retryPromise = connectWithRetry().catch(() => {});
    await Promise.resolve();
    await flushRetries(9);
    await retryPromise;

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 10, maxAttempts: 10 }),
      expect.stringContaining("all retry attempts exhausted")
    );
  });

  it("logs a warning for each failed attempt except the last", async () => {
    const connErr = new Error("Postgres is down");
    for (let i = 0; i < 10; i++) {
      mockConnect.mockRejectedValueOnce(connErr);
    }

    const retryPromise = connectWithRetry().catch(() => {});
    await Promise.resolve();
    await flushRetries(9);
    await retryPromise;

    // 9 warnings (attempts 1–9), 1 error (attempt 10), 0 info
    expect(mockWarn).toHaveBeenCalledTimes(9);
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  // ── Custom options ─────────────────────────────────────────────────────────

  it("respects a custom maxAttempts option", async () => {
    const connErr = new Error("ECONNREFUSED");
    for (let i = 0; i < 3; i++) {
      mockConnect.mockRejectedValueOnce(connErr);
    }

    const retryPromise = connectWithRetry({ maxAttempts: 3 }).catch(() => {});
    await Promise.resolve();
    await flushRetries(2);
    await retryPromise;

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("respects a custom baseDelayMs option", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("ECONNREFUSED");

    mockConnect
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry({ baseDelayMs: 500 });
    await Promise.resolve();
    await flushRetries(1, 500);
    await retryPromise;

    const [firstCall] = mockWarn.mock.calls;
    expect(firstCall[0].delayMs).toBe(500); // 2^0 * 500
  });

  it("respects a custom maxDelayMs cap", async () => {
    const mockClient = { release: jest.fn() };
    const connErr = new Error("ECONNREFUSED");

    // 4 failures; with default baseDelayMs (1s) and maxDelayMs = 5s:
    // delays would be 1, 2, 4, 5 (capped)
    mockConnect
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(mockClient);

    const retryPromise = connectWithRetry({ maxDelayMs: 5_000 });
    await Promise.resolve();
    await flushRetries(4, 5_000);
    await retryPromise;

    const delays = mockWarn.mock.calls.map((c) => c[0].delayMs);
    expect(delays).toEqual([1_000, 2_000, 4_000, 5_000]);
  });
});
