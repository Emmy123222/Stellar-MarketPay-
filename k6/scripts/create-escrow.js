/**
 * k6/scripts/create-escrow.js — Load test for concurrent escrow creation
 *
 * Issue #1488: the load-test suite covered job listing and profile reads
 * (and later writes) but had no scenario for creating escrows. This scenario
 * drives 50 CONCURRENT authenticated escrow creations to probe for race
 * conditions that unit tests would not catch.
 *
 * Endpoint under test:
 *   PATCH /api/jobs/:id/escrow
 *
 * The backend has no dedicated escrow-create controller because escrows are
 * created on-chain (Soroban `create_escrow`) by the client wallet; the API's
 * write path that RECORDS a new escrow is `PATCH /api/jobs/:id/escrow`
 * (src/routes/jobs.js), which:
 *   • persists the escrow contract id against the job  (UPDATE jobs)
 *   • inserts the `create_escrow` contract audit row   (INSERT contract_audit_log)
 *   • invalidates the cached job list                  (Redis)
 * All three happen for every VU, so 50 simultaneous PATCHes hammer the exact
 * DB / cache surface an on-chain escrow burst would.
 *
 * How the scenario maps to the acceptance criteria:
 *   • 50 concurrent virtual users        → executor: "per-vu-iterations",
 *                                          vus: 50, iterations: 1 (a single
 *                                          simultaneous burst of 50 VUs)
 *   • Each VU authenticates              → VU signs an HS256 JWT (same secret
 *                                          as the backend) for its own unique
 *                                          Stellar G-address and presents it as
 *                                          `Authorization: Bearer`.
 *   • Each VU creates one escrow         → exactly one PATCH per VU on its own
 *                                          seeded job (1 VU → 1 unique job, so
 *                                          no cross-VU row contention).
 *   • Assertions: p95 < 2 s,             → threshold on the escrow-create metric
 *     error rate < 1 %                     `http_req_failed{name:create_escrow}`.
 *
 * SLA gates enforced by k6 thresholds:
 *   • http_req_failed{name:create_escrow}  rate < 0.01  (< 1 % errors)
 *   • http_req_duration{name:create_escrow} p(95) < 2000  (< 2 s)
 *   • checks                                rate > 0.99 (business assertions)
 *
 * Prerequisite:
 *   node k6/seed-data.js      # (optional) writes k6/test-fixtures.json so the
 *                             # scenario reuses the seeded client/jobs. Without
 *                             # the fixture file it seeds its own client profile
 *                             # + the 50 jobs it needs.
 *
 * Run locally (Docker):
 *   docker compose -f docker-compose.loadtest.yml up -d --build
 *   JWT_SECRET=loadtest-jwt-secret-with-sufficient-length-for-signing \
 *     K6_BASE_URL=http://localhost:4000 node k6/seed-data.js
 *   docker compose -f docker-compose.loadtest.yml run --rm k6 \
 *     run scripts/create-escrow.js
 *
 * Run with a local k6 binary:
 *   cd k6 && K6_BASE_URL=http://localhost:4000 JWT_SECRET=<same-as-backend> \
 *     k6 run scripts/create-escrow.js
 *
 * Results:
 *   Summary is written to k6/results/create-escrow-summary.json. Copy it into
 *   k6/previous-results/ to establish the diff baseline for the next run.
 */

import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { BASE_URL } from "../config.js";

// ───────────────────────────────────────────────────────────────────────────
// Scenario configuration — issue #1488 acceptance criteria
// ───────────────────────────────────────────────────────────────────────────

const VUS = 50; // 50 concurrent virtual users
const JWT_SECRET =
  __ENV.JWT_SECRET || "loadtest-jwt-secret-with-sufficient-length-for-signing";

export const options = {
  scenarios: {
    create_escrow: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1, // exactly one escrow per VU
      gracefulStop: "10s",
    },
  },
  thresholds: {
    // < 1 % request error rate on escrow creation
    "http_req_failed{name:create_escrow}": ["rate<0.01"],
    // p(95) response time for escrow creation < 2 s
    "http_req_duration{name:create_escrow}": ["p(95)<2000"],
    // Business-level assertions must hold on > 99 % of escrow creates
    checks: ["rate>0.99"],
  },
  userAgent: "k6-loadtest/stellar-marketpay",
};

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — reuse the seeded client + open jobs when available
// ───────────────────────────────────────────────────────────────────────────

