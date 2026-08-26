"use strict";

/**
 * src/testUtils/authedRequest.js
 *
 * Supertest agent factory that wires authentication (Bearer JWT) and CSRF
 * (double-submit cookie + X-CSRF-Token header) into a single object, so
 * suites no longer hand-roll token signing, cookie juggling and header
 * boilerplate on every request.
 *
 * Usage:
 *   const { authedAgent } = require("../testUtils/authedRequest");
 *
 *   // Authenticated + CSRF-wired:
 *   const agent = await authedAgent(app, { publicKey: FREELANCER });
 *   await agent.post("/api/jobs").send(payload).expect(201);
 *
 *   // Unauthenticated but CSRF-wired (public endpoints):
 *   const anon = await authedAgent(app);
 *   await anon.post("/api/ai/score-job").send({ description: "..." });
 *
 *   // Negative tests — inject an arbitrary bearer token:
 *   const bad = await authedAgent(app, { token: "not-a-real-jwt" });
 *   await bad.get("/api/invitations").expect(401);
 *
 * Behaviour:
 *   - Performs GET /api/auth/csrf-token through a supertest agent so the
 *     csrf-token cookie is retained in the agent's cookie jar.
 *   - Signs a JWT from `publicKey` (with optional extra claims) using
 *     JWT_SECRET, matching what src/middleware/auth.js verifies.
 *   - Wraps get/post/put/patch/delete (+ del) so every request carries the
 *     default Authorization header and mutating verbs also carry
 *     X-CSRF-Token. Per-request `.set(...)` calls override the defaults.
 *   - If the app does not expose /api/auth/csrf-token (e.g. minimal Express
 *     test apps), the agent silently skips CSRF wiring; pass `{ csrf: false }`
 *     to skip the bootstrap round-trip entirely.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");

const CSRF_TOKEN_PATH = "/api/auth/csrf-token";
const MUTATING_METHODS = ["post", "put", "patch", "delete", "del"];

function signToken(options = {}) {
    const {
        publicKey,
        claims,
        expiresIn = "1h",
        secret = process.env.JWT_SECRET,
    } = options;
    if (!secret) {
        throw new Error(
            "signToken: no JWT secret available — pass { secret } or set JWT_SECRET"
        );
    }
    return jwt.sign(Object.assign({ publicKey }, claims), secret, { expiresIn });
}

async function fetchCsrfToken(agent) {
    try {
        const res = await agent.get(CSRF_TOKEN_PATH);
        if (res.status === 200 && typeof res.body?.csrfToken === "string") {
            return res.body.csrfToken;
        }
    } catch (_err) {
        // App without the bootstrap endpoint — fall through to null.
    }
    return null;
}

/**
 * Build a supertest agent with persistent cookies, a default Authorization
 * Bearer header and automatic X-CSRF-Token on mutating requests.
 *
 * @param {object} app - Express app (or http server) passed to supertest.
 * @param {object} [options]
 * @param {string} [options.publicKey] - Stellar address embedded as the JWT
 *   `publicKey` claim. Omit for unauthenticated agents.
 * @param {object} [options.claims] - Extra JWT claims merged into the payload
 *   (e.g. `{ role: "admin" }`).
 * @param {string} [options.token] - Use this bearer verbatim instead of
 *   signing one (handy for invalid-token negative tests).
 * @param {string} [options.expiresIn="1h"] - JWT expiry passed to jsonwebtoken.
 * @param {string} [options.secret] - Signing secret; defaults to JWT_SECRET.
 * @param {boolean} [options.csrf=true] - Fetch and wire a CSRF token.
 * @returns {Promise<object>} supertest agent with wrapped HTTP verbs.
 */
async function authedAgent(app, options = {}) {
    const agent = request.agent(app);

    const wantsCsrf = options.csrf !== false;
    const csrfToken = wantsCsrf ? await fetchCsrfToken(agent) : null;

    const bearer = Object.prototype.hasOwnProperty.call(options, "token")
        ? options.token
        : options.publicKey !== undefined || options.claims
            ? signToken(options)
            : null;

    function applyDefaults(test, isMutating) {
        if (bearer) test.set("Authorization", `Bearer ${bearer}`);
        if (isMutating && csrfToken) test.set("X-CSRF-Token", csrfToken);
        return test;
    }

    for (const method of MUTATING_METHODS.concat(["get", "head"])) {
        if (typeof agent[method] !== "function") continue;
        const original = agent[method].bind(agent);
        agent[method] = (...args) =>
            applyDefaults(original(...args), MUTATING_METHODS.includes(method));
    }

    return agent;
}

module.exports = {
    authedAgent,
    signToken,
};
