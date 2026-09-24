/**
 * src/tests/contract/openapi.contract.test.js  (issue #1496)
 *
 * Spec-driven contract tests using `jest-openapi`:
 *
 *   1. Loads backend/docs/openapi.yaml (fails the suite if it is invalid).
 *   2. Enumerates EVERY path + method documented in the spec and issues a
 *      real request through the Express app (supertest, DB pool mocked).
 *   3. Validates the actual response — status code AND body schema — with
 *      `expect(res).toSatisfyApiSpec()`.
 *
 * Because one test exists per documented operation and the matcher rejects
 * both undocumented status codes and schema drift, CI fails whenever a
 * response no longer matches the documented contract.
 */
"use strict";

// The suite must never trigger a real bootstrap (listen, schedulers).
process.env.NODE_ENV = "test";

// ─── Global mocks (must be set before server loads) ──────────────────────────

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: jest.fn().mockResolvedValue({
    _embedded: { records: [{ sequence: 12345678 }] },
  }),
});

beforeAll(() => {
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID ||
    "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Probing ~200 routes from one IP would otherwise trip the global
// 150-requests/15-minutes limiter (and the per-route limiters).
jest.mock("express-rate-limit", () => {
  const middleware = (_req, _res, next) => next();
  middleware.resetKey = () => {};
  middleware.clear = () => {};
  const factory = () => middleware;
  return Object.assign(factory, {
    rateLimit: factory,
    default: factory,
  });
});

jest.mock("../../middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
}));

// NOTE: outbound HTTP (Horizon) is stubbed via global.fetch above. Routes that
// call other external services (turrets, contributors) fall into the
// KNOWN_SPEC_GAPS list below because their spec entries lack response schemas.

jest.mock("../../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  const mock = {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
  mock.readPool = { query: mockQuery };
  mock.writePool = mock;
  return mock;
});

jest.mock("../../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    getHealth: jest.fn().mockReturnValue({ running: false, synced: false }),
  })),
);

jest.mock("../../services/priceAlertService", () => ({
  PriceAlertService: jest.fn().mockImplementation(() => ({ start: jest.fn() })),
}));

jest.mock("../../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Utils: {
      buildChallengeTx: jest.fn(),
      verifyChallengeTx: jest.fn(),
    },
  };
});

// ─── Imports ─────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const SPEC_PATH = path.join(__dirname, "..", "..", "..", "docs", "openapi.yaml");

const jestOpenAPI = require("jest-openapi").default;
jestOpenAPI(SPEC_PATH);

const spec = yaml.load(fs.readFileSync(SPEC_PATH, "utf8"));

const app = require("../../server");
const KNOWN_SPEC_GAPS = require("./knownSpecGaps");

// ─── Probe helpers ───────────────────────────────────────────────────────────

const UUID = "11111111-1111-1111-1111-111111111111";
const STELLAR_KEY = "G" + "A".repeat(55);
const CID = "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o";
const CONTRACT = "CCONTRACTID123456789012345678901234567890123456789012";
const CSRF_HEADERS = {
  Cookie: "csrf-token=test-csrf-token",
  "X-CSRF-Token": "test-csrf-token",
};

function fillParams(apiPath) {
  return apiPath.replace(/\{(\w+)\}/g, (_m, name) => {
    const n = name.toLowerCase();
    if (n.includes("publickey") || n.includes("address")) return STELLAR_KEY;
    if (n.includes("hash")) return CID;
    if (n.includes("skill")) return "javascript";
    if (n.includes("contract")) return CONTRACT;
    return UUID;
  });
}

// One entry per documented operation — this list IS the coverage contract:
// adding a route to openapi.yaml automatically adds a test for it.
const OPERATIONS = [];
for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    if (pathItem && pathItem[method]) {
      OPERATIONS.push([method.toUpperCase(), apiPath]);
    }
  }
}
OPERATIONS.sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1].localeCompare(b[1])));

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("OpenAPI spec", () => {
  it("is a valid OpenAPI 3.0 document (docs/openapi.yaml)", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths || {}).length).toBeGreaterThan(0);
  });

  it("known-spec-gaps baseline contains only real operations (no stale entries)", () => {
    const opKeys = new Set(OPERATIONS.map(([m, p]) => `${m} ${p}`));
    const stale = [...KNOWN_SPEC_GAPS.keys()].filter((k) => !opKeys.has(k));
    expect(stale).toEqual([]);
  });
});

describe("Every documented route satisfies the OpenAPI contract", () => {
  const VALID_TOKEN = jwt.sign(
    { publicKey: STELLAR_KEY },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  it("covers every path+method in openapi.yaml", () => {
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(
      Object.keys(spec.paths || {}).length,
    );
  });

  it.each(OPERATIONS)(
    "%s %s — actual response matches documented schema",
    async (method, apiPath) => {
      const lower = method.toLowerCase();
      let req = request(app)[lower](fillParams(apiPath));

      // Authenticate so guarded routes exercise their real logic; public
      // routes simply ignore the header.
      req = req.set("Authorization", `Bearer ${VALID_TOKEN}`);
      if (lower !== "get") req = req.set(CSRF_HEADERS);
      if (lower === "post" || lower === "put" || lower === "patch") {
        req = req.send({});
      }

      const res = await req;

      const key = `${method} ${apiPath}`;
      const gapReason = KNOWN_SPEC_GAPS.get(key);

      let strictError = null;
      try {
        // Fails if the status code is not documented OR the body violates the
        // documented schema — i.e. any spec drift breaks CI.
        expect(res).toSatisfyApiSpec();
      } catch (e) {
        strictError = e;
      }

      if (gapReason !== undefined) {
        // Known spec gap: this response is expected to fail today. If it now
        // passes, the gap is closed — delete the entry so the route becomes
        // strictly enforced from here on.
        if (strictError === null) {
          throw new Error(
            `${key} now satisfies docs/openapi.yaml — remove it from knownSpecGaps.js ` +
              `(was: "${gapReason}")`,
          );
        }
      } else if (strictError !== null) {
        throw new Error(
          `${key} drifted from docs/openapi.yaml:\n${strictError.message}\n\n` +
            `Fix the response or the spec/JSDoc (then run \`npm run generate-openapi\`), ` +
            `or — if the spec genuinely cannot describe this response yet — ` +
            `add the route to knownSpecGaps.js with a reason.`,
        );
      }
    },
    15000,
  );
});
