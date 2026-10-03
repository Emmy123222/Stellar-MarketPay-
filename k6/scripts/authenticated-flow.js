/**
 * k6/scripts/authenticated-flow.js — Load test for the AUTHENTICATED write path
 *
 * The other scripts only exercise public read/apply endpoints. The most
 * critical performance paths are authenticated (JWT-protected) and were
 * previously untested. This script drives the full lifecycle a client and
 * freelancer traverse:
 *
 *   authenticate  →  create job  →  apply  →  accept application  →  release
 *
 * ── Authentication ─────────────────────────────────────────────────────────
 * Production auth is SEP-10 web-auth: `GET /api/auth?account=G…` returns a
 * Stellar challenge transaction, the wallet signs it (ed25519), and
 * `POST /api/auth` verifies the signed XDR and issues an HS256 JWT.
 *
 * k6 has no Stellar SDK and cannot ed25519-sign a challenge transaction, so —
 * exactly like `k6/seed-data.js` — this script mints the same HS256 JWT
 * directly from the shared `JWT_SECRET` (via `k6/crypto` HMAC-SHA256). That is
 * the token the backend's `verifyJWT` middleware validates, so the protected
 * endpoints are exercised under real auth. The challenge endpoint's read path
 * is still load-touched in `setup()`. See `k6/README.md` for the seeded
 * accounts and the `JWT_SECRET` requirement.
 *
 * SLA: 50 VUs for 60s (see the scenario below). Transport/5xx failures gate the
 * run; business-validation responses on the stateful steps (e.g. release before
 * the indexer has recorded an on-chain escrow) are expected and are not counted
 * as transport errors — a per-step `checks` rate tracks business success.
 *
 * Run locally (after `node k6/seed-data.js`):
 *   JWT_SECRET=<same-as-backend> k6 run k6/scripts/authenticated-flow.js
 */
import http from "k6/http";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { check, sleep, group } from "k6";
import { SharedArray } from "k6/data";
import { Rate } from "k6/metrics";
import { BASE_URL, SLA } from "../config.js";
import { uniqueIndex } from "../lib/helpers.js";

const MAX_VUS = 50;

// Must match the backend's JWT_SECRET (and k6/seed-data.js default) so the
// minted token verifies. Never a production secret — local/CI load testing only.
const JWT_SECRET =
  __ENV.JWT_SECRET ||
  "dev-jwt-secret-with-enough-length-for-local-load-testing";

/** Business-flow success rate, separate from the transport error-rate gate. */
const flowSuccess = new Rate("authenticated_flow_success");

const fixtures = new SharedArray("auth-fixtures", function () {
  try {
    const parsed = JSON.parse(open("../test-fixtures.json"));
    return [
      {
        clientKey: parsed.clientKey || null,
        profileKeys: Array.isArray(parsed.profileKeys)
          ? parsed.profileKeys
          : [],
      },
    ];
  } catch (e) {
    console.warn(
      "k6/test-fixtures.json not found — run `node k6/seed-data.js` first.",
    );
    return [{ clientKey: null, profileKeys: [] }];
  }
});

const { clientKey, profileKeys } = fixtures[0];

function b64url(str) {
  return encoding.b64encode(str, "rawurl");
}

/** Mint an HS256 JWT accepted by the backend `verifyJWT` middleware. */
function mintJwt(publicKey) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ publicKey }));
  const data = `${header}.${payload}`;
  const sig = crypto.hmac("sha256", JWT_SECRET, data, "base64rawurl");
  return `${data}.${sig}`;
}

/** A syntactically valid 64-hex tx hash for endpoints that record one. */
function fakeTxHash(seed) {
  return crypto.sha256(`loadtest-${seed}-${Date.now()}-${Math.random()}`, "hex");
}

// Business-expected outcomes across the flow. Marking them keeps
// `http_req_failed` (the transport SLA gate) meaningful — a 4xx from a stateful
// step is a business response, not a transport failure — while explicit checks
// still record whether each step reached its happy-path status.
http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, 400, 401, 403, 404, 409),
);

export const options = {
  scenarios: {
    authenticated_flow: {
      executor: "constant-vus",
      vus: MAX_VUS, // 50 VUs …
      duration: "60s", // … for 60 seconds (per acceptance criteria)
    },
  },
  thresholds: {
    // Transport reliability (SLA "0% error rate at 50 VUs", enforced < 0.1%).
    http_req_failed: ["rate<0.001"],
    // Latency SLA.
    "http_req_duration{expected_response:true}": [`p(95)<${SLA.P95_MS}`],
    // At least the auth + job-create steps should succeed end to end.
    authenticated_flow_success: ["rate>0.90"],
  },
  tags: { test: "stellar-marketpay", script: "authenticated-flow" },
};

