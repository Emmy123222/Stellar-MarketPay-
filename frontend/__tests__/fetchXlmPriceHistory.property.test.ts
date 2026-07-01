/**
 * Property-based tests for fetchXlmPriceHistory in frontend/lib/api.ts
 * Sub-tasks 1.2, 1.3, 1.4, 1.5 — fast-check
 */

// Feature: xlm-price-chart

import * as fc from "fast-check";
import { fetchXlmPriceHistory, Timeframe } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHorizonResponse(records: { timestamp: number; close: number }[]) {
  return {
    ok: true,
    json: async () => ({
      _embedded: {
        records: records.map((r) => ({
          timestamp: String(r.timestamp),
          close: String(r.close),
        })),
      },
    }),
  } as unknown as Response;
}

function makeHorizonErrorResponse(status: number) {
  return { ok: false, status } as unknown as Response;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Property 1: fetchXlmPriceHistory returns well-formed PriceHistory for any timeframe
// Feature: xlm-price-chart, Property 1: fetchXlmPriceHistory returns well-formed PriceHistory for any timeframe
// Validates: Requirements 1.1, 1.6
// ---------------------------------------------------------------------------

describe("Property 1: well-formed PriceHistory for any timeframe", () => {
  it("returns non-empty points, currentPriceUsd equals last point, all points have numeric fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Timeframe>("1D", "7D", "30D"),
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0 }),
            close: fc.float({ min: Math.fround(0.0001), noNaN: true }),
          }),
          { minLength: 1 },
        ),
        async (timeframe, records) => {
          global.fetch = jest
            .fn()
            .mockResolvedValue(makeHorizonResponse(records));

          const result = await fetchXlmPriceHistory(timeframe);

          // points non-empty
          expect(result.points.length).toBeGreaterThan(0);

          // all points have numeric fields
          for (const pt of result.points) {
            expect(typeof pt.timestamp).toBe("number");
            expect(typeof pt.priceUsd).toBe("number");
          }

          // currentPriceUsd equals last point's priceUsd
          const lastPoint = result.points[result.points.length - 1];
          expect(result.currentPriceUsd).toBe(lastPoint.priceUsd);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Horizon request parameters are correct for every timeframe
// Feature: xlm-price-chart, Property 2: Horizon request parameters are correct for every timeframe
// Validates: Requirements 1.2, 1.3, 1.4
// ---------------------------------------------------------------------------

describe("Property 2: Horizon URL params correct for every timeframe", () => {
  it("resolution and time window are correct for each timeframe", async () => {
    const expectedResolution: Record<Timeframe, number> = {
      "1D":  3_600_000,
      "7D":  86_400_000,
      "30D": 86_400_000,
    };
    const expectedLookback: Record<Timeframe, number> = {
      "1D":  24 * 60 * 60 * 1000,
      "7D":  7  * 24 * 60 * 60 * 1000,
      "30D": 30 * 24 * 60 * 60 * 1000,
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Timeframe>("1D", "7D", "30D"),
        async (timeframe) => {
          global.fetch = jest.fn().mockResolvedValue(
            makeHorizonResponse([{ timestamp: 1000, close: 0.5 }]),
          );

          const before = Date.now();
          await fetchXlmPriceHistory(timeframe);
          const after = Date.now();

          const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
          const url = new URL(calledUrl);

          const resolution = Number(url.searchParams.get("resolution"));
          const startTime  = Number(url.searchParams.get("start_time"));
          const endTime    = Number(url.searchParams.get("end_time"));

          // resolution matches timeframe
          expect(resolution).toBe(expectedResolution[timeframe]);

          // start_time within 5 s tolerance
          const lookback = expectedLookback[timeframe];
          expect(startTime).toBeGreaterThanOrEqual(before - lookback - 5000);
          expect(startTime).toBeLessThanOrEqual(after  - lookback + 5000);

          // end_time ≈ Date.now()
          expect(endTime).toBeGreaterThanOrEqual(before - 5000);
          expect(endTime).toBeLessThanOrEqual(after + 5000);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Non-2xx response always throws error containing the status code
// Feature: xlm-price-chart, Property 3: Non-2xx response always throws an error containing the status code
// Validates: Requirements 1.5
// ---------------------------------------------------------------------------

describe("Property 3: non-2xx response always throws error containing status code", () => {
  it("thrown Error message contains the status code as a substring for any 300-599 status", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 300, max: 599 }),
        async (status) => {
          global.fetch = jest
            .fn()
            .mockResolvedValue(makeHorizonErrorResponse(status));

          let thrownError: unknown = null;
          try {
            await fetchXlmPriceHistory("7D");
          } catch (e) {
            thrownError = e;
          }

          expect(thrownError).toBeInstanceOf(Error);
          expect((thrownError as Error).message).toContain(String(status));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: change24hPercent round-trip
// Feature: xlm-price-chart, Property 8: change24hPercent round-trip
// Validates: Requirements 1.6
// ---------------------------------------------------------------------------

describe("Property 8: change24hPercent round-trip", () => {
  it("first * (1 + change24hPercent / 100) ≈ last within floating-point tolerance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0 }),
            close: fc.float({ min: Math.fround(0.0001), max: Math.fround(9999), noNaN: true }),
          }),
          { minLength: 2 },
        ),
        async (records) => {
          global.fetch = jest
            .fn()
            .mockResolvedValue(makeHorizonResponse(records));

          const result = await fetchXlmPriceHistory("7D");

          expect(result.change24hPercent).not.toBeNull();

          const firstPrice = result.points[0].priceUsd;
          const lastPrice  = result.points[result.points.length - 1].priceUsd;
          const computed   = firstPrice * (1 + result.change24hPercent! / 100);

          // relative error within floating-point tolerance (accounts for 32-bit float string representation)
          const relError = Math.abs(computed - lastPrice) / Math.abs(lastPrice);
          expect(relError).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });
});
