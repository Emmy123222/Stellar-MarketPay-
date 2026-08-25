"use strict";

const fc = require("fast-check");
const { normalizeMilestones } = require("./escrowService");

describe("Escrow amount calculations (property-based)", () => {
  describe("normalizeMilestones", () => {
    it("always returns an array", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              description: fc.string(),
              amount: fc.oneof(
                fc.double({ min: 0, max: 1e12, noNaN: true }),
                fc.constant(undefined),
                fc.constant(null),
              ),
              status: fc.constantFrom("pending", "released", "disputed"),
            }),
            { maxLength: 5 },
          ),
          fc.oneof(
            fc.double({ min: 0, max: 1e12, noNaN: true }),
            fc.constant(undefined),
            fc.constant(null),
          ),
          (milestones, fallback) => {
            const result = normalizeMilestones(milestones, fallback);
            return Array.isArray(result);
          },
        ),
      );
    });

    it("amounts always sum to non-negative total", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              description: fc.string(),
              amount: fc.double({ min: 0, max: 1e12, noNaN: true }),
              status: fc.constantFrom("pending", "released", "disputed"),
            }),
            { maxLength: 5 },
          ),
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          (milestones, fallback) => {
            const result = normalizeMilestones(milestones, fallback);
            const total = result.reduce(
              (sum, m) => sum + parseFloat(m.amount),
              0,
            );
            return total >= 0;
          },
        ),
      );
    });

    it("no negative amounts", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              description: fc.string(),
              amount: fc.double({ min: 0, max: 1e12, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          (milestones, fallback) => {
            const result = normalizeMilestones(milestones, fallback);
            return result.every((m) => parseFloat(m.amount) >= 0);
          },
        ),
      );
    });

    it("amounts are strings formatted to 7 decimal places", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              description: fc.string(),
              amount: fc.double({ min: 0, max: 1e12, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          (milestones, fallback) => {
            const result = normalizeMilestones(milestones, fallback);
            return result.every(
              (m) =>
                typeof m.amount === "string" &&
                /^\d+\.\d{7}$/.test(m.amount),
            );
          },
        ),
      );
    });

    it("returns fallback milestone for empty milestones", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          (fallback) => {
            const result = normalizeMilestones([], fallback);
            return (
              result.length === 1 &&
              parseFloat(result[0].amount) ===
                parseFloat(parseFloat(fallback || 0).toFixed(7))
            );
          },
        ),
      );
    });

    it("treats null/undefined/NaN amounts as zero", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              description: fc.string(),
              amount:             fc.constantFrom(null, undefined),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          (milestones) => {
            const result = normalizeMilestones(milestones, "100");
            return result.every((m) => parseFloat(m.amount) === 0);
          },
        ),
      );
    });
  });

  describe("milestone sum for referral payout", () => {
    it("sum of parsed amounts equals expected total within tolerance", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 0, max: 1e12, noNaN: true }),
            { minLength: 1, maxLength: 5 },
          ),
          (amounts) => {
            const formatted = amounts.map((a) => a.toFixed(7));
            const sum = formatted.reduce(
              (s, a) => s + parseFloat(a),
              0,
            );
            const expected = amounts.reduce((s, a) => s + a, 0);
            return Math.abs(sum - expected) < 1e-6;
          },
        ),
      );
    });

    it("total milestone sum never goes negative", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 0, max: 1e12, noNaN: true }),
            { minLength: 1, maxLength: 5 },
          ),
          (amounts) => {
            const sum = amounts
              .map((a) => a.toFixed(7))
              .reduce((s, a) => s + parseFloat(a), 0);
            return sum >= 0;
          },
        ),
      );
    });
  });

  describe("toFixed(7) rounding consistency", () => {
    it("toFixed(7) is idempotent through parseFloat round-trip", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          (value) => {
            const first = parseFloat(value).toFixed(7);
            const parsed = parseFloat(first);
            const second = parsed.toFixed(7);
            return first === second;
          },
        ),
      );
    });

    it("parseFloat(toFixed(7)) never produces NaN", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: 0, max: 1e12 }),
            fc.constant(undefined),
            fc.constant(null),
          ),
          (value) => {
            const result = parseFloat(value || 0).toFixed(7);
            return !isNaN(parseFloat(result));
          },
        ),
      );
    });
  });
});
