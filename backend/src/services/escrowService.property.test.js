"use strict";

const fc = require("fast-check");
const {
  normalizeMilestones,
  validateCreateEscrowPayload,
} = require("./escrowService");

// Keep this suite hermetic (Issue #1484): the pure functions under test
// (normalizeMilestones, validateCreateEscrowPayload) never use jobService,
// so stub it out instead of loading the heavy DB-coupled module. The stub
// also shields the property suite from parse/runtime failures inside
// jobService itself, which currently break every suite that loads it.
jest.mock("./jobService", () => ({
  getJob: jest.fn(),
  recordTimelineEvent: jest.fn(),
}));

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

// ─── Adversarial create_escrow payloads (Issue #1484) ───────────────────────
//
// The properties above generate only valid happy-path inputs; this suite
// feeds adversarial permutations — zero amounts, clients equal to
// freelancers, zero-address tokens — through `validateCreateEscrowPayload`,
// the backend's pre-flight mirror of the contract's `create_escrow` gate.

describe("Adversarial create_escrow payloads (property-based)", () => {
  // Stellar-style addresses: `G`/`C` + 55 base32 characters.
  const gAddress = () => fc.stringMatching(/^G[A-Z2-7]{55}$/);
  const cAddress = () => fc.stringMatching(/^C[A-Z2-7]{55}$/);

  const AMOUNT_ERROR = "Amount must be positive";
  const PARTICIPANT_ERROR_PREFIX = "InvalidParticipants";
  const TOKEN_ERROR_PATTERN = /token address/i;

  /** A payload that passes every validation gate. */
  const validPayload = () =>
    fc.record({
      client: gAddress(),
      freelancer: gAddress(),
      token: cAddress(),
      amount: fc.oneof(
        fc.double({ min: 0.01, max: 1e12, noNaN: true }),
        fc.double({ min: 0.01, max: 1e12, noNaN: true }).map(String),
        fc.integer({ min: 1, max: 1_000_000_000 }).map(String),
      ),
    });

  /** Amount values that must always be rejected with the canonical error. */
  const invalidAmounts = () =>
    fc.oneof(
      fc.constant(0),
      fc.constant("0"),
      fc.constant("0.0000000"),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(NaN),
      fc.constant(false),
      fc.constant(""),
      fc.constant("free"),
      fc.constant("12.9.9"),
      fc.integer({ max: -1 }),
      fc.double({ max: -0.0000001, noNaN: true }),
    );

  /** Zero-address token spellings (plus null/undefined payload fields). */
  const zeroTokens = () =>
    fc.constantFrom(
      "",
      "0",
      "0x0",
      `0x${"0".repeat(40)}`,
      "0".repeat(64),
      `0x${"0".repeat(64)}`,
      `  ${"0".repeat(64)} `,
      null,
      undefined,
    );

  /**
   * Models the submit pipeline: validation runs FIRST, and a transfer is
   * only ever executed when validation passed. Returns everything that
   * happened so properties can assert *ordering* (error before transfer).
   */
  const runCreateEscrowPipeline = (payload) => {
    const transfers = [];
    const error = validateCreateEscrowPayload(payload);
    if (error) return { ok: false, error, transfers };
    transfers.push({
      from: payload.client,
      to: "contract-vault",
      amount: payload.amount,
    });
    return { ok: true, error: null, transfers };
  };

  const isKnownError = (err) =>
    err === AMOUNT_ERROR ||
    err.startsWith(PARTICIPANT_ERROR_PREFIX) ||
    TOKEN_ERROR_PATTERN.test(err);

  it("control: standard valid payloads always pass validation", () => {
    fc.assert(
      fc.property(validPayload(), (payload) => {
        return validateCreateEscrowPayload(payload) === null;
      }),
    );
  });

  it("amount == 0 returns a clean create_escrow error string, never a throw", () => {
    fc.assert(
      fc.property(validPayload(), invalidAmounts(), (base, badAmount) => {
        const err = validateCreateEscrowPayload({ ...base, amount: badAmount });
        return typeof err === "string" && err === AMOUNT_ERROR;
      }),
    );
  });

  it("client == freelancer returns an explicit InvalidParticipants error", () => {
    fc.assert(
      fc.property(validPayload(), gAddress(), (base, shared) => {
        const err = validateCreateEscrowPayload({
          ...base,
          client: shared,
          freelancer: shared,
        });
        return (
          typeof err === "string" && err.startsWith(PARTICIPANT_ERROR_PREFIX)
        );
      }),
    );
  });

  it("zero-address token payload errors before any asset transfer runs", () => {
    fc.assert(
      fc.property(validPayload(), zeroTokens(), (base, token) => {
        const result = runCreateEscrowPipeline({ ...base, token });
        return (
          result.ok === false &&
          typeof result.error === "string" &&
          TOKEN_ERROR_PATTERN.test(result.error) &&
          result.transfers.length === 0
        );
      }),
    );
  });

  it("control: a valid payload executes exactly one transfer", () => {
    fc.assert(
      fc.property(validPayload(), (payload) => {
        const result = runCreateEscrowPipeline(payload);
        return (
          result.ok === true &&
          result.error === null &&
          result.transfers.length === 1 &&
          result.transfers[0].from === payload.client
        );
      }),
    );
  });

  it("adversarial permutations yield a known error (or null for none) — never a throw", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          validPayload(),
          invalidAmounts(),
          gAddress(),
          zeroTokens(),
          fc.record({
            badAmount: fc.boolean(),
            sameParticipants: fc.boolean(),
            zeroToken: fc.boolean(),
          }),
        ),
        ([base, badAmount, shared, zeroToken, faults]) => {
          const payload = { ...base };
          if (faults.badAmount) payload.amount = badAmount;
          if (faults.sameParticipants) {
            payload.client = shared;
            payload.freelancer = shared;
          }
          if (faults.zeroToken) payload.token = zeroToken;

          const err = validateCreateEscrowPayload(payload);
          const anyFault =
            faults.badAmount || faults.sameParticipants || faults.zeroToken;
          if (!anyFault) return err === null;
          return typeof err === "string" && isKnownError(err);
        },
      ),
    );
  });

  it("never throws for arbitrary malformed payload shapes (no thread panic)", () => {
    fc.assert(
      fc.property(
        fc.record({
          client: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined),
            gAddress(),
          ),
          freelancer: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined),
            gAddress(),
          ),
          token: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined),
            cAddress(),
          ),
          amount: fc.oneof(
            fc.string(),
            fc.double({ noNaN: true }),
            fc.constant(null),
            fc.constant(undefined),
            fc.constantFrom(0, -1, NaN, "0", "abc"),
          ),
        }),
        (payload) => {
          const err = validateCreateEscrowPayload(payload);
          return err === null || typeof err === "string";
        },
      ),
    );
  });
});
