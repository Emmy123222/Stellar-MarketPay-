/**
 * src/tests/escrow.verify-freelancer.test.js
 *
 * Regression tests for POST /api/escrow/verify-freelancer.
 *
 * Covers:
 *   200 + exists:true for a funded testnet account
 *   400 for a malformed address
 *   400 when Horizon returns 404
 */
"use strict";

// ─── Global mocks ────────────────────────────────────────────────

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: jest.fn().mockResolvedValue({
    _embedded: { records: [{ sequence: 12345678 }] },
  }),
});

beforeAll(() => {
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
});

// ─── Module mocks ────────────────────────────────────────────────

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

jest.mock("../../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
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

// ─── Imports ─────────────────────────────────────────────────────

const request = require("supertest");
const app = require("../../server");

// ─── Constants ───────────────────────────────────────────────────

const VALID_FREELANCER = "G" + "A".repeat(55);
const MALFORMED_ADDRESS = "invalid-address";

// ─── Tests ───────────────────────────────────────────────────────

describe("POST /api/escrow/verify-freelancer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — returns exists:true for a funded account", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        _embedded: { records: [{ sequence: 12345678 }] },
      }),
    });

    const res = await request(app)
      .post("/api/escrow/verify-freelancer")
      .send({ freelancerAddress: VALID_FREELANCER });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exists).toBe(true);
    expect(res.body.data.freelancerAddress).toBe(VALID_FREELANCER);
  });

  it("400 — malformed address returns error", async () => {
    const res = await request(app)
      .post("/api/escrow/verify-freelancer")
      .send({ freelancerAddress: MALFORMED_ADDRESS });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("400 — Horizon 404 returns error", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({}),
    });

    const res = await request(app)
      .post("/api/escrow/verify-freelancer")
      .send({ freelancerAddress: VALID_FREELANCER });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("400 — missing freelancerAddress returns error", async () => {
    const res = await request(app)
      .post("/api/escrow/verify-freelancer")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });
});
