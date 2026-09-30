/**
 * src/middleware/metricsAuth.js
 *
 * Internal-only authentication guard for `GET /metrics`.
 *
 * The Prometheus exposition endpoint leaks operational detail (route names,
 * error rates, queue depth, pool saturation) and must never be world-readable.
 * Access is granted when EITHER check passes:
 *
 *   1. Shared secret — `Authorization: Bearer <METRICS_TOKEN>` or
 *      `X-Metrics-Token: <METRICS_TOKEN>`, compared in constant time.
 *      (`METRICS_SECRET` is accepted as a legacy alias.)
 *   2. Internal network — the caller's IP is loopback or RFC1918/ULA private
 *      space, i.e. the scrape comes from inside the compose/k8s network.
 *      Disable with `METRICS_ALLOW_PRIVATE_NETWORK=false` to force token auth.
 *
 * Failures return 401 with a `WWW-Authenticate` challenge (never 403, so the
 * CSRF bypass assertions for operational endpoints remain valid).
 */
"use strict";

const crypto = require("crypto");
const { getClientIp } = require("../utils/clientIp");

/**
 * Compare two strings without leaking length or content through timing.
 *
 * @param {string} a first value
 * @param {string} b second value
 * @returns {boolean} true when the values are identical
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so the branch cost is constant-ish.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract a bearer / header token from the request.
 *
 * @param {import("express").Request} req incoming request
 * @returns {string} presented token, or "" when absent
 */
function presentedToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const custom = req.headers["x-metrics-token"];
  return typeof custom === "string" ? custom.trim() : "";
}

/**
 * Normalise an IPv4-mapped IPv6 address ("::ffff:10.0.0.5" → "10.0.0.5").
 *
 * @param {string} ip raw address
 * @returns {string} normalised address
 */
function normaliseIp(ip) {
  const value = String(ip || "").trim();
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

/**
 * Is the address loopback or private (non-routable) space?
 *
 * @param {string} rawIp client address
 * @returns {boolean} true when the caller is on an internal network
 */
function isInternalIp(rawIp) {
  const ip = normaliseIp(rawIp);
  if (!ip) return false;
  if (ip === "::1" || ip === "localhost") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true;                      // loopback
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true;         // link-local
    return false;
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  const lower = ip.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8");
}

/**
 * Read the configured metrics token (supports the legacy env name).
 *
 * @returns {string} configured token, or "" when unset
 */
function configuredToken() {
  return (process.env.METRICS_TOKEN || process.env.METRICS_SECRET || "").trim();
}

/**
 * Are private-network scrapes allowed without a token?
 *
 * @returns {boolean} true unless explicitly disabled
 */
function privateNetworkAllowed() {
  const flag = (process.env.METRICS_ALLOW_PRIVATE_NETWORK || "").trim().toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "no";
}

/**
 * Express middleware enforcing internal-only access to `/metrics`.
 *
 * @param {import("express").Request}  req  request
 * @param {import("express").Response} res  response
 * @param {Function}                   next next handler
 * @returns {void}
 */
function metricsAuth(req, res, next) {
  const token = configuredToken();
  const presented = presentedToken(req);

  if (token && presented && timingSafeEqual(presented, token)) {
    return next();
  }

  // A presented-but-wrong token is always a hard failure, even from inside the
  // network — it signals a misconfigured or malicious scraper.
  if (token && presented) {
    res.set("WWW-Authenticate", 'Bearer realm="metrics"');
    return res.status(401).json({ error: "Unauthorized" });
  }

  let clientIp;
  try {
    clientIp = getClientIp(req);
  } catch {
    clientIp = req.ip || "";
  }

  if (privateNetworkAllowed() && isInternalIp(clientIp)) {
    return next();
  }

  res.set("WWW-Authenticate", 'Bearer realm="metrics"');
  return res.status(401).json({ error: "Unauthorized" });
}

module.exports = metricsAuth;
module.exports.metricsAuth = metricsAuth;
module.exports.isInternalIp = isInternalIp;
