/**
 * k6/get-profiles.js — Load test for GET /api/profiles/:publicKey
 *
 * Reads the set of seeded freelancer profiles (produced by `seed-data.js`)
 * and fetches them by public key, exercising the profile read path and its
 * cache layer.
 *
 * SLA gates (see ./config.js):
 *   • p(95) < 200 ms at 100 VUs
 *   • 0 % error rate at 50 VUs
 *
 * Prerequisite:
 *   node k6/seed-data.js      # writes k6/test-fixtures.json
 *
 * Run locally:
 *   k6 run k6/get-profiles.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { BASE_URL, buildOptions, assertions, check as assertCheck } from "./config.js";
import { pickRandom } from "./lib/helpers.js";

// Load seeded profile keys once at init time across all VUs.
const profileKeys = new SharedArray("profileKeys", function () {
  try {
    const raw = open("./test-fixtures.json");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.profileKeys) ? parsed.profileKeys : [];
  } catch (e) {
    console.warn(
      "k6/test-fixtures.json not found — run `node k6/seed-data.js` first. Falling back to a synthetic key.",
    );
    return [];
  }
});

export const options = buildOptions("get-profiles");

export default function () {
  const key =
    profileKeys.length > 0
      ? pickRandom(profileKeys)
      : "GBDXK6Y3NFQ5FC2N2M3WGDQ7FQ5KQ2SMW7GK3MFQ5TBN3WFFQ5KQ2SMW";

  const params = { headers: { Accept: "application/json" } };
  const res = http.get(`${BASE_URL}/api/profiles/${encodeURIComponent(key)}`, params);

  assertCheck(res, {
    "status is 200": assertions.status200,
    "body has success=true": assertions.successTrue,
    "response time < 200ms (p95 gate)": (r) => r.timings.duration < 200,
  });

  sleep(1);
}

export function handleSummary(data) {
  return { "results/get-profiles-summary.json": JSON.stringify(data, null, 2) };
}
