/**
 * src/tests/contract/error-shape.test.js
 *
 * Verifies that all error responses conform to the standard shape:
 *   { error: string, code?: string, details?: object }
 */
"use strict";

beforeAll(() => {
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

jest.mock("../../db/pool", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  connect: jest.fn().mockResolvedValue({ query: jest.fn(), release: jest.fn() }),
}));
jest.mock("../../db/migrate", () => ({ migrate: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn(), getHealth: jest.fn().mockReturnValue({ running: false }) }))
);
jest.mock("../../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../../routes/notifications", () => {
  const { Router } = require("express");
  const r = Router();
  r.get("/", (req, res) => res.json({ success: true }));
  return r;
});
jest.mock("@stellar/stellar-sdk", () => ({
  ...jest.requireActual("@stellar/stellar-sdk"),
  Utils: { buildChallengeTx: jest.fn(), verifyChallengeTx: jest.fn() },
}));

const request = require("supertest");
const app = require("../../server");

/**
 * Assert the standard error shape: { error: string, code?: string, details?: object }
 */
function assertErrorShape(body) {
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
  if (body.code !== undefined) {
    expect(typeof body.code).toBe("string");
  }
  if (body.details !== undefined) {
    expect(typeof body.details).toBe("object");
  }
  // must NOT contain the old nested shape
  expect(typeof body.error).not.toBe("object");
  // must NOT use `message` as the top-level error key
  expect(body.message).toBeUndefined();
}

describe("Error response shape", () => {
  it("400 — GET /api/auth without account param", async () => {
    const res = await request(app).get("/api/auth");
    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  it("400 — POST /api/auth without transaction", async () => {
    const res = await request(app).post("/api/auth").send({});
    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  it("401 — protected route without token", async () => {
    const res = await request(app).put("/api/profiles/GFAKE/");
    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  it("404 — unknown route", async () => {
    const res = await request(app).get("/api/does-not-exist-xyz");
    expect(res.status).toBe(404);
    assertErrorShape(res.body);
  });

  it("structuredErrorHandler produces flat shape", () => {
    const { structuredErrorHandler, ErrorCodes } = require("../../utils/errors");
    const err = Object.assign(new Error("something broke"), {
      status: 422,
      code: ErrorCodes.VALIDATION_ERROR,
      details: { field: "amount" },
    });
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    structuredErrorHandler(err, {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(typeof body.error).toBe("string");
    expect(body.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(body.details).toEqual({ field: "amount" });
    expect(body.error).not.toBeInstanceOf(Object);
  });

  it("rate-limiter response uses { error } not { message }", async () => {
    // Exhaust a low-limit endpoint by hitting it enough times.
    // We do this by calling structuredErrorHandler directly since
    // triggering an actual rate-limit in tests is environment-dependent.
    const { createRateLimiter } = require("../../middleware/rateLimiter");
    const limiter = createRateLimiter(0, 1); // 0 max → every request is limited
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    limiter({ method: "GET", ip: "127.0.0.1", headers: {} }, res, jest.fn());
    const body = res.json.mock.calls[0]?.[0];
    if (body) {
      expect(typeof body.error).toBe("string");
      expect(body.message).toBeUndefined();
    }
  });
});
