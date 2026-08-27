"use strict";

/**
 * src/routes/admin.test.js
 *
 * Route-level test suite for the admin router (src/routes/admin.js), covering
 * every endpoint (Issue #1135):
 *
 *   GET    /api/admin/users                list users with filters
 *   POST   /api/admin/users/:address/ban   soft-ban a user
 *   POST   /api/admin/users/:address/unban unban a user
 *   POST   /api/admin/jobs/:id/remove      admin soft-delete a job
 *   GET    /api/admin/metrics              platform analytics dashboard
 *   GET    /api/admin/reports/jobs         flagged/reported jobs
 *   GET    /api/admin/disputes             open disputes
 *   GET    /api/admin/reported-wallets     reported addresses
 *   GET    /api/admin/logs                 admin action audit log
 *   GET    /api/admin/audit-log            structured state-change audit log
 *   PATCH  /api/admin/disputes/:jobId/resolve   resolve a dispute
 *   PATCH  /api/admin/jobs/:jobId/cancel   cancel a flagged job
 *   POST   /api/admin/wallets/:address/freeze   freeze a wallet
 *   DELETE /api/admin/wallets/:address/freeze   unfreeze a wallet
 *   GET    /api/admin/wallets/frozen       list frozen wallets
 *   GET    /api/admin/jobs                 list all jobs (NOT 2FA-guarded)
 *   GET    /api/admin/jobs/expired         list expired jobs
 *   POST   /api/admin/jobs/:jobId/reactivate   reactivate an expired job
 *   GET    /api/admin/cost-report          infra cost report (static)
 *   POST   /api/admin/cost-report/generate trigger cost report email
 *   GET    /api/admin/metrics/time-series  platform_metrics for charting
 *   GET    /api/admin/api-keys/usage       per-key usage stats (Issue #1186)
 *   GET    /api/admin/reports/latest       download latest weekly PDF
 *   POST   /api/admin/reports/generate     manually trigger report generation
 *
 * Harness notes:
 *   - The pool is mocked with src/testUtils/pgMock.js (see the mock below).
 *   - The REAL auth middleware (verifyJWT / requireAdminRole /
 *     requireAdmin2FA) is wired in, so unauthenticated (401), non-admin (403)
 *     and missing-2FA (403) rejections are exercised end to end.
 *   - The REAL csrf-csrf double-submit middleware is wired in, so mutating
 *     requests carry a CSRF token fetched from GET /api/auth/csrf-token via
 *     src/testUtils/csrfTestHelpers.js — and requests without one are
 *     rejected with 403.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/jobService", () => ({
  updateJobStatus: jest.fn(),
  listJobs: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  logContractInteraction: jest.fn(),
}));

jest.mock("../services/auditLogService", () => ({
  listAuditLogs: jest.fn(),
}));

jest.mock("../services/developerService", () => ({
  getApiKeyUsageStats: jest.fn(),
}));

jest.mock("../services/adminReportService", () => ({
  downloadLatestFromS3: jest.fn(),
  generateAndSendAdminReport: jest.fn(),
}));

jest.mock("../utils/email", () => ({
  sendEmail: jest.fn(),
}));

const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const pool = require("../db/pool");
const adminRoutes = require("./admin");
const { JWT_SECRET } = require("../middleware/auth");
const {
  doubleCsrfProtection,
  generateCsrfToken,
} = require("../middleware/csrf");
const { fetchCsrf } = require("../testUtils/csrfTestHelpers");
const { updateJobStatus, listJobs } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");
const { listAuditLogs } = require("../services/auditLogService");
const { getApiKeyUsageStats } = require("../services/developerService");
const {
  downloadLatestFromS3,
  generateAndSendAdminReport,
} = require("../services/adminReportService");
const { sendEmail } = require("../utils/email");

// ─────────────────────────────────────────────────────────────────────────
// Harness — minimal Express app with real auth + real CSRF middleware
// ─────────────────────────────────────────────────────────────────────────

const app = express();
// lgtm [js/missing-token-validation]
app.use(cookieParser());
app.use(doubleCsrfProtection);
// CSRF bootstrap endpoint used by fetchCsrf() (mirrors src/routes/auth.js).
app.get("/api/auth/csrf-token", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});
app.use(express.json());
app.use("/api/admin", adminRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fixtures / helpers
// ─────────────────────────────────────────────────────────────────────────

const ADMIN = "G" + "A".repeat(55);
const USER = "G" + "U".repeat(55);
const ADDRESS = "G" + "C".repeat(55);

function adminToken(extra = {}) {
  return jwt.sign(
    Object.assign({ publicKey: ADMIN, address: ADMIN, role: "admin" }, extra),
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function userToken() {
  return jwt.sign(
    { publicKey: USER, address: USER, role: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const MUTATING_METHODS = new Set(["post", "put", "patch", "delete", "del"]);

/**
 * Issue a request against the harness. Mutating requests automatically fetch
 * and attach a fresh CSRF token (cookie + X-CSRF-Token header), matching how
 * the real SPA authenticates (auth via the `token` cookie, not Bearer, so the
 * CSRF middleware applies). Pass `{ csrf: false }` for CSRF-negative tests.
 */
