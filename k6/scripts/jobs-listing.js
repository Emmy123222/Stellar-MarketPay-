import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";
import { JOB_CATEGORIES, buildQuery, pickRandom } from "../lib/helpers.js";

export const options = {
  thresholds: {
    http_req_failed: ["rate<0.01"], // < 1% error rate
    http_req_duration: ["p(95)<500"], // p95 < 500ms
  },
  stages: [
    { duration: "2m", target: 100 }, // ramp to 100 VUs over 2 minutes
  ],
};

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

  const res = http.get(`${BASE_URL}/api/jobs${query}`, {
    headers: { Accept: "application/json" },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
  });

  sleep(1);
}
