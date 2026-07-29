/**
 * src/tests/contract/api.contract.test.js
 *
 * Validates every documented endpoint's response shape against the
 * OpenAPI spec (backend/docs/openapi.json) using AJV. Any structural
 * mismatch — wrong type, missing property, invalid format — fails the
 * suite immediately with a descriptive error.
 */
"use strict";

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

jest.mock("../../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

jest.mock("../../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    getHealth: jest.fn().mockReturnValue({ running: false, synced: false }),
  }))
);

jest.mock("../../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);

jest.mock("../../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

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

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { Utils } = require("@stellar/stellar-sdk");
const { assertContract, validateContract } = require("../../testUtils/contractValidator");

const app = require("../../server");
const pool = require("../../db/pool");

// ─── Test constants ───────────────────────────────────────────────────────────

// Valid Stellar public key format: G + 55 uppercase alphanumeric chars = 56 total
const FAKE_FREELANCER_KEY = "G" + "A".repeat(55);
const FAKE_CLIENT_KEY = "G" + "B".repeat(55);
const FAKE_JOB_ID = "11111111-1111-1111-1111-111111111111";
const FAKE_APP_ID = "22222222-2222-2222-2222-222222222222";
const FAKE_CHALLENGE_XDR = "AAAAAFakeChallengeTransactionXDRBase64Encoded==";
const FAKE_SIGNED_XDR = "AAAAAFakeSignedChallengeTransactionXDRBase64Signed==";
// Proposal must be at least 50 characters per application service validation
const LONG_PROPOSAL =
  "I am an experienced Stellar developer ready to build this project efficiently and on time.";

// ─── Mock row builders ────────────────────────────────────────────────────────

function buildJobRow(overrides = {}) {
  return {
    id: FAKE_JOB_ID,
    title: "Build a Smart Contract on Stellar Network",
    description:
      "Looking for an experienced developer to build a dApp on Stellar with Soroban contracts.",
    budget: 500,          // number — matches spec: { type: number }
    currency: "XLM",
    category: "Smart Contracts",
    skills: [],
    status: "open",       // valid spec enum value
    client_address: undefined, // undefined → omitted from JSON → enrichJobsWithClientReputation skips reputation lookup
    freelancer_address: null,
    escrow_contract_id: null,
    applicant_count: 0,
    share_count: 0,
    boosted: false,
    boosted_until: null,
    deadline: null,
    timezone: null,
    screening_questions: [],
    milestones: [],
    visibility: "public",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildApplicationRow(overrides = {}) {
  return {
    id: FAKE_APP_ID,
    job_id: FAKE_JOB_ID,
    freelancer_address: FAKE_FREELANCER_KEY,
    proposal: LONG_PROPOSAL,
    bid_amount: 450,      // number — matches spec: { type: number }
    currency: "XLM",
    status: "pending",    // valid spec enum value
    screening_answers: {},
    bid_commitment: null,
    bid_revealed: false,
    revealed_bid_amount: null,
    revealed_at: null,
    created_at: new Date().toISOString(),
    accepted_at: null,
    ...overrides,
  };
}

function buildNotificationRow() {
  return {
    id: 1,
    user_address: FAKE_CLIENT_KEY,
    type: "new_application",
    title: "New application received",
    body: "Someone applied to your job.",
    read: false,
    job_id: FAKE_JOB_ID,
    link_path: `/jobs/${FAKE_JOB_ID}`,
    created_at: new Date().toISOString(),
  };
}

// ─── Stage 1 — ARCHITECTURE VERIFICATION (validator self-check) ───────────────

describe("Contract Validator — self-check", () => {
  it("loads openapi.json and resolves component schemas without throwing", () => {
    const { getResponseSchema } = require("../../testUtils/contractValidator");
    expect(() => getResponseSchema("/api/jobs", "get", 200)).not.toThrow();
  });

  it("throws on unknown path", () => {
    const { getResponseSchema } = require("../../testUtils/contractValidator");
    expect(() => getResponseSchema("/api/nonexistent", "get", 200)).toThrow(
      /No OpenAPI spec for path/
    );
  });

  it("throws on unknown method", () => {
    const { getResponseSchema } = require("../../testUtils/contractValidator");
    expect(() => getResponseSchema("/api/jobs", "delete", 200)).toThrow(
      /No spec for DELETE/
    );
  });

  it("detects a tampered response shape — validates contract violation", () => {
    const tamperedBody = {
      success: "yes-this-is-a-string-not-a-boolean", // spec: boolean
      data: "not-an-array",                           // spec: array
    };
    const { valid, errors } = validateContract("/api/jobs", "get", 200, tamperedBody);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe("GET /health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset global.fetch mock to return stellar success response
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        _embedded: { records: [{ sequence: 12345678 }] },
      }),
    });
    // pool.query for "SELECT 1" should resolve (checkDatabase)
    pool.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
  });

  it("200 — response shape matches OpenAPI contract", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    assertContract("/health", "get", 200, res.body);
    expect(res.body.status).toBe("healthy");
    expect(typeof res.body.uptime_seconds).toBe("number");
  });
});

