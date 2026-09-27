/**
 * src/services/xlmPriceService.test.js
 *
 * Unit tests for XLM price caching, stale-while-revalidate logic, and
 * Prometheus gauge updates.
 *
 * All external I/O (cacheService, metrics, global fetch) is mocked so these
 * tests run fully in-process without Redis or network.
 */
"use strict";

// ─── Mock metrics BEFORE requiring the service ───────────────────────────────
const mockGaugeSet = jest.fn();
jest.mock("../metrics", () => ({
  xlmPriceUsd: { set: mockGaugeSet },
}));

// ─── Mock cacheService ────────────────────────────────────────────────────────
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockRedisTtl = jest.fn();
const mockGetClient = jest.fn(() => ({ ttl: mockRedisTtl }));

jest.mock("./cacheService", () => ({
  get: mockCacheGet,
  set: mockCacheSet,
  getClient: mockGetClient,
}));

// ─── Mock logger so test output stays clean ───────────────────────────────────
jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  }),
}));

// ─── Fixture data ─────────────────────────────────────────────────────────────
const NOW_MS = 1_700_000_000_000;
const PRICE_USD = 0.12;

/** Minimal CoinGecko market_chart response with two data points. */
function makeMarketChartPayload(priceUsd = PRICE_USD) {
  const ts24hAgo = NOW_MS - 24 * 60 * 60 * 1000;
  return {
    prices: [
      [ts24hAgo, priceUsd * 0.95], // ~24 h ago
      [NOW_MS, priceUsd],           // latest
    ],
  };
}

// ─── Service under test ───────────────────────────────────────────────────────
let service;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Default mock: no cached value, Redis TTL = 0
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockRedisTtl.mockResolvedValue(0);

  // Re-require after resetModules so module-level state (_refreshInFlight) is
  // also reset.
  service = require("./xlmPriceService");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cache MISS
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice — cache MISS", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeMarketChartPayload(),
    });
  });

  it("calls CoinGecko and returns the price", async () => {
    const result = await service.getCurrentXlmPrice();
    expect(result.priceUsd).toBeCloseTo(PRICE_USD);
    expect(result.cached).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("writes the price to cache with a 60-second TTL", async () => {
    await service.getCurrentXlmPrice();
    expect(mockCacheSet).toHaveBeenCalledWith(
      "xlm:price:usd",
      expect.objectContaining({ priceUsd: expect.any(Number) }),
      service.PRICE_TTL_SECONDS
    );
  });

  it("updates the xlm_price_usd Prometheus gauge", async () => {
    await service.getCurrentXlmPrice();
    expect(mockGaugeSet).toHaveBeenCalledTimes(1);
    expect(mockGaugeSet).toHaveBeenCalledWith(expect.closeTo(PRICE_USD, 5));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cache HIT — TTL well above threshold (no background refresh)
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice — cache HIT, TTL > threshold", () => {
  const CACHED = { priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() };

  beforeEach(() => {
    mockCacheGet.mockResolvedValue(CACHED);
    // TTL still has 45 seconds left (well above the 15-second threshold)
    mockRedisTtl.mockResolvedValue(45);
    global.fetch = jest.fn();
  });

  it("returns the cached value immediately", async () => {
    const result = await service.getCurrentXlmPrice();
    expect(result.cached).toBe(true);
    expect(result.priceUsd).toBe(PRICE_USD);
  });

  it("does NOT call CoinGecko", async () => {
    await service.getCurrentXlmPrice();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT update the gauge (no new data fetched)", async () => {
    await service.getCurrentXlmPrice();
    expect(mockGaugeSet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cache HIT — TTL near expiry (background refresh triggered)
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice — cache HIT, TTL ≤ threshold", () => {
  const CACHED = { priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() };

  beforeEach(() => {
    mockCacheGet.mockResolvedValue(CACHED);
    // TTL is 10 seconds — below the 15-second threshold
    mockRedisTtl.mockResolvedValue(10);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeMarketChartPayload(PRICE_USD * 1.1),
    });
  });

  it("returns the cached value synchronously", async () => {
    const result = await service.getCurrentXlmPrice();
    expect(result.cached).toBe(true);
    expect(result.priceUsd).toBe(PRICE_USD);
  });

  it("triggers exactly one background CoinGecko call", async () => {
    await service.getCurrentXlmPrice();

    // Background refresh is fire-and-forget; drain the microtask queue.
    await new Promise((r) => setImmediate(r));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("updates the cache and gauge after the background refresh", async () => {
    await service.getCurrentXlmPrice();
    await new Promise((r) => setImmediate(r));

    expect(mockCacheSet).toHaveBeenCalledWith(
      "xlm:price:usd",
      expect.objectContaining({ priceUsd: expect.any(Number) }),
      service.PRICE_TTL_SECONDS
    );
    expect(mockGaugeSet).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Concurrent hits with near-expiry TTL — only one CoinGecko call
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice — concurrent near-expiry hits (stampede prevention)", () => {
  const CACHED = { priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() };

  beforeEach(() => {
    mockCacheGet.mockResolvedValue(CACHED);
    mockRedisTtl.mockResolvedValue(5); // well below threshold
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeMarketChartPayload(),
    });
  });

  it("fires only a single CoinGecko request across N concurrent callers", async () => {
    const N = 20;
    // Fire N simultaneous calls
    await Promise.all(Array.from({ length: N }, () => service.getCurrentXlmPrice()));

    // Drain the event loop so all fire-and-forget refreshes complete
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Only one fetch should have happened despite N callers
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Background refresh failure — flag is cleared, warning is logged
// ─────────────────────────────────────────────────────────────────────────────
describe("refreshPriceInBackground — failure handling", () => {
  const CACHED = { priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() };

  beforeEach(() => {
    mockCacheGet.mockResolvedValue(CACHED);
    mockRedisTtl.mockResolvedValue(5);
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
  });

  it("does not throw from the public API even when the background refresh fails", async () => {
    await expect(service.getCurrentXlmPrice()).resolves.not.toThrow();
  });

  it("clears _refreshInFlight after a failed refresh so subsequent refreshes can run", async () => {
    // First call triggers the failing background refresh
    await service.getCurrentXlmPrice();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Reset fetch to succeed this time
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeMarketChartPayload(),
    });

    // A second near-expiry hit should trigger a new background refresh
    await service.getCurrentXlmPrice();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CoinGecko error on cache miss — propagates to caller
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice — CoinGecko error on cache miss", () => {
  beforeEach(() => {
    mockCacheGet.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
  });

  it("throws when CoinGecko returns a non-ok status", async () => {
    await expect(service.getCurrentXlmPrice()).rejects.toThrow("CoinGecko request failed: 429");
  });

  it("does not update the gauge on error", async () => {
    await service.getCurrentXlmPrice().catch(() => {});
    expect(mockGaugeSet).not.toHaveBeenCalled();
  });
});
