"use strict";

/**
 * backend/tests/csrf.test.js
 *
 * CSRF protection tests for issue #451.
 *
 * Verifies the double-submit cookie pattern enforced by
 * `backend/src/middleware/csrf.js`:
 *
 *   - `GET /api/auth/csrf-token` issues a token + sets the `csrf-token` cookie.
 *   - State-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) without
 *     `X-CSRF-Token` are rejected with `403 Forbidden`.
 *   - State-mutating requests with a mismatched token are rejected with 403.
 *   - State-mutating requests with matching cookie + header pass CSRF.
 *   - Safe methods (`GET`) bypass CSRF.
 *   - Bootstrap routes (`/api/auth/*`, `/metrics`, `/health`,
 *     `/api/public/*`, `/api/developer/*`) bypass CSRF.
 */

const request = require("supertest");
const app = require("../src/server");

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "csrf-token";

function getCookie(res, name) {
  return (res.headers["set-cookie"] || [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0];
}

async function fetchCsrfToken() {
  const res = await request(app).get("/api/auth/csrf-token");
  expect(res.status).toBe(200);
  expect(typeof res.body.csrfToken).toBe("string");
  expect(res.body.csrfToken.length).toBeGreaterThan(0);

  const cookie = getCookie(res, CSRF_COOKIE);
  expect(cookie).toBeTruthy();
  // Not HttpOnly so the JS Axios interceptor can read or echo the token
  expect(cookie).not.toContain("HttpOnly");
  // Strict same-site so cross-origin requests can't reuse the cookie
  expect(cookie).toContain("SameSite=Strict");

  return { token: res.body.csrfToken, cookie };
}

describe("CSRF protection (#451)", () => {
  describe("GET /api/auth/csrf-token", () => {
    it("returns 200 with a token and sets the csrf-token cookie", async () => {
      await fetchCsrfToken();
    });

    it("can be called repeatedly and each response is independently usable", async () => {
      const a = await fetchCsrfToken();
      const b = await fetchCsrfToken();
      // Tokens differ — each call mints a fresh one
      expect(a.token).not.toBe(b.token);
    });
  });

  describe("missing / invalid CSRF tokens on mutating requests", () => {
    it("returns 403 on POST with no X-CSRF-Token header and no cookie", async () => {
      const res = await request(app).post("/api/jobs/drafts").send({ title: "x" });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 on PATCH with no X-CSRF-Token header and no cookie", async () => {
      const res = await request(app).patch("/api/jobs/abc/extend").send({ days: 7 });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 on PUT with no X-CSRF-Token header and no cookie", async () => {
      const res = await request(app)
        .put("/api/profiles/GABC123/encryption-key")
        .send({ encryptionPublicKey: "pk" });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 on DELETE with no X-CSRF-Token header and no cookie", async () => {
      const res = await request(app).delete("/api/jobs/j-123");
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 when header and cookie do not match", async () => {
      const { cookie } = await fetchCsrfToken();
      const res = await request(app)
        .post("/api/jobs/drafts")
        .set("Cookie", cookie)
        .set(CSRF_HEADER, "deliberately-wrong-token")
        .send({ title: "x" });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 when only the cookie is present (header missing)", async () => {
      const { cookie } = await fetchCsrfToken();
      const res = await request(app)
        .post("/api/jobs/drafts")
        .set("Cookie", cookie)
        .send({ title: "x" });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 when only the header is present (cookie missing)", async () => {
      const { token } = await fetchCsrfToken();
      const res = await request(app)
        .post("/api/jobs/drafts")
        .set(CSRF_HEADER, token)
        .send({ title: "x" });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("valid CSRF tokens", () => {
    it("passes the CSRF check on POST /api/jobs/drafts (then fails JWT as expected)", async () => {
      const { token, cookie } = await fetchCsrfToken();
      const res = await request(app)
        .post("/api/jobs/drafts")
        .set("Cookie", cookie)
        .set(CSRF_HEADER, token)
        .send({ title: "x" });

      // 401 means CSRF passed and we hit the JWT auth layer.
      // Anything BUT 403 means CSRF is satisfied.
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/token/i);
    });
  });

  describe("bypass behavior", () => {
    it("does not require CSRF on GET requests", async () => {
      const res = await request(app).get("/api/jobs");
      expect(res.status).not.toBe(403);
    });

    it("does not require CSRF on the auth bootstrap endpoint", async () => {
      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: "AAAAA_INVALID_XDR" });
      // Should reach the auth handler (401 due to bad signature), not 403 CSRF.
      expect(res.status).not.toBe(403);
    });

    it("does not require CSRF on /metrics (Prometheus scrape)", async () => {
      const res = await request(app).get("/metrics");
      expect(res.status).not.toBe(403);
    });

    it("does not require CSRF on /health (liveness probe)", async () => {
      const res = await request(app).get("/health");
      expect(res.status).not.toBe(403);
    });

    it("does not require CSRF on /api/public/* (API-key authenticated)", async () => {
      const res = await request(app)
        .post("/api/public/anything")
        .send({ x: 1 });
      // 401/400/etc. acceptable; the request must not be 403'd for CSRF.
      expect(res.status).not.toBe(403);
    });

    it("does not require CSRF on /api/developer/* (API-key authenticated)", async () => {
      const res = await request(app)
        .post("/api/developer/keys")
        .send({ label: "test" });
      expect(res.status).not.toBe(403);
    });
  });
});
