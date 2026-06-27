/**
 * k6/seed-data.js
 *
 * Seeds the target environment with deterministic, load-test-friendly data:
 *
 *   • 1 client profile (used as the job owner)
 *   • NUM_JOBS open, public jobs (exercised by GET /api/jobs & POST /api/applications)
 *   • NUM_FREELANCERS freelancer profiles (the applicant pool for POST /api/applications)
 *
 * It talks ONLY to the backend REST API using Node's built-in `http`/`https`
 * modules and signs a JWT with the `crypto` module — so it has zero external
 * dependencies and runs anywhere Node 18+ is available.
 *
 * On success it writes `k6/test-fixtures.json`:
 *
 *   {
 *     "clientKey":     "G…",
 *     "jobIds":        ["<uuid>", …],     // NUM_JOBS open jobs
 *     "profileKeys":   ["G…", …]          // NUM_FREELANCERS freelancer keys
 *   }
 *
 * Usage:
 *   node k6/seed-data.js
 *
 * Environment variables:
 *   K6_BASE_URL     API base URL           (default http://localhost:4000)
 *   JWT_SECRET      Secret used to sign    (default dev secret — MUST match the backend)
 *                   the seed client's JWT
 *   SEED_JOBS       Number of jobs         (default 30)
 *   SEED_FREELANCERS  Number of freelancers (default 5000)
 *   SEED_CONCURRENCY  HTTP concurrency      (default 50)
 */
"use strict";

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.K6_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-jwt-secret-with-enough-length-for-local-load-testing";
const NUM_JOBS = parseInt(process.env.SEED_JOBS || "30", 10);
const NUM_FREELANCERS = parseInt(process.env.SEED_FREELANCERS || "5000", 10);
const CONCURRENCY = parseInt(process.env.SEED_CONCURRENCY || "50", 10);

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CATEGORIES = [
  "Smart Contracts",
  "Frontend Development",
  "Backend Development",
  "UI/UX Design",
  "Technical Writing",
  "DevOps",
  "Security Audit",
  "Data Analysis",
  "Mobile Development",
  "Other",
];

// ─── small utilities ──────────────────────────────────────────────────────────

function randomKey() {
  let k = "G";
  for (let i = 0; i < 55; i++) k += BASE32[crypto.randomInt(0, BASE32.length)];
  return k;
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Sign an HS256 JWT (compatible with the backend's `jsonwebtoken` verify). */
function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const data =
    base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest();
  return data + "." + base64url(sig);
}

function request(method, urlPath, body, headers = {}) {
  const url = new URL(BASE_URL + urlPath);
  const lib = url.protocol === "https:" ? https : http;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: Object.assign(
          data
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {},
          headers,
        ),
        timeout: 15000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (e) {
            /* non-JSON response */
          }
          resolve({ status: res.statusCode, body: json, raw });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    if (data) req.write(data);
    req.end();
  });
}

// Run an async task over items with bounded concurrency.
async function mapConcurrent(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await task(items[i], i);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function log(...args) {
  console.log("[seed]", ...args);
}

// ─── seeding steps ────────────────────────────────────────────────────────────

async function waitForApi() {
  const healthPath = "/health";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await request("GET", healthPath);
      // 200 = fully healthy; 503 = "degraded" (Stellar Horizon unreachable).
      // Either way the server is listening and DB-backed routes work, which is
      // all the load test needs.
      if (res.status === 200 || res.status === 503) {
        log(`API reachable at ${BASE_URL} (HTTP ${res.status})`);
        return;
      }
    } catch (e) {
      /* keep retrying */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API at ${BASE_URL} did not become reachable`);
}

async function ensureProfile(publicKey, role, displayName) {
  // upsert is idempotent (POST /api/profiles)
  const res = await request("POST", "/api/profiles", {
    publicKey,
    role,
    displayName,
    bio: `Load-test ${role} profile (${publicKey.slice(0, 8)}…).`,
    skills: ["Solidity", "Rust", "React", "Node.js"],
    availability: { status: role === "freelancer" ? "available" : "open" },
  });
  if (res.status >= 400) {
    throw new Error(`profile upsert failed (${res.status}): ${res.raw}`);
  }
  return publicKey;
}

async function ensureJob(clientKey, jwt, index) {
  const category = CATEGORIES[index % CATEGORIES.length];
  const res = await request(
    "POST",
    "/api/jobs",
    {
      title: `Load Test Job #${index} — ${category}`,
      description:
        `Synthetic job generated by k6/seed-data.js for performance testing. ` +
        `This listing exercises the job/application/profile read & write paths under load.`,
      budget: 100 + (index % 10) * 50,
      currency: "XLM",
      category,
      skills: ["Stellar", "Soroban", category],
      clientAddress: clientKey,
      visibility: "public",
    },
    { Authorization: `Bearer ${jwt}` },
  );
  if (res.status >= 400) {
    throw new Error(`job creation failed (${res.status}): ${res.raw}`);
  }
  return res.body && res.body.data ? res.body.data.id : null;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`target=${BASE_URL} jobs=${NUM_JOBS} freelancers=${NUM_FREELANCERS} concurrency=${CONCURRENCY}`);

  await waitForApi();

  // 1. client profile + JWT
  const clientKey = randomKey();
  await ensureProfile(clientKey, "client", "Load Test Client");
  const jwt = signJwt({ publicKey: clientKey });
  log("client profile ready:", clientKey);

  // 2. open jobs (owned by the client)
  const jobResults = await mapConcurrent(
    Array.from({ length: NUM_JOBS }, (_, i) => i),
    CONCURRENCY,
    (i) => ensureJob(clientKey, jwt, i),
  );
  const jobIds = jobResults.filter((id) => id);
  log(`created ${jobIds.length} open jobs`);
  if (jobIds.length === 0) {
    throw new Error("no jobs were seeded — POST /api/applications cannot run");
  }

  // 3. freelancer pool (applicant FK targets)
  const freelancerKeys = Array.from({ length: NUM_FREELANCERS }, () => randomKey());
  let ok = 0;
  await mapConcurrent(freelancerKeys, CONCURRENCY, async (key, i) => {
    await ensureProfile(key, "freelancer", `Freelancer ${i}`);
    ok++;
    if (ok % 250 === 0) log(`… ${ok}/${NUM_FREELANCERS} freelancer profiles`);
  });
  log(`created ${ok} freelancer profiles`);

  // 4. write fixtures consumed by the k6 scripts
  const fixtures = { clientKey, jobIds, profileKeys: freelancerKeys };
  const outPath = path.join(__dirname, "test-fixtures.json");
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  log(`wrote ${outPath} (jobs=${jobIds.length}, freelancers=${freelancerKeys.length})`);
}

main().catch((err) => {
  console.error("[seed] FAILED:", err.message || err);
  process.exit(1);
});