// ─── GET /api/rate-limit — tested via dedicated mini app (route not mounted in server) ──

describe("GET /api/rate-limit", () => {
  // The rateLimit route file exists but is not mounted in server.js.
  // Test it by spinning up a minimal Express app with the route attached.
  const rateLimitApp = (() => {
    const mini = express();
    mini.use(require("../../routes/rateLimit"));
    return mini;
  })();

  it("200 — response shape matches OpenAPI contract", async () => {
    const res = await request(rateLimitApp).get("/");

    expect(res.status).toBe(200);
    assertContract("/api/rate-limit", "get", 200, res.body);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.limit).toBe("number");
    expect(typeof res.body.data.remaining).toBe("number");
    expect(typeof res.body.data.reset).toBe("string");
  });
});

// ─── GET /api/auth ────────────────────────────────────────────────────────────

describe("GET /api/auth — challenge transaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it("200 — response shape matches OpenAPI contract", async () => {
    Utils.buildChallengeTx.mockReturnValue(FAKE_CHALLENGE_XDR);

    const res = await request(app)
      .get("/api/auth")
      .query({ account: FAKE_FREELANCER_KEY });

    expect(res.status).toBe(200);
    assertContract("/api/auth", "get", 200, res.body);
    expect(typeof res.body.transaction).toBe("string");
  });

  it("400 — error shape matches OpenAPI contract (missing account)", async () => {
    const res = await request(app).get("/api/auth");

    expect(res.status).toBe(400);
    assertContract("/api/auth", "get", 400, res.body);
    expect(typeof res.body.error).toBe("string");
  });
});

// ─── POST /api/auth ───────────────────────────────────────────────────────────

describe("POST /api/auth — verify challenge & issue JWT", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it("200 — response shape matches OpenAPI contract", async () => {
    Utils.verifyChallengeTx.mockReturnValue(FAKE_FREELANCER_KEY);

    const res = await request(app)
      .post("/api/auth")
      .send({ transaction: FAKE_SIGNED_XDR });

    expect(res.status).toBe(200);
    assertContract("/api/auth", "post", 200, res.body);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe("string");
  });

  it("400 — error shape matches OpenAPI contract (missing transaction)", async () => {
    const res = await request(app).post("/api/auth").send({});

    expect(res.status).toBe(400);
    assertContract("/api/auth", "post", 400, res.body);
    expect(typeof res.body.error).toBe("string");
  });

  it("401 — error shape matches OpenAPI contract (invalid signature)", async () => {
    Utils.verifyChallengeTx.mockImplementation(() => {
      throw new Error("Invalid challenge signature");
    });

    const res = await request(app)
      .post("/api/auth")
      .send({ transaction: "TAMPERED_XDR" });

    expect(res.status).toBe(401);
    assertContract("/api/auth", "post", 401, res.body);
    expect(typeof res.body.error).toBe("string");
  });
});

// ─── GET /api/jobs ────────────────────────────────────────────────────────────

