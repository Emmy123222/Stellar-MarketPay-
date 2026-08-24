/**
 * k6/get-jobs.js — Load test for GET /api/jobs
 *
 * Exercises the public job-listing endpoint with a realistic mix of filters
 * (category, search term, pagination cursor) to validate the read path under
 * production-like concurrency.
 *
 * SLA gates (see ./config.js):
 *   • p(95) < 200 ms at 100 VUs
 *   • 0 % error rate at 50 VUs
 *
 * Run locally:
 *   k6 run k6/get-jobs.js
 *
 * Run against another environment:
 *   K6_BASE_URL=https://staging.example.com k6 run k6/get-jobs.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, buildOptions, assertions, check as assertCheck } from "./config.js";
import { JOB_CATEGORIES, buildQuery, pickRandom } from "./lib/helpers.js";

export const options = buildOptions("get-jobs");

const SEARCH_TERMS = [
  "react",
  "solidity",
  "smart contract",
  "design",
  "rust",
  "soroban",
  "backend",
  "",
];

export default function () {
  const query = buildQuery({
    category: pickRandom(JOB_CATEGORIES),
    search: pickRandom(SEARCH_TERMS),
    limit: "20",
    status: "open",
  });

  const params = { headers: { Accept: "application/json" } };
  const res = http.get(`${BASE_URL}/api/jobs${query}`, params);

  assertCheck(res, {
    "status is 200": assertions.status200,
    "body has success=true": assertions.successTrue,
    "response time < 200ms (p95 gate)": (r) => r.timings.duration < 200,
  });

  sleep(1);
}

export function handleSummary(data) {
  return { "results/get-jobs-summary.json": JSON.stringify(data, null, 2) };
}
