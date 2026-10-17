/**
 * Route-availability smoke tests (Issue #1768)
 *
 * Confirms that the WebAuthn and Admin 2FA routers are mounted in server.js
 * and reachable at their documented prefixes.  No real DB or crypto is needed:
 * we only assert that the server returns something other than 404 (Not Found),
 * which proves the routes are wired up.
 *
 * Endpoints probed:
 *   POST /api/webauthn/login/begin   -- public, body-validated -> 400 on bad input
 *   GET  /api/admin/2fa/status       -- JWT-protected -> 401 without a token
 */
"use strict";

const request = require("supertest");

// Prevent the server bootstrap (DB migrate, indexer, etc.) from running.
process.env.NODE_ENV = "test";

const app = require("../../server");

describe("Route availability -- WebAuthn router mounted at /api/webauthn", () => {
  it("POST /api/webauthn/login/begin returns 400 (not 404) for missing publicKey", async () => {
    const res = await request(app)
      .post("/api/webauthn/login/begin")
      .send({}) // intentionally omit publicKey -> triggers validation error
      .set("Content-Type", "application/json");

    // 400 = router is mounted and the handler ran input validation.
    // Anything except 404 (route not found) proves the mount exists.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
  });

  it("GET /api/webauthn/credentials returns 401 (not 404) without a JWT", async () => {
    const res = await request(app).get("/api/webauthn/credentials");

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });
});

describe("Route availability -- Admin 2FA router mounted at /api/admin/2fa", () => {
  it("GET /api/admin/2fa/status returns 401 (not 404) without a JWT", async () => {
    const res = await request(app).get("/api/admin/2fa/status");

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/2fa/setup returns 401 (not 404) without a JWT", async () => {
    const res = await request(app)
      .post("/api/admin/2fa/setup")
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });
});
