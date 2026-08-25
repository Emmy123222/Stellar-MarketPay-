/**
 * k6/lib/helpers.js
 *
 * Small, dependency-free helpers shared across the load-test scripts.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Pick a random element from an array.
 * @param {Array<T>} arr
 * @returns {T}
 */
export function pickRandom(arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a syntactically-valid Stellar public key (G + 55 base32 chars).
 *
 * NOTE: these are *not* real on-chain keys — they only satisfy the backend's
 * `^G[A-Z0-9]{55}$` validation regex and (when the profile exists) the
 * foreign-key constraint on `applications.freelancer_address`.
 */
export function randomStellarAddress() {
  let addr = "G";
  for (let i = 0; i < 55; i++) {
    addr += BASE32[Math.floor(Math.random() * BASE32.length)];
  }
  return addr;
}

/**
 * Encode the k6 execution context (1-based `__VU`, per-VU `__ITER`) into a
 * strictly unique global integer. This is a mixed-radix (base-`maxVus`)
 * encoding, so it is injective as long as `vu ∈ [1, maxVus]` — regardless of
 * how many iterations each VU performs.
 *
 * Use this when an endpoint enforces a uniqueness constraint (e.g.
 * `applications UNIQUE(job_id, freelancer_address)`): allocate one pool slot
 * per global index and the invariant holds until the pool is exhausted.
 *
 * @param {number} vu      k6 virtual-user id (1-based)
 * @param {number} iter     k6 per-VU iteration counter (0-based)
 * @param {number} maxVus   highest possible VU id in the scenario
 * @returns {number} a unique, non-negative global index
 */
export function uniqueIndex(vu, iter, maxVus) {
  return iter * maxVus + (vu - 1);
}

/** Valid job categories accepted by the backend (see jobService.VALID_CATEGORIES). */
export const JOB_CATEGORIES = [
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

/** Build a query string from a plain object, skipping null/undefined values. */
export function buildQuery(params = {}) {
  const usp = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      usp.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return usp.length ? `?${usp.join("&")}` : "";
}

/** Greatest common divisor (Euclid's algorithm). */
export function gcd(a, b) {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 0;
}

/** Least common multiple of two non-negative integers (0 if either is 0). */
export function lcm(a, b) {
  if (!a || !b) return 0;
  return Math.abs(Math.trunc((a * b) / gcd(a, b)));
}
