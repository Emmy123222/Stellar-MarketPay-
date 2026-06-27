"use strict";

/**
 * Returns the client IP for rate limiting and logging.
 *
 * With `trust proxy` enabled, Express derives req.ip from X-Forwarded-For.
 * To prevent bypass via spoofed headers on direct connections, forwarded
 * headers are only trusted when the TCP peer matches TRUSTED_PROXY_IPS.
 */
function normalizeIp(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function getTrustedProxyIps() {
  return (process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((entry) => normalizeIp(entry.trim()))
    .filter(Boolean);
}

function getClientIp(req) {
  const socketIp = normalizeIp(req.socket?.remoteAddress || "");
  const trustedProxies = getTrustedProxyIps();

  if (
    req.app?.get?.("trust proxy") &&
    trustedProxies.length > 0 &&
    trustedProxies.includes(socketIp) &&
    req.ip
  ) {
    return normalizeIp(req.ip);
  }

  return socketIp || normalizeIp(req.ip || "") || "unknown";
}

module.exports = { getClientIp, normalizeIp, getTrustedProxyIps };
