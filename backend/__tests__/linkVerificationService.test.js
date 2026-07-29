/**
 * __tests__/linkVerificationService.test.js
 *
 * Unit tests for the portfolio link verification service
 * (linkVerificationService.js). We mock the database pool so the suite
 * does not require Postgres runtime, and we inject a fake `fetchImpl`
 * + `lookupFn` so the HTTP layer is fully deterministic.
 */

"use strict";

jest.mock("../src/db/pool", () => ({
  query: jest.fn(),
}));

// Stub the Bull queue so enqueue tests do not require Redis.
jest.mock("../src/utils/queue", () => {
  const fn = jest.fn();
  return { emailQueue: {}, linkVerificationQueue: { add: fn } };
});

const pool = require("../src/db/pool");
const { linkVerificationQueue } = require("../src/utils/queue");

const {
  checkLink,
  isVerifiable,
  isBlockedAddressLiteral,
  isBlockedHostname,
  validateUrlSafety,
  normalizeUrlKey,
  mergeVerificationMetadata,
  stripIncomingVerification,
  verifyPortfolioItem,
  recordVerificationResult,
  enqueuePortfolioVerification,
  findStalePortfolioLinks,
  VERIFIABLE_TYPES,
  REVERIFY_AGE_DAYS,
} = require("../src/services/linkVerificationService");

const VALID_PUBLIC_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

function mockFetchOnce({ status = 200, ok, statusText = "OK" } = {}) {
  return jest.fn().mockResolvedValue({
    status,
    ok: ok ?? (status >= 200 && status < 300),
    statusText,
    body: { cancel: () => Promise.resolve() },
  });
}

