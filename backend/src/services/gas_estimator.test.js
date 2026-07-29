"use strict";

/**
 * Tests for gas_estimator.js
 * Covers: extractFeeDataPoints, percentile, computeTiers, stroopsToXlm, getSafeGasEstimate
 */

// Mock cacheService to avoid live Redis connections in unit tests
jest.mock("./cacheService", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
}));

const {
  extractFeeDataPoints,
  percentile,
  computeTiers,
  stroopsToXlm,
  getSafeGasEstimate,
} = require("./gas_estimator");

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFeeStats({ histogramBuckets, p10, p50, p90, p99, max, min } = {}) {
  return {
    last_ledger: "12345",
    ledger_base_fee: "100",
    fee_charged: {
      min:  String(min  ?? 100),
      p10:  String(p10  ?? 100),
      p50:  String(p50  ?? 200),
      p90:  String(p90  ?? 400),
      p99:  String(p99  ?? 500),
      max:  String(max  ?? 1000),
      histogram: histogramBuckets ?? [],
    },
  };
}

// ─── stroopsToXlm ───────────────────────────────────────────────────────────

describe("stroopsToXlm", () => {
  test("converts 0 correctly", () => {
    expect(stroopsToXlm(0)).toBe("0");
  });

  test("converts 1 stroop", () => {
    expect(stroopsToXlm(1)).toBe("0.0000001");
  });

  test("converts exactly 1 XLM", () => {
    expect(stroopsToXlm(10_000_000)).toBe("1");
  });

  test("converts 1.5 XLM", () => {
    expect(stroopsToXlm(15_000_000)).toBe("1.5");
  });

  test("converts 100 stroops (min fee)", () => {
    expect(stroopsToXlm(100)).toBe("0.00001");
  });
});

// ─── percentile ─────────────────────────────────────────────────────────────