const fixtures = new SharedArray("escrow-fixtures", function () {
  try {
    const raw = open("../test-fixtures.json");
    const parsed = JSON.parse(raw);
    return [
      {
        clientKey: typeof parsed.clientKey === "string" ? parsed.clientKey : "",
        jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds : [],
      },
    ];
  } catch (e) {
    console.warn(
      "k6/test-fixtures.json not found — create-escrow.js will seed its own client profile + jobs.",
    );
    return [{ clientKey: "", jobIds: [] }];
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function seededRandom(seed) {
  let state = seed >>> 0;
  return function () {
    // Numerical Recipes LCG — deterministic per VU.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Deterministic, syntactically-valid Stellar G-address unique per VU. */
function uniqueGAddress(seed) {
  const rnd = seededRandom(seed);
  let addr = "G";
  for (let i = 0; i < 55; i++) {
    addr += BASE32[Math.floor(rnd() * BASE32.length)];
  }
  return addr;
}

/** Deterministic, unique Soroban-style contract id per VU. */
function uniqueContractId(seed) {
  const rnd = seededRandom((seed ^ 0x9e3779b9) >>> 0);
  let id = "C";
  for (let i = 0; i < 55; i++) {
    id += BASE32[Math.floor(rnd() * BASE32.length)];
  }
  return id;
}

/**
 * Sign the same HS256 JWT the backend verifies (jsonwebtoken + JWT_SECRET).
 * Mirrors k6/seed-data.js so the fixture seed and the scenario agree.
 */
function signJwt(publicKey) {
  const header = encoding.b64encode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "rawurl",
  );
  const payload = encoding.b64encode(
    JSON.stringify({
      publicKey,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "rawurl",
  );
  const signingInput = `${header}.${payload}`;
  const signature = encoding.b64encode(
    crypto.hmac("sha256", JWT_SECRET, signingInput, "binary"),
    "rawurl",
  );
  return `${signingInput}.${signature}`;
}

const jsonHeaders = () => ({
  "Content-Type": "application/json",
  Accept: "application/json",
});

const authHeaders = (token) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
});

// ───────────────────────────────────────────────────────────────────────────
// setup — guarantee VUS open jobs (1 per VU) so each VU can create its own escrow
// ───────────────────────────────────────────────────────────────────────────

export function setup() {
  const fixture = fixtures[0] || { clientKey: "", jobIds: [] };
  const jobIds = (fixture.jobIds || []).slice();

  // The seeded client may already exist (seed-data.js); create it if not.
  let clientKey = fixture.clientKey || uniqueGAddress(900001);
  if (!fixture.clientKey) {
    const res = http.post(
      `${BASE_URL}/api/profiles`,
      JSON.stringify({
        publicKey: clientKey,
        role: "client",
        displayName: "Load Test Escrow Client",
        bio: "Seed client used by the create-escrow.js escrow-creation scenario.",
        skills: ["Solidity", "Rust"],
        availability: { status: "open" },
      }),
      { headers: jsonHeaders() },
    );
    console.log(
      `[create-escrow] seeded client profile ${clientKey} (HTTP ${res.status})`,
    );
  }

  const need = Math.max(0, VUS - jobIds.length);
  for (let i = 0; i < need; i++) {
    const res = http.post(
      `${BASE_URL}/api/jobs`,
      JSON.stringify({
        title: `Escrow Load Test Job ${i + 1}`,
        description:
          "Synthetic job created by the create-escrow.js scenario so every VU " +
          "can attach its own escrow contract concurrently.",
        budget: 500,
        currency: "XLM",
        category: "Smart Contracts",
        skills: ["Stellar", "Soroban"],
        clientAddress: clientKey,
        visibility: "public",
      }),
      { headers: authHeaders(signJwt(clientKey)) },
    );
    const id = res.json("data.id");
    if (id) {
      jobIds.push(id);
    } else {
      console.warn(
        `[create-escrow] could not create synthetic job ${i + 1} (HTTP ${res.status})`,
      );
    }
  }

  return { jobIds };
}

// ───────────────────────────────────────────────────────────────────────────
// default — each VU authenticates and creates exactly one escrow
// ───────────────────────────────────────────────────────────────────────────

export default function (data) {
  const jobIds = (data && data.jobIds) || [];
  if (jobIds.length === 0) {
    check(false, { "at least one job available": () => false });
    return;
  }

  const vu = __VU;
  // 1 VU → 1 unique job → each VU creates its own escrow with no contention.
  const jobId = jobIds[(vu - 1) % jobIds.length];

  // Authenticate: present a JWT (HS256, signed with the shared backend secret)
  // for this VU's own unique Stellar address.
  const token = signJwt(uniqueGAddress(vu));
  const escrowContractId = uniqueContractId(vu);

  const res = http.patch(
    `${BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/escrow`,
    JSON.stringify({ escrowContractId }),
    {
      headers: authHeaders(token),
      tags: { name: "create_escrow" },
    },
  );

  check(res, {
    "escrow created (status 200, success:true)": (r) =>
      r.status === 200 && r.json("success") === true,
    "p(95) gate < 2s": (r) => r.timings.duration < 2000,
  });
}

export function handleSummary(data) {
  return {
    "results/create-escrow-summary.json": JSON.stringify(data, null, 2),
  };
}