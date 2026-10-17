/**
 * src/services/xlmPriceService.test.js
 *
 * Unit tests for XLM price fetching, fallback logic, caching, and Prometheus
 * updates. This service deliberately does not hit real network services when
 * unit tests run.
 */
"use strict";

const mockGaugeSet = jest.fn();
const mockPriceFetchErrorsIncrement = jest.fn();

jest.mock("../metrics", () => ({
  xlmPriceUsd: { set: mockGaugeSet },
  xlmPriceFetchErrorsTotal: { inc: mockPriceFetchErrorsIncrement },
}));

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockRedisTtl = jest.fn();
const mockGetClient = jest.fn(() => ({ ttl: mockRedisTtl }));

jest.mock("./cacheService", () => ({
  get: mockCacheGet,
  set: mockCacheSet,
  getClient: mockGetClient,
}));

jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  }),
}));

const NOW_MS = 1_700_000_000_000;
const PRICE_USD = 0.12;

function makeMarketChartPayload(priceUsd = PRICE_USD) {
  const ts24hAgo = NOW_MS - 24 * 60 * 60 * 1000;
  return {
    prices: [
      [ts24hAgo, priceUsd * 0.95],
      [NOW_MS, priceUsd],
    ],
  };
}

function makeCoinbasePricePayload(amount = PRICE_USD) {
  return {
    data: {
      amount: String(amount),
    },
  };
}

let service;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockRedisTtl.mockResolvedValue(0);

  service = require("./xlmPriceService");
  service._resetLastSuccessfulPrice();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. CoinGecko healthy, no cache
// ─────────────────────────────────────────────────────────────────────────────
describe("getCurrentXlmPrice", () => {
  it("calls CoinGecko and returns the price when the API is healthy", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: PRICE_USD } }),
    });

    const result = await service.getCurrentXlmPrice();

    expect(result.priceUsd).toBeCloseTo(PRICE_USD);
    expect(result.cached).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd");
  });

// ─────────────────────────────────────────────────────────────────────────────
// 2. CoinGecko 429, fallback to Coinbase
// ─────────────────────────────────────────────────────────────────────────────
  it("falls back to Coinbase when CoinGecko returns 429", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCoinbasePricePayload(PRICE_USD),
      });

    const result = await service.getCurrentXlmPrice();

    expect(result.priceUsd).toBeCloseTo(PRICE_USD);
    expect(result.cached).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(2, "https://api.coinbase.com/v2/prices/XLM-USD/spot");
    expect(mockPriceFetchErrorsIncrement).toHaveBeenCalledTimes(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// 3. Both providers fail — use last known good price
// ─────────────────────────────────────────────────────────────────────────────
  it("uses the last successful XLM price for up to 10 minutes when both providers fail", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    service._setLastSuccessfulPrice({ priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() });

    const result = await service.getCurrentXlmPrice();

    expect(result.priceUsd).toBeCloseTo(PRICE_USD);
    expect(result.cached).toBe(true);
    expect(mockPriceFetchErrorsIncrement).toHaveBeenCalledTimes(2);
  });

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fresh Redis cache — no provider calls
// ─────────────────────────────────────────────────────────────────────────────
  it("returns a Redis cached value when it is still fresh and does not call the providers", async () => {
    const cached = { priceUsd: PRICE_USD, updatedAt: new Date(NOW_MS).toISOString() };
    mockCacheGet.mockResolvedValue(cached);
    mockRedisTtl.mockResolvedValue(45);
    global.fetch = jest.fn();

    const result = await service.getCurrentXlmPrice();

    expect(result.cached).toBe(true);
    expect(result.priceUsd).toBe(PRICE_USD);
    expect(global.fetch).not.toHaveBeenCalled();
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5. Successful fetch updates Prometheus gauge
// ─────────────────────────────────────────────────────────────────────────────
  it("updates the Prometheus gauge after a successful fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: PRICE_USD } }),
    });

    await service.getCurrentXlmPrice();

    expect(mockGaugeSet).toHaveBeenCalledTimes(1);
    expect(mockGaugeSet).toHaveBeenCalledWith(expect.closeTo(PRICE_USD, 5));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Background refresh uses Coinbase on CoinGecko failure
// ─────────────────────────────────────────────────────────────────────────────
describe("refreshPriceInBackground", () => {
  it("uses Coinbase fallback when a background CoinGecko fetch fails", async () => {
    const cached = { priceUsd: PRICE_USD * 0.9, updatedAt: new Date(NOW_MS).toISOString() };
    mockCacheGet.mockResolvedValue(cached);
    mockRedisTtl.mockResolvedValue(5);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCoinbasePricePayload(PRICE_USD * 1.1),
      });

    await service.getCurrentXlmPrice();
    await new Promise((resolve) => setImmediate(resolve));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockCacheSet).toHaveBeenCalledWith(
      "xlm:price:usd",
      expect.objectContaining({ priceUsd: expect.any(Number) }),
      service.PRICE_TTL_SECONDS
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Historical data — unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe("getXlmUsd7dHistory", () => {
  it("keeps using CoinGecko market chart history behavior", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeMarketChartPayload(),
    });

    const result = await service.getXlmUsd7dHistory();

    expect(result.currentPriceUsd).toBeCloseTo(PRICE_USD);
    expect(result.cached).toBe(false);
  });
});
