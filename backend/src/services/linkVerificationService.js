/**
 * src/services/linkVerificationService.js
 *
 * Portfolio link verification (Issue #___, V17).
 *
 *   1. `checkLink(url, opts)` issues a HEAD request with a 5 s timeout
 *      and an SSRF guard, returning `{ ok, statusCode, error, checkedAt }`.
 *   2. `enqueuePortfolioVerification({publicKey, portfolioItems})`
 *      adds a job per item to the Bull queue.
 *   3. `verifyPortfolioItem(publicKey, item)` reads the current
 *      `portfolio_items` JSON, locates the matching item by url+type,
 *      runs `checkLink`, and writes the result back.
 *   4. `findStalePortfolioLinks(maxAgeDays = 7)` returns every profile
 *      that owns a github/live item whose verification is older than
 *      `maxAgeDays` (or has never been verified) so the scheduler can
 *      re-queue them.
 *   5. `mergeVerificationMetadata(incomingItems, existingItems)` is the
 *      pure helper used by `profileService.upsertProfile` to keep
 *      verification data when the user re-saves without changing a URL.
 */

"use strict";

const dns = require("dns").promises;
const net = require("net");
const pool = require("../db/pool");
const { linkVerificationQueue } = require("../utils/queue");
const { createServiceLogger, logError } = require("../utils/logger");

const VERIFY_TIMEOUT_MS = Number(process.env.LINK_VERIFY_TIMEOUT_MS) || 5000;
const VERIFIABLE_TYPES = new Set(["github", "live"]);
const REVERIFY_AGE_DAYS = 7;

const logger = createServiceLogger("link-verification");

// ─── SSRF guard ────────────────────────────────────────────────────────────

/**
 * Returns true when the host string is a literal IPv4/IPv6 address
 * that resolves into a blocked range (loopback, RFC1918 private,
 * link-local, multicast, broadcast, IPv6 unique-local, etc.).
 * Hostnames are NOT considered private here; we resolve them via
 * `dns.lookup` and re-check the IP afterwards.
 */
function isBlockedAddressLiteral(host) {
  if (!host) return true;
  // Reject obvious shorthand for the loopback interface.
  if (host === "localhost") return true;

  if (net.isIP(host) === 4) {
    const parts = host.split(".").map((p) => Number(p));
    const [a, b] = parts;
    if (a === 10) return true;                    // 10.0.0.0/8
    if (a === 127) return true;                   // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;      // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;      // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT
    if (a === 0) return true;                     // 0.0.0.0/8
    if (a >= 224) return true;                    // multicast / broadcast / reserved
    return false;
  }

  if (net.isIP(host) === 6) {
    const lower = host.toLowerCase();
    if (lower === "::1" || lower === "::") return true;            // loopback / unspecified
    if (lower.startsWith("fe80:")) return true;                    // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("ff")) return true;                       // multicast
    return false;
  }

  return false;
}

/**
 * Resolve `hostname` to a list of IPs and reject if any resolves into a
 * blocked range. Hostnames that fail to resolve also fail closed.
 *
 * Exported for unit testing.
 */
async function isBlockedHostname(hostname, { lookup = dns.lookup } = {}) {
  if (!hostname || isBlockedAddressLiteral(hostname)) return true;

  // Lookup once; if the resolver returns a literal we already checked.
  let resolved;
  try {
    const result = await lookup(hostname, { all: true });
    resolved = Array.isArray(result) ? result : [result];
  } catch (_) {
    // Could not resolve — fail closed to prevent probing.
    return true;
  }

  for (const entry of resolved) {
    if (isBlockedAddressLiteral(entry.address)) return true;
  }
  return false;
}

/**
 * Validate that `rawUrl` is non-empty, http(s), and resolves to a public
 * IP. Returns `{ ok: false, error }` when it is unsafe; otherwise `{ ok: true }`.
 */
