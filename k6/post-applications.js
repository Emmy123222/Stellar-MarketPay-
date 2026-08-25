/**
 * k6/post-applications.js — Load test for POST /api/applications
 *
 * Submits job applications against the seeded open jobs. The backend enforces
 * `UNIQUE(job_id, freelancer_address)`, so every iteration MUST produce a
 * previously-unseen (job, freelancer) pair. We achieve this by:
 *
 *   1. loading the seeded jobs + freelancer pool (from test-fixtures.json)
 *   2. assigning each (VU, iteration) a strictly-unique global index
 *   3. deriving  freelancer = pool[idx % F]  and  job = jobs[idx % J]
 *
 * The number of DISTINCT (job, freelancer) pairs this can yield is exactly
 * lcm(F, J) (computed below). As long as total submissions stay below that
 * capacity, the unique constraint is never violated → the error rate holds at
 * 0 %. With defaults (F=5000, J=30) the capacity is 15 000 unique pairs — well
 * above what a 2-minute ramp generates. If a VU ever reaches the cap it sleeps
 * and yields (no request, no error) rather than busy-looping.
 *
 * SLA gates (see ./config.js):
 *   • p(95) < 200 ms at 100 VUs
 *   • 0 % error rate at 50 VUs
 *
 * Prerequisite:
 *   node k6/seed-data.js      # writes k6/test-fixtures.json (jobs + freelancers)
 *
 * Run locally:
 *   k6 run k6/post-applications.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import {
  BASE_URL,
  buildOptions,
  assertions,
  check as assertCheck,
} from "./config.js";
import { uniqueIndex, gcd, lcm } from "./lib/helpers.js";

// ---------------------------------------------------------------------------
// Load seeded fixtures (open jobs + freelancer pool) once across all VUs.
// ---------------------------------------------------------------------------
const fixtures = new SharedArray("fixtures", function () {
  try {
    const raw = open("./test-fixtures.json");
    const parsed = JSON.parse(raw);
    return [
      {
        jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds : [],
        profileKeys: Array.isArray(parsed.profileKeys) ? parsed.profileKeys : [],
      },
    ];
  } catch (e) {
    console.warn(
      "k6/test-fixtures.json not found — run `node k6/seed-data.js` before this script.",
    );
    return [{ jobIds: [], profileKeys: [] }];
  }
});

const { jobIds, profileKeys } = fixtures[0] || { jobIds: [], profileKeys: [] };

// Number of distinct (job, freelancer) pairs the pools can produce without
// repeating a UNIQUE(job_id, freelancer_address) combination.
const UNIQUE_CAPACITY = lcm(jobIds.length, profileKeys.length);

// Highest VU id reachable in the ramping scenario below.
const MAX_VUS = 100;

export const options = buildOptions("post-applications", {
  scenarios: {
    submit_applications: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 10 }, // warm-up
        { duration: "30s", target: 50 }, // SLA: 0 % error rate @ 50 VUs
        { duration: "30s", target: 100 }, // SLA: p(95) < 200 ms @ 100 VUs
        { duration: "30s", target: 100 }, // sustained peak
        { duration: "15s", target: 0 }, // ramp-down
      ],
      gracefulRampDown: "10s",
      tags: { scenario: "submit_applications" },
    },
  },
});

const PROPOSAL_TEMPLATE =
  "I have spent the last five years building production " +
  "decentralised applications on Stellar and would love to deliver " +
  "this work on time and within budget. My relevant experience includes ";

const DURATIONS = ["1 week", "2 weeks", "1 month", "3 weeks", "10 days"];

export default function () {
  if (jobIds.length === 0 || profileKeys.length === 0) {
    check(false, { "fixtures seeded": () => false });
    return;
  }

  // Injective base-MAX_VUS encoding → every (VU, iteration) maps to a distinct
  // global index, so no two submissions ever collide.
  const idx = uniqueIndex(__VU, __ITER, MAX_VUS);
  if (idx >= UNIQUE_CAPACITY) {
    // All unique (job, freelancer) pairs consumed — yield gracefully (no
    // request, no failed check) so the SLA gate (0 % errors) is never broken.
    sleep(1);
    return;
  }

  const jobId = jobIds[idx % jobIds.length];
  const freelancerAddress = profileKeys[idx % profileKeys.length];

  const payload = JSON.stringify({
    jobId,
    freelancerAddress,
    proposal:
      PROPOSAL_TEMPLATE +
      `integration work, smart-contract escrow flows, and API performance tuning (ref #${idx}).`,
    bidAmount: 100 + (idx % 400),
    currency: "XLM",
    estimatedDuration: DURATIONS[idx % DURATIONS.length],
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };

  const res = http.post(`${BASE_URL}/api/applications`, payload, params);

  assertCheck(res, {
    "status is 201": assertions.statusCreated,
    "body has success=true": assertions.successTrue,
    "response time < 200ms (p95 gate)": (r) => r.timings.duration < 200,
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    "results/post-applications-summary.json": JSON.stringify(data, null, 2),
  };
}
