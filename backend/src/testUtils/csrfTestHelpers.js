"use strict";

/**
 * src/testUtils/csrfTestHelpers.js
 *
 * Shared helpers for tests that need to call state-mutating routes protected
 * by the csrf-csrf double-submit middleware.
 *
 * Usage:
 *   const { fetchCsrf, applyCsrf, getCookie } = require("../testUtils/csrfTestHelpers");
 *
 *   const csrf = await fetchCsrf(app);
 *   const req = request(app).post("/api/ai/score-job").send(body);
 *   const res = await applyCsrf(req, csrf);
 *
 *   // or inline:
 *   const res = await applyCsrf(
 *     request(app).post("/api/foo").send({ a: 1 }),
 *     await fetchCsrf(app)
 *   );
 */

function getCookie(res, name) {
  return (res.headers["set-cookie"] || [])
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0];
}

async function fetchCsrf(app) {
  const request = require("supertest");
  const res = await request(app).get("/api/auth/csrf-token");
  if (res.status !== 200) {
    throw new Error(
      `fetchCsrf: GET /api/auth/csrf-token returned ${res.status}` +
        (res.body?.error ? `: ${res.body.error}` : "")
    );
  }
  if (typeof res.body?.csrfToken !== "string") {
    throw new Error(
      `fetchCsrf: expected body.csrfToken to be a string, got ${typeof res?.body?.csrfToken}`
    );
  }
  const cookie = getCookie(res, "csrf-token");
  return { token: res.body.csrfToken, cookie };
}

function applyCsrf(req, csrf) {
  if (!csrf) {
    throw new Error(
      "applyCsrf: missing csrf argument — call fetchCsrf(app) first"
    );
  }
  if (csrf.cookie) {
    req = req.set("Cookie", csrf.cookie);
  }
  if (csrf.token) {
    req = req.set("X-CSRF-Token", csrf.token);
  }
  return req;
}

module.exports = {
  getCookie,
  fetchCsrf,
  applyCsrf,
};