async function send(method, url, { token, body, csrf = true, query } = {}) {
  let req = request(app)[method](url);
  const cookies = [];

  if (csrf && MUTATING_METHODS.has(method)) {
    const csrfPair = await fetchCsrf(app);
    if (csrfPair.cookie) cookies.push(csrfPair.cookie);
    req = req.set("x-csrf-token", csrfPair.token);
  }
  if (token) cookies.push(`token=${token}`);
  if (cookies.length) req = req.set("Cookie", cookies.join("; "));
  if (query) req = req.query(query);
  if (body !== undefined) req = req.send(body);
  return req;
}

function userRow(overrides = {}) {
  return {
    public_key: USER,
    display_name: "Test Freelancer",
    bio: "Full-stack developer on Stellar",
    role: "freelancer",
    skills: ["solidity", "node"],
    completed_jobs: 5,
    total_earned_xlm: "120.5000000",
    rating: "4.80",
    reputation_points: 12,
    flagged: false,
    banned_at: null,
    banned_by: null,
    ban_reason: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_login_at: null,
    ...overrides,
  };
}

function usageStats(overrides = {}) {
  return {
    lookbackDays: 7,
    keys: [
      {
        id: 1,
        label: "staging-bot",
        key_prefix: "mk_live_ab12",
        requests_today: 42,
        requests_last_hour: 7,
        endpoint_breakdown: [
          {
            endpoint: "/api/public/jobs",
            requests: 7,
            lastMinute: "2026-08-26T10:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

// Metric fixture rows for GET /api/admin/metrics (8 queries).
const METRICS_ROWS = {
  health: {
    total_jobs: 10,
    open_jobs: 4,
    completed_jobs: 3,
    disputed_jobs: 1,
    completion_rate: "60.00",
    dispute_rate: "10.00",
  },
  userGrowth: {
    total_users: 100,
    freelancers: 40,
    clients: 60,
    new_users_period: 5,
  },
  weeklyGrowth: [{ week: "2026-01-05T00:00:00.000Z", new_users: 3 }],
  financial: {
    total_xlm_escrow: "500.0000000",
    total_xlm_released: "200.0000000",
    avg_job_budget: "50.0000000",
    active_escrows: 2,
  },
  quality: { avg_rating: "4.50", total_ratings: 8, repeat_hires: 1 },
  disputeMetrics: [
    {
      week: "2026-01-05T00:00:00.000Z",
      disputes_opened: 1,
      disputes_resolved: 0,
    },
  ],
  topEarners: [
    {
      public_key: USER,
      display_name: "Test Freelancer",
      total_earned_xlm: "120.0000000",
      completed_jobs: 5,
      rating: "4.80",
    },
  ],
  jobVolume: [
    { date: "2026-01-05T00:00:00.000Z", jobs_created: 2, jobs_completed: 1 },
  ],
};

function stubMetrics() {
  pool.query.mockImplementation((sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
    if (text.includes("total_jobs"))
      return Promise.resolve({ rows: [METRICS_ROWS.health] });
    if (text.includes("total_users"))
      return Promise.resolve({ rows: [METRICS_ROWS.userGrowth] });
    if (text.includes("disputes_opened"))
      return Promise.resolve({ rows: METRICS_ROWS.disputeMetrics });
    if (text.includes("total_xlm_escrow"))
      return Promise.resolve({ rows: [METRICS_ROWS.financial] });
    if (text.includes("avg_rating"))
      return Promise.resolve({ rows: [METRICS_ROWS.quality] });
    if (text.includes("total_earned_xlm > 0"))
      return Promise.resolve({ rows: METRICS_ROWS.topEarners });
    if (text.includes("jobs_created"))
      return Promise.resolve({ rows: METRICS_ROWS.jobVolume });
    if (
      text.includes("DATE_TRUNC('week', created_at)") &&
      text.includes("FROM profiles")
    ) {
      return Promise.resolve({ rows: METRICS_ROWS.weeklyGrowth });
    }
    return Promise.resolve({ rows: [] });
  });
}

// Snapshot the default pgMock implementation so each test starts clean.
const DEFAULT_POOL_QUERY = pool.query.getMockImplementation();

beforeEach(() => {
  pool.reset();
  pool.query.mockReset();
  pool.query.mockImplementation(DEFAULT_POOL_QUERY);
  jest.clearAllMocks();

  getApiKeyUsageStats.mockResolvedValue(usageStats());
  updateJobStatus.mockResolvedValue({ rows: [], rowCount: 1 });
  listJobs.mockResolvedValue({ jobs: [], nextCursor: null });
  listAuditLogs.mockResolvedValue({ rows: [], nextCursor: null });
  logContractInteraction.mockResolvedValue(undefined);
  downloadLatestFromS3.mockResolvedValue(null);
  generateAndSendAdminReport.mockResolvedValue({ reportId: 1, emailed: true });
  sendEmail.mockResolvedValue({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Auth / authorization guards
// ─────────────────────────────────────────────────────────────────────────

// Every admin endpoint except GET /api/admin/jobs is guarded by
// verifyJWT + requireAdminRole + requireAdmin2FA.
const GUARDED_ENDPOINTS = [
  ["get", "/api/admin/users"],
  ["get", "/api/admin/metrics"],
  ["get", "/api/admin/reports/jobs"],
  ["get", "/api/admin/disputes"],
  ["get", "/api/admin/reported-wallets"],
  ["get", "/api/admin/logs"],
  ["get", "/api/admin/audit-log"],
  ["get", "/api/admin/wallets/frozen"],
  ["get", "/api/admin/jobs/expired"],
  ["get", "/api/admin/cost-report"],
  ["get", "/api/admin/metrics/time-series"],
  ["get", "/api/admin/api-keys/usage"],
  ["get", "/api/admin/reports/latest"],
  ["post", `/api/admin/users/${ADDRESS}/ban`],
  ["post", `/api/admin/users/${ADDRESS}/unban`],
  ["post", "/api/admin/jobs/job-1/remove"],
  ["patch", "/api/admin/disputes/job-1/resolve"],
  ["patch", "/api/admin/jobs/job-1/cancel"],
  ["post", `/api/admin/wallets/${ADDRESS}/freeze`],
  ["delete", `/api/admin/wallets/${ADDRESS}/freeze`],
  ["post", "/api/admin/jobs/job-1/reactivate"],
  ["post", "/api/admin/cost-report/generate"],
  ["post", "/api/admin/reports/generate"],
];

describe("Admin auth guards", () => {
  it.each(GUARDED_ENDPOINTS)(
    "401 — %s %s rejects unauthenticated requests",
    async (method, url) => {
      const res = await send(method, url);
      expect(res.status).toBe(401);
    },
  );

  it.each(GUARDED_ENDPOINTS)(
    "403 — %s %s rejects non-admin roles",
    async (method, url) => {
      const res = await send(method, url, { token: userToken() });
      expect(res.status).toBe(403);
    },
  );

  it("403 — rejects an invalid/expired token", async () => {
    const res = await send("get", "/api/admin/users", {
      token: "not-a-real-jwt",
    });
    expect(res.status).toBe(401);
  });

  it("403 — admin without 2FA is blocked when totp_enabled is set", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) {
        return Promise.resolve({ rows: [{ totp_enabled: true }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/users", { token: adminToken() });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "2FA required",
      requires2FA: true,
    });
  });

  it("200 — admin with a verified 2FA claim passes the 2FA guard", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) {
        return Promise.resolve({ rows: [{ totp_enabled: true }] });
      }
      if (text.includes("COUNT(*)::int"))
        return Promise.resolve({ rows: [{ total: 1 }] });
      if (text.includes("FROM profiles") && text.includes("ORDER BY")) {
        return Promise.resolve({ rows: [userRow()] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/users", {
      token: adminToken({ "2fa_verified": true }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("500 — fails closed when the 2FA status lookup errors", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) {
        return Promise.reject(new Error("db down"));
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/users", { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to verify 2FA status");
  });

  it("403 — mutating requests without a CSRF token are rejected", async () => {
    const res = await send("post", `/api/admin/users/${ADDRESS}/ban`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
      csrf: false,
    });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  function stubUsers(rows) {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("COUNT(*)::int") && text.includes("FROM profiles")) {
        return Promise.resolve({ rows: [{ total: rows.length }] });
      }
      if (text.includes("FROM profiles") && text.includes("ORDER BY")) {
        return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it("200 — returns the paginated user list with defaults", async () => {
    stubUsers([userRow(), userRow({ public_key: "G" + "B".repeat(55) })]);
    const res = await send("get", "/api/admin/users", { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ total: 2, limit: 50, offset: 0 });
  });

  it("200 — applies filters, search and pagination to the query", async () => {
    stubUsers([userRow()]);
    const res = await send("get", "/api/admin/users", {
      token: adminToken(),
      query: {
        role: "freelancer",
        flagged: "true",
        banned: "true",
        search: "alice",
        limit: "10",
        offset: "5",
        sort: "display_name",
        order: "ASC",
      },
    });

    expect(res.status).toBe(200);
    const selectCall = pool.query.mock.calls.find(([sql]) => {
      const text = String(sql).replace(/\s+/g, " ");
      return text.includes("FROM profiles") && text.includes("ORDER BY");
    });
    expect(selectCall).toBeDefined();
    const [selectSql, selectParams] = selectCall;
    expect(selectSql).toContain("role = $1");
    expect(selectSql).toContain("flagged = true");
    expect(selectSql).toContain("banned_at IS NOT NULL");
    expect(selectSql).toContain("deleted_at IS NULL");
    expect(selectSql).toContain("ILIKE");
    expect(selectSql).toContain("ORDER BY display_name ASC");
    expect(selectParams).toEqual(["freelancer", "%alice%", 10, 5]);
    expect(res.body.pagination).toEqual({ total: 1, limit: 10, offset: 5 });
  });

  it("200 — includes soft-deleted users only when explicitly requested", async () => {
    stubUsers([userRow({ deleted_at: "2026-02-01T00:00:00.000Z" })]);
    const res = await send("get", "/api/admin/users", {
      token: adminToken(),
      query: { deleted: "true" },
    });

    expect(res.status).toBe(200);
    const selectSql = pool.query.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " "))
      .find(
        (text) => text.includes("FROM profiles") && text.includes("ORDER BY"),
      );
    expect(selectSql).toContain("deleted_at IS NOT NULL");
  });

  it("200 — falls back to a safe sort column on SQL-injection style input", async () => {
    stubUsers([userRow()]);
    const res = await send("get", "/api/admin/users", {
      token: adminToken(),
      query: { sort: "created_at; DROP TABLE profiles" },
    });

    expect(res.status).toBe(200);
    const selectSql = pool.query.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " "))
      .find(
        (text) => text.includes("FROM profiles") && text.includes("ORDER BY"),
      );
    expect(selectSql).toContain("ORDER BY created_at DESC");
  });

  it("200 — unknown roles are ignored rather than crashing", async () => {
    stubUsers([userRow()]);
    const res = await send("get", "/api/admin/users", {
      token: adminToken(),
      query: { role: "superuser" },
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("profiles query exploded"));
    });

    const res = await send("get", "/api/admin/users", { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("profiles query exploded");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/:address/ban
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/users/:address/ban", () => {
  it("400 — rejects a malformed Stellar address", async () => {
    const res = await send("post", "/api/admin/users/not-an-address/ban", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar address");
    const profileUpdates = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE profiles"),
    );
    expect(profileUpdates).toHaveLength(0);
  });

  it("404 — returns not found when no matching user exists", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles"))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/ban`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("200 — bans a user and audits the action with the provided reason", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles")) {
        return Promise.resolve({
          rows: [
            userRow({
              public_key: ADDRESS,
              banned_at: "2026-08-26T00:00:00.000Z",
              ban_reason: "spam",
            }),
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/ban`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain(ADDRESS);
    expect(res.body.data.ban_reason).toBe("spam");

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE profiles"),
      [ADMIN, "spam", ADDRESS],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([ADMIN, "ban_user", ADDRESS, "spam"]),
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "ban_user", "user", ADDRESS]),
    );
  });

  it("200 — uses the default ban reason when none is supplied", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles")) {
        return Promise.resolve({ rows: [userRow({ public_key: ADDRESS })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/ban`, {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE profiles"),
      [ADMIN, "Violation of platform terms", ADDRESS],
    );
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles"))
        return Promise.reject(new Error("db down"));
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/ban`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("db down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/:address/unban
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/users/:address/unban", () => {
  it("400 — rejects a malformed Stellar address", async () => {
    const res = await send("post", "/api/admin/users/nope/ban", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar address");
  });

  it("404 — returns not found when no matching user exists", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles"))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/unban`, {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("200 — unbans a user and audits the action", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE profiles")) {
        return Promise.resolve({
          rows: [userRow({ public_key: ADDRESS, banned_at: null })],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/users/${ADDRESS}/unban`, {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE profiles"),
      [ADDRESS],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "unban_user", "user", ADDRESS]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/jobs/:id/remove
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/jobs/:id/remove", () => {
  it("404 — returns not found when the job is missing or already removed", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE jobs") && text.includes("removed_at")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/jobs/job-42/remove", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "violates ToS" },
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found or already removed");
  });

  it("200 — removes a job and audits the action with the provided reason", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE jobs") && text.includes("removed_at")) {
        return Promise.resolve({
          rows: [
            {
              id: "job-42",
              title: "Build a dApp",
              status: "cancelled",
              removed_at: "2026-08-26T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/jobs/job-42/remove", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "violates ToS" },
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("job-42");
    expect(res.body.data.status).toBe("cancelled");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs"),
      [ADMIN, "violates ToS", "job-42"],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "remove_job", "job", "job-42"]),
    );
  });

  it("200 — falls back to the default removal reason", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE jobs") && text.includes("removed_at")) {
        return Promise.resolve({
          rows: [
            {
              id: "job-42",
              title: "t",
              status: "cancelled",
              removed_at: "2026-08-26T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/jobs/job-42/remove", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs"),
      [ADMIN, "Admin removal", "job-42"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/metrics", () => {
  it("200 — returns the full analytics dashboard (default 30d)", async () => {
    stubMetrics();
    const res = await send("get", "/api/admin/metrics", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe("30d");
    expect(res.body.data.platformHealth).toMatchObject({
      total_jobs: 10,
      open_jobs: 4,
    });
    expect(res.body.data.userGrowth).toMatchObject({
      total_users: 100,
      freelancers: 40,
    });
    expect(res.body.data.weeklyGrowth).toHaveLength(1);
    expect(res.body.data.financialMetrics).toMatchObject({ active_escrows: 2 });
    expect(res.body.data.qualityMetrics).toMatchObject({ avg_rating: "4.50" });
    expect(res.body.data.disputeMetrics).toHaveLength(1);
    expect(res.body.data.topEarners).toHaveLength(1);
    expect(res.body.data.jobVolume).toHaveLength(1);
  });

  it("200 — honors the period query parameter (7d / 90d)", async () => {
    stubMetrics();
    const seven = await send("get", "/api/admin/metrics?period=7d", {
      token: adminToken(),
    });
    expect(seven.status).toBe(200);
    expect(seven.body.data.period).toBe("7d");

    stubMetrics();
    const ninety = await send("get", "/api/admin/metrics?period=90d", {
      token: adminToken(),
    });
    expect(ninety.status).toBe(200);
    expect(ninety.body.data.period).toBe("90d");
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("metrics exploded"));
    });

    const res = await send("get", "/api/admin/metrics", {
      token: adminToken(),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("metrics exploded");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/reports/jobs
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/reports/jobs", () => {
  it("200 — returns reported jobs with joined job info", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM job_reports")) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              job_id: "job-1",
              reporter_address: USER,
              category: "scam",
              description: "Looks fraudulent",
              created_at: "2026-08-01T00:00:00.000Z",
              job_title: "Build a dApp",
              job_status: "open",
              client_address: "G" + "D".repeat(55),
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/reports/jobs", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      category: "scam",
      job_title: "Build a dApp",
    });
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("reports exploded"));
    });

    const res = await send("get", "/api/admin/reports/jobs", {
      token: adminToken(),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("reports exploded");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/disputes
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/disputes", () => {
  it("200 — returns open disputes joined with job data", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM escrows")) {
        return Promise.resolve({
          rows: [
            {
              job_id: "job-7",
              escrow_status: "disputed",
              escrow_created_at: "2026-08-01T00:00:00.000Z",
              job_title: "Smart contract audit",
              client_address: "G" + "D".repeat(55),
              freelancer_address: USER,
              budget: "500.0000000",
              currency: "XLM",
              job_status: "disputed",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/disputes", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      job_id: "job-7",
      escrow_status: "disputed",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/reported-wallets
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/reported-wallets", () => {
  it("200 — returns aggregated report counts per address", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("reporter_address AS reported_address")) {
        return Promise.resolve({
          rows: [
            {
              reported_address: ADDRESS,
              report_count: 3,
              last_reported_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/reported-wallets", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        reported_address: ADDRESS,
        report_count: 3,
        last_reported_at: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/logs
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/logs", () => {
  it("200 — returns the audit log rows", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM audit_logs")) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              action: "ban_user",
              actor_address: ADMIN,
              target: ADDRESS,
              reason: "spam",
              metadata: "{}",
              created_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/logs", { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: "ban_user",
      target: ADDRESS,
    });
  });

  it("200 — degrades to an empty list when the table is unavailable", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("audit_logs missing"));
    });

    const res = await send("get", "/api/admin/logs", { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit-log (admin_audit_log table)
// ─────────────────────────────────────────────────────────────────────────
//
// NOTE: admin.js registers TWO GET /audit-log handlers; Express runs the
// FIRST one (direct admin_audit_log query with limit/offset pagination), so
// the later auditLogService-backed handler is unreachable. These tests cover
// the handler that actually serves requests.

describe("GET /api/admin/audit-log", () => {
  it("200 — returns paginated admin audit entries", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("COUNT(*)::int") && text.includes("admin_audit_log")) {
        return Promise.resolve({ rows: [{ total: 1 }] });
      }
      if (text.includes("FROM admin_audit_log") && text.includes("ORDER BY")) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              admin_address: ADMIN,
              action: "ban_user",
              target_type: "user",
              target_id: ADDRESS,
              details: "{}",
              created_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/audit-log?limit=25&offset=10", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: "ban_user",
      target_id: ADDRESS,
    });
    expect(res.body.pagination).toEqual({ total: 1, limit: 25, offset: 10 });

    const auditCall = pool.query.mock.calls.find(
      ([sql]) =>
        String(sql).includes("FROM admin_audit_log") &&
        String(sql).includes("ORDER BY"),
    );
    expect(auditCall[1]).toEqual([25, 10]);
  });

  it("200 — degrades to an empty page when the table is unavailable", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("admin_audit_log missing"));
    });

    const res = await send("get", "/api/admin/audit-log", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [],
      pagination: { total: 0, limit: 100, offset: 0 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/disputes/:jobId/resolve
// ─────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/disputes/:jobId/resolve", () => {
  it("400 — requires a resolution note", async () => {
    const res = await send("patch", "/api/admin/disputes/job-7/resolve", {
      token: adminToken({ "2fa_verified": true }),
      body: { releaseTo: "freelancer" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Resolution note is required");
  });

  it("200 — resolves in favour of the freelancer (job completed)", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE escrows"))
        return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("patch", "/api/admin/disputes/job-7/resolve", {
      token: adminToken({ "2fa_verified": true }),
      body: {
        resolution: "Freelancer delivered the milestone",
        releaseTo: "freelancer",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Dispute resolved. Job marked as completed.");
    expect(updateJobStatus).toHaveBeenCalledWith("job-7", "completed");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE escrows"),
      ["job-7"],
    );
    expect(logContractInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_resolve_dispute",
        jobId: "job-7",
      }),
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "resolve_dispute", "job", "job-7"]),
    );
  });

  it("200 — resolves in favour of the client (job cancelled)", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE escrows"))
        return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("patch", "/api/admin/disputes/job-7/resolve", {
      token: adminToken({ "2fa_verified": true }),
      body: { resolution: "Client was right", releaseTo: "client" },
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Dispute resolved. Job marked as cancelled.");
    expect(updateJobStatus).toHaveBeenCalledWith("job-7", "cancelled");
  });

  it("500 — forwards service errors to the error handler", async () => {
    updateJobStatus.mockRejectedValue(new Error("job svc down"));

    const res = await send("patch", "/api/admin/disputes/job-7/resolve", {
      token: adminToken({ "2fa_verified": true }),
      body: { resolution: "n/a", releaseTo: "freelancer" },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("job svc down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/jobs/:jobId/cancel
// ─────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/jobs/:jobId/cancel", () => {
  it("200 — cancels a flagged job via updateJobStatus", async () => {
    const res = await send("patch", "/api/admin/jobs/job-9/cancel", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam listing" },
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Job cancelled by admin.");
    expect(updateJobStatus).toHaveBeenCalledWith("job-9", "cancelled");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "cancel_job", "job", "job-9"]),
    );
  });

  it("500 — forwards service errors to the error handler", async () => {
    updateJobStatus.mockRejectedValue(new Error("job svc down"));

    const res = await send("patch", "/api/admin/jobs/job-9/cancel", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "spam" },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("job svc down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/wallets/:address/freeze
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/wallets/:address/freeze", () => {
  it("400 — rejects a malformed Stellar address", async () => {
    const res = await send("post", "/api/admin/wallets/nope/freeze", {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "fraud" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar address");
  });

  it("200 — freezes a wallet (upsert) and audits the action", async () => {
    const res = await send("post", `/api/admin/wallets/${ADDRESS}/freeze`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "fraud" },
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain(ADDRESS);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO frozen_wallets"),
      [ADDRESS, "fraud", ADMIN],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "freeze_wallet", "wallet", ADDRESS]),
    );
  });

  it("200 — uses the default reason when none is supplied", async () => {
    const res = await send("post", `/api/admin/wallets/${ADDRESS}/freeze`, {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO frozen_wallets"),
      [ADDRESS, "Admin action", ADMIN],
    );
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("INSERT INTO frozen_wallets"))
        return Promise.reject(new Error("db down"));
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", `/api/admin/wallets/${ADDRESS}/freeze`, {
      token: adminToken({ "2fa_verified": true }),
      body: { reason: "fraud" },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("db down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/wallets/:address/freeze
// ─────────────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/wallets/:address/freeze", () => {
  it("200 — unfreezes a wallet and audits the action", async () => {
    const res = await send("delete", `/api/admin/wallets/${ADDRESS}/freeze`, {
      token: adminToken({ "2fa_verified": true }),
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("unfrozen");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM frozen_wallets"),
      [ADDRESS],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "unfreeze_wallet", "wallet", ADDRESS]),
    );
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("DELETE FROM frozen_wallets"))
        return Promise.reject(new Error("db down"));
      return Promise.resolve({ rows: [] });
    });

    const res = await send("delete", `/api/admin/wallets/${ADDRESS}/freeze`, {
      token: adminToken({ "2fa_verified": true }),
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("db down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/wallets/frozen
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/wallets/frozen", () => {
  it("200 — returns frozen wallets", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM frozen_wallets")) {
        return Promise.resolve({
          rows: [
            {
              address: ADDRESS,
              reason: "fraud",
              frozen_by: ADMIN,
              created_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/wallets/frozen", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      address: ADDRESS,
      reason: "fraud",
    });
  });

  it("200 — degrades to an empty list when the table is unavailable", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("frozen_wallets missing"));
    });

    const res = await send("get", "/api/admin/wallets/frozen", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/jobs — note: NOT guarded by requireAdmin2FA
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/jobs", () => {
  it("401 — rejects unauthenticated requests", async () => {
    const res = await send("get", "/api/admin/jobs");
    expect(res.status).toBe(401);
  });

  it("403 — rejects non-admin roles", async () => {
    const res = await send("get", "/api/admin/jobs", { token: userToken() });
    expect(res.status).toBe(403);
  });

  it("200 — an admin without 2FA is allowed (route is not 2FA-guarded)", async () => {
    listJobs.mockResolvedValue({
      jobs: [{ id: "job-1", title: "Build a dApp" }],
      nextCursor: "cursor-1",
    });

    const res = await send("get", "/api/admin/jobs", { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.nextCursor).toBe("cursor-1");
    expect(listJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "all",
        includeDeleted: false,
        limit: 50,
      }),
    );
  });

  it("200 — include_deleted=true and custom limit are passed through", async () => {
    const res = await send(
      "get",
      "/api/admin/jobs?include_deleted=true&limit=10",
      {
        token: adminToken(),
      },
    );

    expect(res.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "all",
        includeDeleted: true,
        limit: 10,
      }),
    );
  });

  it("500 — forwards service errors to the error handler", async () => {
    listJobs.mockRejectedValue(new Error("job svc down"));

    const res = await send("get", "/api/admin/jobs", { token: adminToken() });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("job svc down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/jobs/expired
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/jobs/expired", () => {
  it("200 — returns expired jobs ordered by expiry", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("status = 'expired'")) {
        return Promise.resolve({
          rows: [
            {
              id: "job-1",
              title: "Old job",
              client_address: USER,
              budget: "50.0000000",
              currency: "XLM",
              status: "expired",
              expires_at: "2026-07-01T00:00:00.000Z",
              created_at: "2026-06-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/jobs/expired", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "job-1", status: "expired" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/jobs/:jobId/reactivate
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/jobs/:jobId/reactivate", () => {
  it("404 — returns not found when the job is missing or not expired", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE jobs")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/jobs/job-1/reactivate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found or not expired");
  });

  it("200 — reactivates an expired job and audits the action", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("UPDATE jobs") && text.includes("status = 'open'")) {
        return Promise.resolve({
          rows: [
            {
              id: "job-1",
              title: "Old job",
              status: "open",
              expires_at: "2026-09-25T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/jobs/job-1/reactivate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: "job-1", status: "open" });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs"),
      ["job-1"],
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.arrayContaining([ADMIN, "job_reactivated", "job", "job-1"]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/cost-report
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/cost-report", () => {
  it("200 — returns the static infrastructure cost report", async () => {
    const res = await send("get", "/api/admin/cost-report", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalEstimatedMonthlyCost).toBeCloseTo(
      49.56 + 35.2 + 18.72,
      5,
    );
    expect(res.body.data.topCostDrivers).toHaveLength(3);
    expect(res.body.data.rightSizingRecommendations).toHaveLength(2);
    expect(res.body.data.billingAlerts).toHaveLength(2);
    expect(res.body.data.reportPeriod.start).toBeDefined();
    expect(res.body.data.reportPeriod.end).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/cost-report/generate
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/cost-report/generate", () => {
  it("200 — records the generation request and confirms", async () => {
    const res = await send("post", "/api/admin/cost-report/generate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(
      "Cost report generation triggered. Report will be emailed to admin.",
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("generate_cost_report"),
      expect.arrayContaining([
        ADMIN,
        expect.stringContaining("infrastructure_cost"),
      ]),
    );
  });

  it("200 — still confirms even if the audit write fails", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("INSERT INTO audit_logs"))
        return Promise.reject(new Error("db down"));
      return Promise.resolve({ rows: [] });
    });

    const res = await send("post", "/api/admin/cost-report/generate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Cost report generation triggered.");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics/time-series
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/metrics/time-series", () => {
  it("200 — returns chart rows honoring filters", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM platform_metrics")) {
        return Promise.resolve({
          rows: [
            {
              metric_name: "total_jobs",
              value: 42,
              granularity: "day",
              bucket: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/metrics/time-series", {
      token: adminToken(),
      query: {
        metric: "total_jobs",
        granularity: "day",
        from: "2026-08-01",
        to: "2026-08-26",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      metric_name: "total_jobs",
      value: 42,
    });

    const timeSeriesCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM platform_metrics"),
    );
    expect(timeSeriesCall[1]).toEqual([
      "total_jobs",
      "day",
      "2026-08-01",
      "2026-08-26",
    ]);
    expect(timeSeriesCall[0]).toContain("bucket >= $3");
    expect(timeSeriesCall[0]).toContain("bucket <= $4");
  });

  it("200 — defaults metric and granularity when omitted", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      if (text.includes("FROM platform_metrics"))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await send("get", "/api/admin/metrics/time-series", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    const timeSeriesCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM platform_metrics"),
    );
    expect(timeSeriesCall[1]).toEqual(["total_jobs", "day"]);
  });

  it("500 — forwards pool errors to the error handler", async () => {
    pool.query.mockImplementation((sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes("admin_profiles")) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("metrics exploded"));
    });

    const res = await send("get", "/api/admin/metrics/time-series", {
      token: adminToken(),
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("metrics exploded");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/reports/latest
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/reports/latest", () => {
  it("404 — returns not found when no report has been generated", async () => {
    downloadLatestFromS3.mockResolvedValue(null);

    const res = await send("get", "/api/admin/reports/latest", {
      token: adminToken(),
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No report has been generated yet");
  });

  it("200 — streams the PDF with download headers", async () => {
    const pdf = Buffer.from("%PDF-1.4 fake report content");
    downloadLatestFromS3.mockResolvedValue(pdf);

    const res = await send("get", "/api/admin/reports/latest", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="weekly-report-/,
    );
    expect(res.headers["content-length"]).toBe(String(pdf.length));
  });

  it("500 — forwards service errors to the error handler", async () => {
    downloadLatestFromS3.mockRejectedValue(new Error("s3 down"));

    const res = await send("get", "/api/admin/reports/latest", {
      token: adminToken(),
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("s3 down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/reports/generate
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/reports/generate", () => {
  it("200 — generates and emails the weekly report", async () => {
    const res = await send("post", "/api/admin/reports/generate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reportId: 1, emailed: true });
    expect(generateAndSendAdminReport).toHaveBeenCalledTimes(1);
  });

  it("500 — forwards service errors to the error handler", async () => {
    generateAndSendAdminReport.mockRejectedValue(new Error("report svc down"));

    const res = await send("post", "/api/admin/reports/generate", {
      token: adminToken({ "2fa_verified": true }),
      body: {},
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("report svc down");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/api-keys/usage (Issue #1186 regression suite)
// ─────────────────────────────────────────────────────────────────────────

describe("Admin Route Suite (/api/admin/api-keys/usage)", () => {
  it("200 — returns per-key usage stats from the developerService", async () => {
    const res = await send("get", "/api/admin/api-keys/usage", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(getApiKeyUsageStats).toHaveBeenCalledWith(7);
    expect(res.body.data).toMatchObject({
      lookbackDays: 7,
      keys: [
        {
          id: 1,
          label: "staging-bot",
          requests_today: 42,
          requests_last_hour: 7,
        },
      ],
    });
  });

  it("200 — honors the days lookback query parameter", async () => {
    const res = await send("get", "/api/admin/api-keys/usage?days=30", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(getApiKeyUsageStats).toHaveBeenCalledWith(30);
  });

  it("500 — forwards service errors to the error handler", async () => {
    getApiKeyUsageStats.mockRejectedValue(new Error("usage stats exploded"));

    const res = await send("get", "/api/admin/api-keys/usage", {
      token: adminToken(),
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "usage stats exploded",
      code: "INTERNAL_ERROR",
    });
  });
});