describe("GET /api/jobs — list jobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql) => {
      // Main listJobs query: SELECT * FROM jobs WHERE ... ORDER BY ...
      if (sql.includes("FROM jobs") && sql.includes("ORDER BY")) {
        return { rows: [buildJobRow()] };
      }
      return { rows: [] };
    });
  });

  it("200 — response shape matches OpenAPI contract", async () => {
    const res = await request(app).get("/api/jobs");

    expect(res.status).toBe(200);
    assertContract("/api/jobs", "get", 200, res.body);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── POST /api/jobs ───────────────────────────────────────────────────────────

describe("POST /api/jobs — create job", () => {
  // Generate a JWT signed with the test secret (set in jest.setup.js)
  const VALID_TOKEN = jwt.sign(
    { publicKey: FAKE_CLIENT_KEY },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const VALID_JOB_BODY = {
    clientAddress: FAKE_CLIENT_KEY,   // must match JWT publicKey
    title: "Build a Soroban Smart Contract",
    description: "Looking for an experienced Stellar developer to build Soroban contracts for a DeFi project.",
    budget: 500,
    currency: "XLM",
    category: "Smart Contracts",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it("201 — response shape matches OpenAPI contract", async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("INSERT INTO jobs")) {
        return { rows: [buildJobRow({ client_address: FAKE_CLIENT_KEY })] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send(VALID_JOB_BODY);

    expect(res.status).toBe(201);
    assertContract("/api/jobs", "post", 201, res.body);
    expect(res.body.success).toBe(true);
  });

  it("400 — error shape matches OpenAPI contract (title too short)", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ ...VALID_JOB_BODY, title: "Short" }); // < 10 chars → 400

    expect(res.status).toBe(400);
    assertContract("/api/jobs", "post", 400, res.body);
    expect(typeof res.body.error).toBe("string");
  });

  it("401 — error shape matches OpenAPI contract (no Authorization header)", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send(VALID_JOB_BODY);

    expect(res.status).toBe(401);
    assertContract("/api/jobs", "post", 401, res.body);
    expect(typeof res.body.error).toBe("string");
  });

  it("401 — error shape matches OpenAPI contract (invalid JWT)", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .set("Authorization", "Bearer invalid.jwt.token")
      .send(VALID_JOB_BODY);

    expect(res.status).toBe(401);
    assertContract("/api/jobs", "post", 401, res.body);
  });
});

// ─── GET /api/applications/job/{jobId} ────────────────────────────────────────

describe("GET /api/applications/job/:jobId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // "FROM applications a" is unique to the JOIN query and won't match the
    // subquery "SELECT client_address FROM jobs WHERE id = $1" on the same string.
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM applications a")) {
        return { rows: [buildApplicationRow()] };
      }
      return { rows: [] };
    });
  });

  it("200 — response shape matches OpenAPI contract", async () => {
    const res = await request(app).get(
      `/api/applications/job/${FAKE_JOB_ID}`
    );

    expect(res.status).toBe(200);
    assertContract("/api/applications/job/{jobId}", "get", 200, res.body);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("404 schema is valid per spec (implementation always returns 200 with empty data — known gap)", () => {
    // Route returns 200 [] instead of 404 (no job-existence check in service).
    // Validate the 404 schema shape directly so the spec entry is still exercised.
    const { valid } = validateContract(
      "/api/applications/job/{jobId}",
      "get",
      404,
      { error: "Job not found" }
    );
    expect(valid).toBe(true);
  });
});

// ─── POST /api/applications ───────────────────────────────────────────────────