const CATEGORIES = ["Smart Contracts", "Backend Development", "DevOps"];
const DURATIONS = ["1 week", "2 weeks", "1 month"];

export function setup() {
  if (!clientKey || profileKeys.length === 0) {
    return { seeded: false };
  }
  // Load-touch the SEP-10 challenge endpoint (read path; no signing required).
  const challenge = http.get(
    `${BASE_URL}/api/auth?account=${encodeURIComponent(clientKey)}`,
    { headers: { Accept: "application/json" }, tags: { step: "auth_challenge" } },
  );
  check(challenge, {
    "challenge endpoint reachable": (r) => r.status === 200 || r.status === 400,
  });
  return { seeded: true };
}

export default function (data) {
  if (!data.seeded) {
    check(false, { "fixtures seeded (run seed-data.js)": () => false });
    flowSuccess.add(false);
    sleep(1);
    return;
  }

  const idx = uniqueIndex(__VU, __ITER, MAX_VUS);
  const freelancerAddress = profileKeys[idx % profileKeys.length];
  const clientToken = mintJwt(clientKey);
  const authHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${clientToken}`,
  };

  let jobId = null;
  let applicationId = null;
  let ok = true;

  group("create job (authenticated)", function () {
    const category = CATEGORIES[idx % CATEGORIES.length];
    const res = http.post(
      `${BASE_URL}/api/jobs`,
      JSON.stringify({
        title: `Auth flow job #${idx} — ${category}`,
        description:
          "Authenticated write-path load test: create → apply → accept → release.",
        budget: 100 + (idx % 10) * 50,
        currency: "XLM",
        category,
        skills: ["Stellar", "Soroban", category],
        clientAddress: clientKey,
        visibility: "public",
      }),
      { headers: authHeaders, tags: { step: "create_job" } },
    );
    const created = check(res, {
      "job created (201) with auth": (r) => r.status === 201,
    });
    ok = ok && created;
    try {
      jobId = res.json("data.id");
    } catch (e) {
      jobId = null;
    }
  });

  if (jobId) {
    group("apply to job", function () {
      const res = http.post(
        `${BASE_URL}/api/applications`,
        JSON.stringify({
          jobId,
          freelancerAddress,
          proposal: `Load-test proposal for job ${jobId} (ref #${idx}).`,
          bidAmount: 100 + (idx % 400),
          currency: "XLM",
          estimatedDuration: DURATIONS[idx % DURATIONS.length],
        }),
        {
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          tags: { step: "apply" },
        },
      );
      const applied = check(res, {
        "application created (201)": (r) => r.status === 201,
      });
      ok = ok && applied;
      try {
        applicationId = res.json("data.id");
      } catch (e) {
        applicationId = null;
      }
    });
  }

  if (applicationId) {
    group("accept application (authenticated)", function () {
      const res = http.post(
        `${BASE_URL}/api/applications/${applicationId}/accept`,
        JSON.stringify({ clientAddress: clientKey, contractTxHash: fakeTxHash(idx) }),
        { headers: authHeaders, tags: { step: "accept" } },
      );
      // 2xx = accepted; a business 4xx (already-awarded, bidding rules) is a
      // valid response for the endpoint under load, not a transport failure.
      check(res, {
        "accept handled (2xx/4xx, not 5xx)": (r) => r.status < 500,
      });
    });
  }

  if (jobId) {
    group("release escrow (authenticated)", function () {
      const res = http.post(
        `${BASE_URL}/api/escrow/${jobId}/release`,
        JSON.stringify({ clientAddress: clientKey, contractTxHash: fakeTxHash(`rel-${idx}`) }),
        { headers: authHeaders, tags: { step: "release" } },
      );
      // Release requires an indexer-recorded on-chain escrow in "in_progress";
      // a seed-only env answers with a business 4xx. We assert the endpoint is
      // reachable and does not 5xx under load.
      check(res, {
        "release handled (no 5xx)": (r) => r.status < 500,
      });
    });
  }

  flowSuccess.add(ok);
  sleep(1);
}

export function handleSummary(data) {
  return {
    "results/authenticated-flow-summary.json": JSON.stringify(data, null, 2),
  };
}
