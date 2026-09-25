import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { BASE_URL } from "../config.js";
import { uniqueIndex, lcm } from "../lib/helpers.js";

const fixtures = new SharedArray("fixtures", function () {
  try {
    const raw = open("../test-fixtures.json");
    const parsed = JSON.parse(raw);
    return [
      {
        jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds : [],
        profileKeys: Array.isArray(parsed.profileKeys) ? parsed.profileKeys : [],
      },
    ];
  } catch (e) {
    console.warn("k6/test-fixtures.json not found — run `node k6/seed-data.js` first.");
    return [{ jobIds: [], profileKeys: [] }];
  }
});

const { jobIds, profileKeys } = fixtures[0] || { jobIds: [], profileKeys: [] };
const UNIQUE_CAPACITY = jobIds.length > 0 && profileKeys.length > 0 ? lcm(jobIds.length, profileKeys.length) : 0;
const MAX_VUS = 50;

export const options = {
  thresholds: {
    http_req_failed: ["rate<0.01"], // < 1% error rate
    http_req_duration: ["p(95)<500"], // p95 < 500ms
  },
  scenarios: {
    apply_to_job: {
      executor: "constant-vus",
      vus: 50, // simulate 50 concurrent applications
      duration: "1m",
    },
  },
};

const PROPOSAL_TEMPLATE = "I have spent the last five years building production apps on Stellar...";
const DURATIONS = ["1 week", "2 weeks", "1 month", "3 weeks", "10 days"];

export default function () {
  if (jobIds.length === 0 || profileKeys.length === 0) {
    check(false, { "fixtures seeded": () => false });
    return;
  }

  const idx = uniqueIndex(__VU, __ITER, MAX_VUS);
  if (idx >= UNIQUE_CAPACITY) {
    sleep(1);
    return;
  }

  const jobId = jobIds[idx % jobIds.length];
  const freelancerAddress = profileKeys[idx % profileKeys.length];

  const payload = JSON.stringify({
    jobId,
    freelancerAddress,
    proposal: PROPOSAL_TEMPLATE + ` (ref #${idx}).`,
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

  check(res, {
    "status is 201": (r) => r.status === 201,
  });

  sleep(1);
}