beforeEach(() => {
  pool.query.mockReset();
  jest.clearAllMocks();
  linkVerificationQueue.add.mockReset();
  linkVerificationQueue.add.mockResolvedValue({ id: "fake" });
});

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe("isBlockedAddressLiteral", () => {
  test("blocks IPv4 loopback, RFC1918, link-local, CGNAT, multicast", () => {
    expect(isBlockedAddressLiteral("127.0.0.1")).toBe(true);
    expect(isBlockedAddressLiteral("10.0.0.1")).toBe(true);
    expect(isBlockedAddressLiteral("192.168.1.5")).toBe(true);
    expect(isBlockedAddressLiteral("172.16.0.10")).toBe(true);
    expect(isBlockedAddressLiteral("172.31.255.255")).toBe(true);
    expect(isBlockedAddressLiteral("172.32.0.1")).toBe(false);
    expect(isBlockedAddressLiteral("169.254.1.1")).toBe(true);
    expect(isBlockedAddressLiteral("100.64.0.1")).toBe(true);
    expect(isBlockedAddressLiteral("224.0.0.1")).toBe(true);
  });

  test("blocks IPv6 loopback / link-local / unique-local / multicast", () => {
    expect(isBlockedAddressLiteral("::1")).toBe(true);
    expect(isBlockedAddressLiteral("fe80::1")).toBe(true);
    expect(isBlockedAddressLiteral("fc00::1")).toBe(true);
    expect(isBlockedAddressLiteral("fd12::1")).toBe(true);
    expect(isBlockedAddressLiteral("ff02::1")).toBe(true);
    expect(isBlockedAddressLiteral("2606:4700:4700::1111")).toBe(false);
  });

  test("blocks the string 'localhost'", () => {
    expect(isBlockedAddressLiteral("localhost")).toBe(true);
  });

  test("passes public IPv4", () => {
    expect(isBlockedAddressLiteral("8.8.8.8")).toBe(false);
    expect(isBlockedAddressLiteral("1.1.1.1")).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  test("blocks literal IPs already in the blocklist", async () => {
    expect(await isBlockedHostname("127.0.0.1")).toBe(true);
  });

  test("blocks hostnames that resolve to a private IP", async () => {
    const lookup = async () => ({ address: "10.0.0.5", family: 4 });
    expect(await isBlockedHostname("internal.local", { lookup })).toBe(true);
  });

  test("passes hostnames that resolve to public IPs", async () => {
    const lookup = async () => ({ address: "8.8.8.8", family: 4 });
    expect(await isBlockedHostname("dns.google", { lookup })).toBe(false);
  });

  test("fails closed when DNS lookup throws", async () => {
    const lookup = async () => { throw new Error("NXDOMAIN"); };
    expect(await isBlockedHostname("no-such-host.test", { lookup })).toBe(true);
  });
});

describe("validateUrlSafety", () => {
  test("rejects non-http(s) protocols", async () => {
    expect(await validateUrlSafety("file:///etc/passwd")).toEqual({ ok: false, error: "invalid-protocol" });
    expect(await validateUrlSafety("ftp://example.com")).toEqual({ ok: false, error: "invalid-protocol" });
  });

  test("rejects malformed urls", async () => {
    expect(await validateUrlSafety("not a url")).toEqual({ ok: false, error: "invalid-url" });
  });

  test("rejects urls whose hostname is a loopback literal", async () => {
    expect(await validateUrlSafety("http://127.0.0.1/admin")).toEqual({ ok: false, error: "blocked-host" });
  });

  test("rejects urls whose hostname resolves to a private IP", async () => {
    const lookup = async () => ({ address: "192.168.1.10", family: 4 });
    expect(await validateUrlSafety("https://internal.local/path", { lookup }))
      .toEqual({ ok: false, error: "blocked-host" });
  });

  test("accepts public https urls with public DNS resolution", async () => {
    const lookup = async () => ({ address: "140.82.114.4", family: 4 });
    expect(await validateUrlSafety("https://github.com/example/repo", { lookup }))
      .toEqual({ ok: true });
  });
});

describe("isVerifiable", () => {
  test("returns true for github and live items with a url", () => {
    expect(isVerifiable({ type: "github", url: "https://github.com/foo" })).toBe(true);
    expect(isVerifiable({ type: "live", url: "https://example.com" })).toBe(true);
  });

  test("returns false for stellar_tx and file items even with a url", () => {
    expect(isVerifiable({ type: "stellar_tx", url: "abc-tx-hash" })).toBe(false);
    expect(isVerifiable({ type: "file", url: "https://ipfs.io/abc" })).toBe(false);
  });

  test("returns false for github/live without a non-empty url", () => {
    expect(isVerifiable({ type: "github", url: null })).toBe(false);
    expect(isVerifiable({ type: "github" })).toBe(false);
    expect(isVerifiable({ type: "github", url: "" })).toBe(false);
    expect(isVerifiable({ type: "live", url: "   " })).toBe(false);
  });

  test("returns false for null and non-objects", () => {
    expect(isVerifiable(null)).toBe(false);
    expect(isVerifiable("not an object")).toBe(false);
    expect(isVerifiable([])).toBe(false);
  });
});

describe("normalizeUrlKey", () => {
  test("lowercases host, strips single trailing slash on non-root paths", () => {
    expect(normalizeUrlKey("https://GitHub.com/Foo/")).not.toBe("https://GitHub.com/Foo/");
    expect(normalizeUrlKey("https://github.com/foo/")).toBe(normalizeUrlKey("https://github.com/foo"));
    expect(normalizeUrlKey("https://github.com/foo/")).toBe("https://github.com/foo");
  });

  test("keeps query strings", () => {
    expect(normalizeUrlKey("https://github.com/foo?ref=1")).toBe("https://github.com/foo?ref=1");
  });

  test("keeps root path as /", () => {
    expect(normalizeUrlKey("https://example.com/")).toBe("https://example.com/");
  });

  test("returns null for invalid input", () => {
    expect(normalizeUrlKey(null)).toBeNull();
    expect(normalizeUrlKey("not a url")).toBeNull();
    expect(normalizeUrlKey("ftp://example.com/")).toBeNull();
    expect(normalizeUrlKey(42)).toBeNull();
  });
});

describe("stripIncomingVerification", () => {
  test("removes all four verification keys", () => {
    expect(stripIncomingVerification({
      title: "Repo",
      url: "https://x",
      type: "github",
      verified: true,
      verifiedAt: "x",
      verificationError: "y",
      lastCheckedAt: "z",
    })).toEqual({ title: "Repo", url: "https://x", type: "github" });
  });

  test("passes through items that have no verification keys", () => {
    expect(stripIncomingVerification({ title: "Repo", url: "https://x", type: "github" }))
      .toEqual({ title: "Repo", url: "https://x", type: "github" });
  });
});

describe("mergeVerificationMetadata", () => {
  test("carries over verification when url+type match", () => {
    const incoming = [{ title: "Old title", url: "https://x", type: "github" }];
    const existing = [{
      title: "Old title", url: "https://x", type: "github",
      verified: true, verifiedAt: "v1", lastCheckedAt: "v2", verificationError: null,
    }];
    expect(mergeVerificationMetadata(incoming, existing)).toEqual([{
      title: "Old title", url: "https://x", type: "github",
      verified: true, verifiedAt: "v1", lastCheckedAt: "v2", verificationError: null,
    }]);
  });

  test("does NOT carry over when url changes", () => {
    const incoming = [{ title: "Repo", url: "https://new", type: "github" }];
    const existing = [{
      title: "Repo", url: "https://old", type: "github",
      verified: true, verifiedAt: "v1",
    }];
    expect(mergeVerificationMetadata(incoming, existing)).toEqual([
      { title: "Repo", url: "https://new", type: "github" },
    ]);
  });

  test("does NOT carry over when type changes", () => {
    const incoming = [{ title: "Repo", url: "https://x", type: "live" }];
    const existing = [{
      title: "Repo", url: "https://x", type: "github",
      verified: true,
    }];
    expect(mergeVerificationMetadata(incoming, existing)).toEqual([
      { title: "Repo", url: "https://x", type: "live" },
    ]);
  });

  test("ignores user-supplied verification fields even when matching", () => {
    const incoming = [{
      title: "Repo", url: "https://x", type: "github",
      verified: true, // user-supplied — must be stripped out
      verifiedAt: "fake",
    }];
    const existing = [{
      title: "Repo", url: "https://x", type: "github",
      verified: false, verifiedAt: "real",
    }];
    const result = mergeVerificationMetadata(incoming, existing);
    expect(result[0].verified).toBe(false);
    expect(result[0].verifiedAt).toBe("real");
  });

  test("treats undefined / empty lists as empty", () => {
    expect(mergeVerificationMetadata(undefined, [])).toEqual([]);
    expect(mergeVerificationMetadata([], undefined)).toEqual([]);
    expect(mergeVerificationMetadata(undefined, undefined)).toEqual([]);
  });
});

// ─── checkLink (network mocked) ───────────────────────────────────────────

describe("checkLink", () => {
  test("returns ok=true on a 200 response", async () => {
    const fetchImpl = mockFetchOnce({ status: 200 });
    const lookupFn = async () => false;
    const result = await checkLink("https://example.com", { fetchImpl, lookupFn });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(result.checkedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("returns ok=false on a 404", async () => {
    const fetchImpl = mockFetchOnce({ status: 404 });
    const lookupFn = async () => false;
    const result = await checkLink("https://example.com/missing", { fetchImpl, lookupFn });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toBe("http-404");
  });

  test("returns ok=false on a 500", async () => {
    const fetchImpl = mockFetchOnce({ status: 500 });
    const lookupFn = async () => false;
    const result = await checkLink("https://example.com/oops", { fetchImpl, lookupFn });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe("http-500");
  });

  test("returns ok=false when fetch rejects (timeout / network error)", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const lookupFn = async () => false;
    const result = await checkLink("https://example.com", { fetchImpl, lookupFn });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBe("timeout");
  });

  test("returns ok=false on non-string input", async () => {
    const result = await checkLink(null);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid-url");
  });

  test("falls back to GET when HEAD returns 405", async () => {
    const headMock = mockFetchOnce({ status: 405 });
    const getMock = mockFetchOnce({ status: 200 });
    const fetchImpl = jest.fn((url, init) => {
      if (init && init.method === "HEAD") return headMock(url, init);
      return getMock(url, init);
    });
    const lookupFn = async () => false;
    const result = await checkLink("https://example.com", { fetchImpl, lookupFn });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].method).toBe("HEAD");
    expect(fetchImpl.mock.calls[1][1].method).toBe("GET");
  });
});

// ─── verifyPortfolioItem (DB mocked) ──────────────────────────────────────

describe("verifyPortfolioItem", () => {
  const publicKey = VALID_PUBLIC_KEY;
  const item = { title: "Repo", url: "https://example.com/repo", type: "github" };

  beforeEach(() => {
    // Inject deterministic fetch + lookup through the service options.
    // (verifyPortfolioItem does not accept opts but it reads from
    // global fetch. We mock the global instead for this block.)
    global.fetch = mockFetchOnce({ status: 200 });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test("records ok=true when HEAD returns 200", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ portfolio_items: [
        { title: item.title, url: item.url, type: item.type },
      ] }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await verifyPortfolioItem(publicKey, item);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.persisted).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);

    const persisted = JSON.parse(pool.query.mock.calls[1][1][1]);
    expect(persisted[0]).toMatchObject({
      title: "Repo",
      url: item.url,
      type: "github",
      verified: true,
      verificationError: null,
      lastCheckedAt: result.checkedAt,
    });
  });

  test("flips verified to false but keeps prior verifiedAt when re-verification fails", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ portfolio_items: [
        {
          title: item.title, url: item.url, type: item.type,
          verified: true, verifiedAt: "2026-04-01T00:00:00.000Z",
        },
      ] }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    global.fetch = mockFetchOnce({ status: 500 });
    const result = await verifyPortfolioItem(publicKey, item);

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.persisted).toBe(true);
    expect(result.error).toBe("http-500");

    const persisted = JSON.parse(pool.query.mock.calls[1][1][1]);
    expect(persisted[0]).toMatchObject({
      verified: false,                          // flipped to false on failure
      verifiedAt: "2026-04-01T00:00:00.000Z",   // preserved: "last successful" timestamp
      verificationError: "http-500",
      lastCheckedAt: result.checkedAt,
    });
  });

  test("returns skipped for non-verifiable types", async () => {
    const result = await verifyPortfolioItem(publicKey, {
      title: "Hash", url: "abc123", type: "stellar_tx",
    });
    expect(result.skipped).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns skipped when verifiable type is missing a url", async () => {
    const result = await verifyPortfolioItem(publicKey, {
      title: "Repo", type: "github",
      // url missing
    });
    expect(result.skipped).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns ok + persisted:false when profile row missing", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await verifyPortfolioItem(publicKey, item);
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("does not write when no matching item exists in the profile", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ portfolio_items: [{ title: "Different", url: "https://elsewhere.com", type: "live" }] }],
    });

    const result = await verifyPortfolioItem(publicKey, item);
    expect(result.persisted).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("returns false for invalid public key shape", async () => {
    const result = await verifyPortfolioItem("not-a-g-address", item);
    expect(result.persisted).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── recordVerificationResult (direct) ────────────────────────────────────

describe("recordVerificationResult", () => {
  test("returns false on bad public key", async () => {
    const ok = await recordVerificationResult(
      "not-a-g-address",
      { url: "https://x", type: "github" },
      { ok: true, checkedAt: "2026-04-01T00:00:00.000Z", error: null }
    );
    expect(ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns false when profile row missing", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const ok = await recordVerificationResult(
      VALID_PUBLIC_KEY,
      { url: "https://x", type: "github" },
      { ok: true, checkedAt: "2026-04-01T00:00:00.000Z", error: null }
    );
    expect(ok).toBe(false);
  });
});

// ─── enqueuePortfolioVerification ─────────────────────────────────────────

describe("enqueuePortfolioVerification", () => {
  test("enqueues one job per verifiable item", async () => {
    const portfolioItems = [
      { title: "Repo", url: "https://github.com/x", type: "github" },
      { title: "Site", url: "https://example.com", type: "live" },
      { title: "Tx", url: "abc-tx", type: "stellar_tx" }, // skipped
      { title: "Img", url: "https://ipfs/...", type: "file" }, // skipped
      { title: "NoUrl", type: "github" }, // skipped (no url)
    ];
    const queued = await enqueuePortfolioVerification({
      publicKey: VALID_PUBLIC_KEY,
      portfolioItems,
    });
    expect(queued).toBe(2);
    expect(linkVerificationQueue.add).toHaveBeenCalledTimes(2);
    expect(linkVerificationQueue.add.mock.calls[0][0]).toMatchObject({
      publicKey: VALID_PUBLIC_KEY,
      item: portfolioItems[0],
    });
  });

  test("returns 0 when portfolioItems is missing or empty", async () => {
    expect(await enqueuePortfolioVerification({ publicKey: VALID_PUBLIC_KEY, portfolioItems: [] })).toBe(0);
    expect(await enqueuePortfolioVerification({ publicKey: VALID_PUBLIC_KEY })).toBe(0);
    expect(linkVerificationQueue.add).not.toHaveBeenCalled();
  });
});

// ─── findStalePortfolioLinks ──────────────────────────────────────────────

describe("findStalePortfolioLinks", () => {
  test("returns profiles with stale items, grouped by publicKey", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { public_key: "G" + "A".repeat(55), item: { url: "https://a", type: "github", verifiedAt: null } },
        { public_key: "G" + "A".repeat(55), item: { url: "https://b", type: "live", verifiedAt: "2026-01-01T00:00:00.000Z" } },
        { public_key: "G" + "B".repeat(55), item: { url: "https://c", type: "live", verifiedAt: "2026-01-01T00:00:00.000Z" } },
      ],
    });
    const out = await findStalePortfolioLinks({ maxAgeDays: 7, limit: 10 });
    expect(out).toHaveLength(2);
    expect(out[0].items).toHaveLength(2);
    expect(out[1].items).toHaveLength(1);
  });

  test("returns empty array when the query throws", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    const out = await findStalePortfolioLinks({});
    expect(out).toEqual([]);
  });

  test("REVERIFY_AGE_DAYS is exported and equals 7", () => {
    expect(REVERIFY_AGE_DAYS).toBe(7);
  });
});

// ─── Surface: VERIFIABLE_TYPES exports ────────────────────────────────────

describe("module exports", () => {
  test("VERIFIABLE_TYPES contains github and live only", () => {
    expect(VERIFIABLE_TYPES.has("github")).toBe(true);
    expect(VERIFIABLE_TYPES.has("live")).toBe(true);
    expect(VERIFIABLE_TYPES.has("stellar_tx")).toBe(false);
    expect(VERIFIABLE_TYPES.has("file")).toBe(false);
  });
});