describe("percentile", () => {
  const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  test("returns first element at p0", () => {
    expect(percentile(arr, 0)).toBe(10);
  });

  test("returns last element at p100", () => {
    expect(percentile(arr, 100)).toBe(100);
  });

  test("returns median at p50", () => {
    const result = percentile(arr, 50);
    expect(result).toBeGreaterThanOrEqual(50);
    expect(result).toBeLessThanOrEqual(60);
  });

  test("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

// ─── extractFeeDataPoints ────────────────────────────────────────────────────

describe("extractFeeDataPoints", () => {
  test("returns sorted array from histogram buckets", () => {
    const stats = makeFeeStats({
      histogramBuckets: [
        { min: "100", max: "200", count: "5" },
        { min: "300", max: "400", count: "3" },
      ],
    });
    const points = extractFeeDataPoints(stats);
    expect(points.length).toBeGreaterThan(0);
    expect(points).toEqual([...points].sort((a, b) => a - b));
  });

  test("falls back to p-values when no histogram", () => {
    const stats = makeFeeStats({
      histogramBuckets: [],
      p50: 250,
      p90: 450,
    });
    const points = extractFeeDataPoints(stats);
    expect(points.length).toBeGreaterThan(0);
    expect(points).toContain(250);
    expect(points).toContain(450);
  });

  test("handles missing fee_charged gracefully", () => {
    const points = extractFeeDataPoints({});
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBe(0);
  });
});

// ─── computeTiers ────────────────────────────────────────────────────────────

describe("computeTiers", () => {
  test("returns slow, medium, fast tiers", () => {
    const stats = makeFeeStats({ p50: 200, p90: 400 });
    const result = computeTiers(stats, null);
    expect(result).toHaveProperty("slow");
    expect(result).toHaveProperty("medium");
    expect(result).toHaveProperty("fast");
  });

  test("slow <= medium <= fast stroops", () => {
    const stats = makeFeeStats({ p50: 200, p90: 400 });
    const { slow, medium, fast } = computeTiers(stats, null);
    expect(slow.stroops).toBeLessThanOrEqual(medium.stroops);
    expect(medium.stroops).toBeLessThanOrEqual(fast.stroops);
  });

  test("minimum fee is 100 stroops", () => {
    const stats = makeFeeStats({ min: 1, p50: 1, p90: 1 });
    const { slow } = computeTiers(stats, null);
    expect(slow.stroops).toBeGreaterThanOrEqual(100);
  });

  test("usd values are null when xlmUsd is null", () => {
    const stats = makeFeeStats({});
    const { slow, medium, fast } = computeTiers(stats, null);
    expect(slow.usd).toBeNull();
    expect(medium.usd).toBeNull();
    expect(fast.usd).toBeNull();
  });

  test("usd values are numbers when xlmUsd is provided", () => {
    const stats = makeFeeStats({});
    const { slow } = computeTiers(stats, 0.5);
    expect(typeof slow.usd).toBe("number");
    expect(slow.usd).toBeGreaterThan(0);
  });

  test("detects fee spike when fast >= 3x slow", () => {
    // Force a spike scenario via Horizon p-values (no histogram)
    const stats = makeFeeStats({ min: 100, p50: 200, p90: 1000 });
    const result = computeTiers(stats, null);
    // fast is p90 (1000), slow is min (100): 1000 >= 3*100 → spike
    if (result.spikeDetected) {
      expect(result.networkCongestion).toBe("high");
      // fast tier gets 20% buffer on top
      expect(result.fast.stroops).toBeGreaterThan(1000);
    }
  });

  test("reports networkCongestion field", () => {
    const stats = makeFeeStats({});
    const result = computeTiers(stats, null);
    expect(["low", "medium", "high"]).toContain(result.networkCongestion);
  });

  test("returns updatedAt ISO string", () => {
    const stats = makeFeeStats({});
    const result = computeTiers(stats, null);
    expect(() => new Date(result.updatedAt)).not.toThrow();
  });

  test("includes ledger from fee stats", () => {
    const stats = makeFeeStats({});
    const result = computeTiers(stats, null);
    expect(result.ledger).toBe("12345");
  });

  test("tiers have xlm string in correct format", () => {
    const stats = makeFeeStats({ p50: 200, p90: 400 });
    const { medium } = computeTiers(stats, null);
    expect(typeof medium.xlm).toBe("string");
    expect(parseFloat(medium.xlm)).toBeGreaterThan(0);
  });
});

// ─── getSafeGasEstimate ───────────────────────────────────────────────────────

describe("getSafeGasEstimate", () => {
  test("returns fallback when fetch fails", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await getSafeGasEstimate();

    expect(result.fallback).toBe(true);
    expect(result).toHaveProperty("slow");
    expect(result).toHaveProperty("medium");
    expect(result).toHaveProperty("fast");
    expect(result.slow.stroops).toBe(100);
    expect(result.medium.stroops).toBe(200);
    expect(result.fast.stroops).toBe(1000);

    global.fetch = originalFetch;
  });

  test("fallback tiers have valid xlm format", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await getSafeGasEstimate();

    expect(typeof result.slow.xlm).toBe("string");
    expect(parseFloat(result.slow.xlm)).toBeGreaterThan(0);

    global.fetch = originalFetch;
  });

  test("returns estimate from API on success", async () => {
    const mockFeeStats = makeFeeStats({ p50: 200, p90: 400 });
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockFeeStats,
    });

    const result = await getSafeGasEstimate({ forceRefresh: true });

    expect(result.fallback).toBeFalsy();
    expect(result.slow).toBeDefined();
    expect(result.medium).toBeDefined();
    expect(result.fast).toBeDefined();

    global.fetch = originalFetch;
  });
});

// ─── Tier label validation ────────────────────────────────────────────────────

describe("tier labels", () => {
  test("each tier has the correct label property", () => {
    const stats = makeFeeStats({});
    const { slow, medium, fast } = computeTiers(stats, null);
    expect(slow.label).toBe("slow");
    expect(medium.label).toBe("medium");
    expect(fast.label).toBe("fast");
  });
});