async function validateUrlSafety(rawUrl, { lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch (err) {
    return { ok: false, error: "invalid-url" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "invalid-protocol" };
  }
  const host = parsed.hostname;
  if (!host) return { ok: false, error: "missing-host" };

  if (await isBlockedHostname(host, { lookup })) {
    return { ok: false, error: "blocked-host" };
  }
  return { ok: true };
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

/**
 * HEAD-check `rawUrl` with timeout + redirect-follow + SSRF guard.
 * Never throws; always returns a structured result.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {typeof global.fetch} [opts.fetchImpl]  Override fetch (for tests).
 * @param {(host: string) => Promise<boolean>} [opts.lookupFn]  Override DNS (for tests).
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok: boolean, statusCode: number|null, error: string|null, checkedAt: string}>}
 */
async function checkLink(rawUrl, { fetchImpl, lookupFn, timeoutMs } = {}) {
  const checkedAt = new Date().toISOString();
  const fetcher = fetchImpl || globalThis.fetch;
  const timeout = typeof timeoutMs === "number" ? timeoutMs : VERIFY_TIMEOUT_MS;

  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, statusCode: null, error: "invalid-url", checkedAt };
  }

  if (lookupFn) {
    try {
      const blocked = await lookupFn(new URL(rawUrl).hostname);
      if (blocked) {
        return { ok: false, statusCode: null, error: "blocked-host", checkedAt };
      }
    } catch (_) {
      return { ok: false, statusCode: null, error: "blocked-host", checkedAt };
    }
  } else {
    const safety = await validateUrlSafety(rawUrl);
    if (!safety.ok) {
      return { ok: false, statusCode: null, error: safety.error, checkedAt };
    }
  }

  let controller;
  let timer;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeout);
  } catch (_) {
    // AbortController not supported (very old Node) — fall back to no timeout.
    controller = null;
  }

  try {
    const response = await fetcher(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller ? controller.signal : undefined,
    });
    // Some servers return 405 to HEAD; fall back to GET-range so we can
    // still judge reachability for hosts that disallow HEAD.
    if (response.status === 405 || response.status === 501) {
      // Discard the unused HEAD response body before retrying.
      try { await response.body?.cancel?.(); } catch (_) { /* no-op */ }
      const fallback = await fetcher(rawUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller ? controller.signal : undefined,
        headers: { Range: "bytes=0-0" },
      });
      const ok = fallback.status >= 200 && fallback.status < 400;
      return {
        ok,
        statusCode: fallback.status,
        error: ok ? null : `http-${fallback.status}`,
        checkedAt,
      };
    }
    const ok = response.status >= 200 && response.status < 400;
    return {
      ok,
      statusCode: response.status,
      error: ok ? null : `http-${response.status}`,
      checkedAt,
    };
  } catch (err) {
    const isAbort = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      statusCode: null,
      error: isAbort ? "timeout" : (err && err.message) || "fetch-error",
      checkedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Decide whether a portfolio item is verifiable. `stellar_tx` items are
 * Stellar transaction IDs and `file` items are IPFS CIDs, neither of
 * which are HTTP URLs.
 */
function isVerifiable(item) {
  if (!item || typeof item !== "object") return false;
  if (!VERIFIABLE_TYPES.has(String(item.type || ""))) return false;
  if (typeof item.url !== "string" || !item.url.trim()) return false;
  if (item.type === "stellar_tx") return false; // belt-and-braces
  if (item.type === "file") return false;       // belt-and-braces
  return true;
}

/**
 * Strip incoming verification metadata from a user-supplied item so
 * the server can keep full control over `verified: true/false`. Mirror
 * keys are dropped silently when missing.
 */
function stripIncomingVerification(item) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  delete out.verified;
  delete out.verificationError;
  delete out.verifiedAt;
  delete out.lastCheckedAt;
  return out;
}

/**
 * Normalize a URL string for stable equality comparisons across saves.
 * We strip a single trailing slash on non-empty paths so that
 * `https://github.com/foo` and `https://github.com/foo/` key the same;
 * protocol/host are lowercased via the URL constructor. Returns null
 * when the input is not a parseable http(s) URL, so callers can fall
 * back to the raw string for diagnostic surfaces only.
 */