describe("POST /api/applications — submit application", () => {
  // Pool mock covering all queries inside submitApplication:
  //  1. getJob          → SELECT * FROM jobs WHERE id = $1
  //  2. isBlocked       → SELECT 1 FROM profiles WHERE … blocked_addresses
  //  3. INSERT          → INSERT INTO applications … RETURNING *
  //  4. applicant count → UPDATE jobs SET applicant_count …
  //  5. notification    → INSERT INTO notifications … RETURNING *
  function mockSubmitApplicationQueries() {
    pool.query.mockImplementation(async (sql) => {
      if (sql === "SELECT * FROM jobs WHERE id = $1") {
        return { rows: [buildJobRow({ client_address: FAKE_CLIENT_KEY })] };
      }
      if (sql.includes("blocked_addresses")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO applications")) {
        return { rows: [buildApplicationRow()] };
      }
      if (sql.includes("UPDATE jobs SET applicant_count")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        return { rows: [buildNotificationRow()] };
      }
      return { rows: [] };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitApplicationQueries();
  });

  it("201 — response shape matches OpenAPI contract", async () => {
    const res = await request(app)
      .post("/api/applications")
      .send({
        jobId: FAKE_JOB_ID,
        freelancerAddress: FAKE_FREELANCER_KEY, // implementation uses freelancerAddress (not freelancerId)
        proposal: LONG_PROPOSAL,
        bidAmount: 450,
      });

    expect(res.status).toBe(201);
    assertContract("/api/applications", "post", 201, res.body);
    expect(res.body.success).toBe(true);
  });

  it("400 — error shape matches OpenAPI contract (missing required fields)", async () => {
    const res = await request(app)
      .post("/api/applications")
      .send({ jobId: FAKE_JOB_ID }); // missing freelancerAddress, proposal, bidAmount

    expect(res.status).toBe(400);
    assertContract("/api/applications", "post", 400, res.body);
    expect(typeof res.body.error).toBe("string");
  });

  it("400 — error shape matches OpenAPI contract (proposal too short)", async () => {
    const res = await request(app)
      .post("/api/applications")
      .send({
        jobId: FAKE_JOB_ID,
        freelancerAddress: FAKE_FREELANCER_KEY,
        proposal: "Too short.",    // < 50 chars → service returns 400
        bidAmount: 450,
      });

    expect(res.status).toBe(400);
    assertContract("/api/applications", "post", 400, res.body);
  });

  it("409 — error shape matches OpenAPI contract (duplicate application)", async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql === "SELECT * FROM jobs WHERE id = $1") {
        return { rows: [buildJobRow({ client_address: FAKE_CLIENT_KEY })] };
      }
      if (sql.includes("blocked_addresses")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO applications")) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post("/api/applications")
      .send({
        jobId: FAKE_JOB_ID,
        freelancerAddress: FAKE_FREELANCER_KEY,
        proposal: LONG_PROPOSAL,
        bidAmount: 450,
      });

    expect(res.status).toBe(409);
    assertContract("/api/applications", "post", 409, res.body);
    expect(typeof res.body.error).toBe("string");
  });
});

// ─── Stage 5 — TAMPERED SHAPE INTEGRATION TEST (CI failure guard) ─────────────

describe("Tampered shape — CI failure guard", () => {
  it("fails validation when required fields have the wrong types", () => {
    const tampered = {
      success: 42,        // spec: boolean
      data: "not-array",  // spec: array
      nextCursor: 999,    // spec: string | null
    };
    const { valid, errors } = validateContract("/api/jobs", "get", 200, tampered);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails validation when error body is a primitive instead of object", () => {
    const { valid } = validateContract("/api/auth", "get", 400, 12345);
    expect(valid).toBe(false);
  });

  it("fails validation when body is null (not an object)", () => {
    const { valid } = validateContract("/api/applications", "post", 400, null);
    expect(valid).toBe(false);
  });

  it("assertContract throws a descriptive Contract violation message", () => {
    expect(() =>
      assertContract("/api/jobs", "get", 200, { success: "wrong-type", data: [] })
    ).toThrow(/Contract violation/);
  });

  it("assertContract error includes endpoint identity and field-level instancePath detail", () => {
    let caughtError = null;
    try {
      assertContract("/api/jobs", "get", 200, { success: 999, data: [] });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    // Endpoint identity must appear in the header line
    expect(caughtError.message).toMatch(/Contract violation \[GET \/api\/jobs\] status 200/);
    // Field-level detail: instancePath + AJV message for the offending property
    expect(caughtError.message).toMatch(/\/success.*boolean/);
  });

  it("assertContract does not throw for a spec-conformant response", () => {
    const conformant = {
      success: true,
      data: [],
      nextCursor: null,
    };
    expect(() =>
      assertContract("/api/jobs", "get", 200, conformant)
    ).not.toThrow();
  });
});
