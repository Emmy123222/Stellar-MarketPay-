/**
 * Unit tests for fetchXlmPriceHistory in frontend/lib/api.ts
 * Sub-task 1.1 — Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { fetchXlmPriceHistory, Timeframe } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Horizon trade_aggregations success response. */
function makeHorizonResponse(records: { timestamp: string; close: string }[]) {
  return {
    ok: true,
    json: async () => ({ _embedded: { records } }),
  } as unknown as Response;
}

function makeHorizonErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ detail: "error" }),
  } as unknown as Response;
}

const SAMPLE_RECORDS = [
  { timestamp: "1000000", close: "0.1234" },
  { timestamp: "2000000", close: "0.2345" },
  { timestamp: "3000000", close: "0.3456" },
];

// ---------------------------------------------------------------------------
// Unit tests — 1.1
// ---------------------------------------------------------------------------

describe("fetchXlmPriceHistory", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── URL construction per timeframe ──────────────────────────────────────

  it.each<[Timeframe, number]>([
    ["1D",  3_600_000],
    ["7D",  86_400_000],
    ["30D", 86_400_000],
  ])(
    "calls trade_aggregations with resolution=%i for timeframe=%s",
    async (timeframe, expectedResolution) => {
      global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

      await fetchXlmPriceHistory(timeframe);

      const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      const url = new URL(calledUrl);

      expect(url.pathname).toContain("trade_aggregations");
      expect(url.searchParams.get("resolution")).toBe(String(expectedResolution));
      expect(url.searchParams.get("base_asset_type")).toBe("native");
      expect(url.searchParams.get("counter_asset_code")).toBe("USDC");
      expect(url.searchParams.get("order")).toBe("asc");
      expect(url.searchParams.get("limit")).toBe("200");
    },
  );

  it("sends start_time approximately now minus lookback for 1D", async () => {
    const before = Date.now();
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    await fetchXlmPriceHistory("1D");

    const after = Date.now();
    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const url = new URL(calledUrl);

    const startTime = Number(url.searchParams.get("start_time"));
    const endTime   = Number(url.searchParams.get("end_time"));

    const expectedLookback = 24 * 60 * 60 * 1000;
    // Allow a 5-second tolerance
    expect(before - expectedLookback - 5000).toBeLessThanOrEqual(startTime);
    expect(startTime).toBeLessThanOrEqual(after - expectedLookback + 5000);
    expect(endTime).toBeGreaterThanOrEqual(before);
    expect(endTime).toBeLessThanOrEqual(after + 5000);
  });

  it("sends start_time approximately now minus 7 days for 7D", async () => {
    const before = Date.now();
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    await fetchXlmPriceHistory("7D");

    const after = Date.now();
    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const url = new URL(calledUrl);

    const startTime = Number(url.searchParams.get("start_time"));
    const expectedLookback = 7 * 24 * 60 * 60 * 1000;

    expect(before - expectedLookback - 5000).toBeLessThanOrEqual(startTime);
    expect(startTime).toBeLessThanOrEqual(after - expectedLookback + 5000);
  });

  // ── Return value mapping ─────────────────────────────────────────────────

  it("maps records to points with numeric timestamp and priceUsd", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    const result = await fetchXlmPriceHistory("7D");

    expect(result.points).toHaveLength(3);
    expect(result.points[0]).toEqual({ timestamp: 1_000_000, priceUsd: 0.1234 });
    expect(result.points[1]).toEqual({ timestamp: 2_000_000, priceUsd: 0.2345 });
    expect(result.points[2]).toEqual({ timestamp: 3_000_000, priceUsd: 0.3456 });
  });

  it("sets currentPriceUsd to the last point's priceUsd", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    const result = await fetchXlmPriceHistory("7D");

    expect(result.currentPriceUsd).toBe(0.3456);
  });

  it("computes change24hPercent as ((last - first) / first) * 100", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    const result = await fetchXlmPriceHistory("7D");

    const first = 0.1234;
    const last  = 0.3456;
    const expected = ((last - first) / first) * 100;
    expect(result.change24hPercent).toBeCloseTo(expected, 9);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("returns null for currentPriceUsd and change24hPercent when records are empty", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse([]));

    const result = await fetchXlmPriceHistory("7D");

    expect(result.points).toHaveLength(0);
    expect(result.currentPriceUsd).toBeNull();
    expect(result.change24hPercent).toBeNull();
  });

  it("returns null for change24hPercent when only one point exists", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeHorizonResponse([{ timestamp: "1000000", close: "0.5" }]),
    );

    const result = await fetchXlmPriceHistory("7D");

    expect(result.currentPriceUsd).toBe(0.5);
    expect(result.change24hPercent).toBeNull();
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("throws Error with status code substring on a non-2xx response (500)", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonErrorResponse(500));

    await expect(fetchXlmPriceHistory("7D")).rejects.toThrow("500");
  });

  it("throws Error with status code substring on a 403 response", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonErrorResponse(403));

    await expect(fetchXlmPriceHistory("7D")).rejects.toThrow("403");
  });

  it("error message matches the format 'Horizon API error: <status>'", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonErrorResponse(429));

    await expect(fetchXlmPriceHistory("7D")).rejects.toThrow(
      "Horizon API error: 429",
    );
  });

  // ── Default parameter ────────────────────────────────────────────────────

  it("defaults to 7D timeframe when called with no arguments", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeHorizonResponse(SAMPLE_RECORDS));

    await fetchXlmPriceHistory();

    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get("resolution")).toBe("86400000");
  });
});