function normalizeUrlKey(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const trailing = parsed.pathname && parsed.pathname !== "/" && parsed.pathname.endsWith("/")
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  const search = parsed.search || "";
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${trailing}${search}`;
}

/**
 * Merge prior verification metadata into a freshly saved portfolio
 * item list. Items whose normalized URL AND `type` match an existing
 * item keep their verification block; everything else starts
 * unverified.
 *
 * Both lists may be undefined or empty.
 */
function mergeVerificationMetadata(incomingItems, existingItems) {
  const safeIncoming = Array.isArray(incomingItems) ? incomingItems : [];
  const safeExisting = Array.isArray(existingItems) ? existingItems : [];

  // Build an index keyed by normalized URL + type so cosmetic URL
  // differences (trailing slash, www. prefix, case) do not invalidate
  // a saved verification.
  const byKey = new Map();
  for (const prior of safeExisting) {
    if (!prior || typeof prior !== "object") continue;
    if (!prior.url || !prior.type) continue;
    const norm = normalizeUrlKey(prior.url);
    if (!norm) continue;
    const key = `${prior.type}|${norm}`;
    byKey.set(key, prior);
  }

  return safeIncoming.map((incoming) => {
    const cleaned = stripIncomingVerification(incoming);
    if (!cleaned.url || !cleaned.type) return cleaned;
    const norm = normalizeUrlKey(cleaned.url);
    const key = `${cleaned.type}|${(norm || cleaned.url).toLowerCase()}`;
    const prior = byKey.get(key);
    if (!prior) return cleaned;
    // Carry over only metadata fields — never the title/url/type.
    if (prior.verified !== undefined) cleaned.verified = prior.verified;
    if (prior.verifiedAt !== undefined) cleaned.verifiedAt = prior.verifiedAt;
    if (prior.lastCheckedAt !== undefined) cleaned.lastCheckedAt = prior.lastCheckedAt;
    if (prior.verificationError !== undefined) {
      cleaned.verificationError = prior.verificationError;
    }
    return cleaned;
  });
}

// ─── Persistence ───────────────────────────────────────────────────────────

/**
 * Locate the matching item in `portfolio_items` JSONB by url+type and
 * overwrite its verification fields. Operates with one UPDATE that
 * reads-and-rewrites the JSONB column, so concurrent saves from the
 * same writer still produce a consistent view (last-write-wins, which
 * matches the existing upsert semantics).
 *
 * @param {string} publicKey
 * @param {object} item
 * @param {{ok: boolean, error: string|null, checkedAt: string}} result
 * @returns {Promise<boolean>} true if the row was updated.
 */
async function recordVerificationResult(publicKey, item, result) {
  const safePublicKey =
    typeof publicKey === "string" && /^G[A-Z0-9]{55}$/.test(publicKey);
  if (!safePublicKey) return false;
  if (!item || typeof item !== "object" || !item.url || !item.type) {
    return false;
  }

  const { rows } = await pool.query(
    "SELECT portfolio_items FROM profiles WHERE public_key = $1",
    [publicKey]
  );
  if (!rows.length) return false;
  const items = Array.isArray(rows[0].portfolio_items) ? rows[0].portfolio_items : [];
  let mutated = false;
  const next = items.map((existing) => {
    if (!existing || typeof existing !== "object") return existing;
    if (existing.url === item.url && existing.type === item.type) {
      mutated = true;
      return {
        ...existing,
        verified: result.ok,
        verifiedAt: result.ok ? result.checkedAt : (existing.verifiedAt || null),
        lastCheckedAt: result.checkedAt,
        verificationError: result.ok ? null : (result.error || "verification-failed"),
      };
    }
    return existing;
  });
  if (!mutated) return false;

  await pool.query(
    "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
    [publicKey, JSON.stringify(next)]
  );
  return true;
}

/**
 * Process a single link-verification job from the Bull queue.
 * Catches all errors so retries can kick in via the queue's own backoff.
 */
async function verifyPortfolioItem(publicKey, item) {
  const linkLogger = logger.child({ publicKey, url: item && item.url });
  if (!isVerifiable(item)) {
    linkLogger.debug("Item is not verifiable; skipping");
    return { skipped: true, ok: false, persisted: false, statusCode: null, error: "not-verifiable", checkedAt: null };
  }
  const result = await checkLink(item.url);
  linkLogger.info(
    { ok: result.ok, statusCode: result.statusCode, error: result.error },
    "Link verification result"
  );
  const updated = await recordVerificationResult(publicKey, item, result);
  return {
    skipped: false,
    ok: result.ok,
    persisted: updated,
    statusCode: result.statusCode,
    error: result.error,
    checkedAt: result.checkedAt,
  };
}

/**
 * Enqueue a verification job for each verifiable portfolio item.
 * Items without a URL or of non-verifiable type are silently skipped.
 *
 * @param {{publicKey: string, portfolioItems: object[]}} input
 * @returns {Promise<number>} Number of jobs added.
 */
async function enqueuePortfolioVerification({ publicKey, portfolioItems }) {
  if (typeof publicKey !== "string" || publicKey.length === 0) return 0;
  if (!Array.isArray(portfolioItems)) return 0;

  let added = 0;
  for (const item of portfolioItems) {
    if (!isVerifiable(item)) continue;
    // Normalize the jobId so cosmetic URL variations (`?ref=abc`,
    // trailing slash, host case) do not produce duplicate jobs for the
    // same logical link. Falls back to the raw URL if normalize fails.
    const jobUrl = normalizeUrlKey(item.url) || item.url;
    await linkVerificationQueue.add(
      { publicKey, item },
      { jobId: `${publicKey}:${item.type}:${jobUrl}` }
    );
    added += 1;
  }
  return added;
}

/**
 * Scan the profiles table for portfolio items whose verification
 * metadata is older than `maxAgeDays` days (or missing entirely).
 * Returns up to `limit` profiles, each with the offending items.
 *
 * Uses JSONB path traversal: `(portfolio_items->$[index])->>'verifiedAt'`
 * is null OR older than the threshold.
 *
 * NOTE: this is a read-only path. The returned items contain whatever
 * the worker previously wrote (and any legitimate user-supplied
 * `verified`/`verifiedAt` from past saves, which we trust because the
 * only write paths flow through `stripIncomingVerification` /
 * `mergeVerificationMetadata`). Any future write path that consumes
 * this result MUST re-run the server-controlled metadata strip before
 * persisting.
 */
async function findStalePortfolioLinks({ maxAgeDays = REVERIFY_AGE_DAYS, limit = 200 } = {}) {
  try {
    // The SRF `jsonb_array_elements` returns one column (the element)
    // and `WITH ORDINALITY` adds a second column for the position.
    // The positional alias list `AS ord(item, n)` therefore maps
    // element → `item` and ordinality → `n` (NOT the other way around).
    const { rows } = await pool.query(
      `
      WITH expanded AS (
        SELECT
          p.public_key,
          p.portfolio_items,
          ord.item AS item,
          ord.n    AS item_index
        FROM profiles p,
             LATERAL jsonb_array_elements(p.portfolio_items) WITH ORDINALITY AS ord(item, n) ON TRUE
        WHERE (p.deleted_at IS NULL)
          AND jsonb_typeof(ord.item) = 'object'
          AND ord.item->>'type' IN ('github', 'live')
          AND ord.item->>'url' IS NOT NULL
          AND (
            ord.item->>'verifiedAt' IS NULL
            OR (ord.item->>'verifiedAt')::timestamptz < NOW() - ($1 || ' days')::interval
          )
      )
      SELECT public_key, item
      FROM expanded
      ORDER BY (item->>'verifiedAt') NULLS FIRST
      LIMIT $2
      `,
      [String(maxAgeDays), limit]
    );

    // Bucket rows by publicKey so the scheduler enqueues one job per URL.
    const byKey = new Map();
    for (const row of rows) {
      if (!byKey.has(row.public_key)) byKey.set(row.public_key, []);
      byKey.get(row.public_key).push(row.item);
    }
    return Array.from(byKey.entries()).map(([publicKey, items]) => ({ publicKey, items }));
  } catch (err) {
    logError(logger, err, { operation: "findStalePortfolioLinks" });
    return [];
  }
}

/**
 * Re-queue stale items using `enqueuePortfolioVerification`. Designed to
 * be called from a periodic scheduler; never throws.
 */
async function requeueStalePortfolioLinks(opts) {
  const jobs = await findStalePortfolioLinks(opts);
  let queued = 0;
  for (const { publicKey, items } of jobs) {
    queued += await enqueuePortfolioVerification({ publicKey, portfolioItems: items });
  }
  return { profiles: jobs.length, jobsQueued: queued };
}

module.exports = {
  REVERIFY_AGE_DAYS,
  VERIFIABLE_TYPES,
  VERIFY_TIMEOUT_MS,
  isBlockedAddressLiteral,
  isBlockedHostname,
  validateUrlSafety,
  normalizeUrlKey,
  checkLink,
  isVerifiable,
  mergeVerificationMetadata,
  stripIncomingVerification,
  recordVerificationResult,
  verifyPortfolioItem,
  enqueuePortfolioVerification,
  findStalePortfolioLinks,
  requeueStalePortfolioLinks,
};
