/**
 * src/tests/adminUserManagement.test.js
 *
 * Integration tests for admin user management endpoints:
 *   GET  /api/admin/users
 *   POST /api/admin/users/:address/ban
 *   POST /api/admin/users/:address/unban
 *   POST /api/admin/jobs/:id/remove
 *
 * All endpoints require requireAdminRole + requireAdmin2FA middleware.
 */
"use strict";

// ─── Global mocks (must be set before server loads) ──────────────────────────

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: jest.fn().mockResolvedValue({
    _embedded: { records: [{ sequence: 12345678 }] },
  }),
});

beforeAll(() => {
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID ||
    "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    getHealth: jest.fn().mockReturnValue({ running: false, synced: false }),
  })),
);

jest.mock("../services/priceAlertService", () => ({
  PriceAlertService: jest.fn().mockImplementation(() => ({ start: jest.fn() })),
}));

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Utils: {
      buildChallengeTx: jest.fn(),
      verifyChallengeTx: jest.fn(),
    },
  };
});

// ─── Imports ─────────────────────────────────────────────────────────────────

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../db/pool");

// ─── Test constants ───────────────────────────────────────────────────────────

const ADMIN_KEY = "G" + "C".repeat(55);
const USER_KEY = "G" + "D".repeat(55);
const USER_KEY_2 = "G" + "E".repeat(55);
const FAKE_JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NONEXISTENT_KEY = "G" + "Z".repeat(55);
const INVALID_ADDRESS = "not-a-stellar-address";

// Admin JWT with role=admin AND totp_enabled=false (so 2FA check passes)
const ADMIN_TOKEN = jwt.sign(
  { publicKey: ADMIN_KEY, role: "admin" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" },
);

// Non-admin JWT for 403 tests
const USER_TOKEN = jwt.sign(
  { publicKey: USER_KEY, role: "user" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" },
);

// ─── Helper: build mock profile row ──────────────────────────────────────────

function buildProfileRow(overrides = {}) {
  return {
    public_key: USER_KEY,
    display_name: "Test User",
    bio: "A test user profile",
    role: "freelancer",
    skills: ["JavaScript", "Rust"],
    completed_jobs: 5,
    total_earned_xlm: "2500.0000000",
    rating: 4.5,
    reputation_points: 120,
    flagged: false,
    banned_at: null,
    banned_by: null,
    ban_reason: null,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildJobRow(overrides = {}) {
  return {
    id: FAKE_JOB_ID,
    title: "Test Job",
    status: "open",
    removed_at: null,
    removed_by: null,
    remove_reason: null,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Admin User Management — GET /api/admin/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock requireAdmin2FA: query admin_profiles, return totp_enabled=false
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("COUNT(*)") && sql.includes("FROM profiles")) {
        return { rows: [{ total: 2 }] };
      }
      if (sql.includes("FROM profiles") && sql.includes("ORDER BY")) {
        return {
          rows: [
            buildProfileRow({ public_key: USER_KEY, display_name: "Alice" }),
            buildProfileRow({
              public_key: USER_KEY_2,
              display_name: "Bob",
              role: "client",
            }),
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("returns 200 with paginated user list", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toEqual({
      total: 2,
      limit: 50,
      offset: 0,
    });
    expect(res.body.data[0]).toHaveProperty("public_key");
    expect(res.body.data[0]).toHaveProperty("display_name");
    expect(res.body.data[0]).toHaveProperty("flagged");
    expect(res.body.data[0]).toHaveProperty("banned_at");
  });

  it("filters by role", async () => {
    const res = await request(app)
      .get("/api/admin/users?role=client")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    // Verify the SQL had a role filter
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    expect(listCall).toBeDefined();
    expect(listCall[0]).toContain("role =");
  });

  it("filters by flagged=true", async () => {
    const res = await request(app)
      .get("/api/admin/users?flagged=true")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    expect(listCall[0]).toContain("flagged = true");
  });

  it("filters by banned=true", async () => {
    const res = await request(app)
      .get("/api/admin/users?banned=true")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    expect(listCall[0]).toContain("banned_at IS NOT NULL");
  });

  it("filters by search query", async () => {
    const res = await request(app)
      .get("/api/admin/users?search=Alice")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    expect(listCall[0]).toContain("ILIKE");
  });

  it("supports custom sort and order", async () => {
    const res = await request(app)
      .get("/api/admin/users?sort=rating&order=ASC")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    expect(listCall[0]).toContain("rating ASC");
  });

  it("prevents SQL injection via sort parameter", async () => {
    const res = await request(app)
      .get("/api/admin/users?sort=public_key;DROP TABLE profiles")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const calls = pool.query.mock.calls;
    const listCall = calls.find(([sql]) => sql.includes("ORDER BY"));
    // Should fall back to "created_at" since the sort column is invalid
    expect(listCall[0]).toContain("ORDER BY created_at");
  });

  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${USER_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Admin access required");
  });

  it("returns 401 for unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(401);
  });
});

describe("Admin User Management — POST /api/admin/users/:address/ban", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE profiles") && sql.includes("banned_at")) {
        return {
          rows: [
            {
              public_key: USER_KEY,
              display_name: "Test User",
              banned_at: new Date().toISOString(),
              ban_reason: "Violation of platform terms",
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("returns 200 and bans a user", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_KEY}/ban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ reason: "Spam behavior" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("banned");
    expect(res.body.data).toHaveProperty("banned_at");
    expect(res.body.data).toHaveProperty("ban_reason");

    // Verify admin audit log was written
    const auditCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes("admin_audit_log") && sql.includes("INSERT"),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
    expect(auditCalls[0][1]).toContain("ban_user");
  });

  it("returns 200 with default reason when none provided", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_KEY}/ban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for invalid Stellar address", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${INVALID_ADDRESS}/ban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ reason: "Spam" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid Stellar address");
  });

  it("returns 404 for non-existent user", async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE profiles") && sql.includes("banned_at")) {
        return { rows: [] }; // No rows returned => user not found
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/admin/users/${NONEXISTENT_KEY}/ban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ reason: "Spam" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("User not found");
  });

  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_KEY}/ban`)
      .set("Authorization", `Bearer ${USER_TOKEN}`)
      .send({ reason: "Spam" });

    expect(res.status).toBe(403);
  });
});

describe("Admin User Management — POST /api/admin/users/:address/unban", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE profiles") && sql.includes("banned_at = NULL")) {
        return {
          rows: [
            {
              public_key: USER_KEY,
              display_name: "Test User",
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("returns 200 and unbans a user", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_KEY}/unban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("unbanned");

    // Verify admin audit log was written
    const auditCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes("admin_audit_log") && sql.includes("INSERT"),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
    expect(auditCalls[0][1]).toContain("unban_user");
  });

  it("returns 400 for invalid Stellar address", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${INVALID_ADDRESS}/unban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent user", async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE profiles") && sql.includes("banned_at = NULL")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/admin/users/${NONEXISTENT_KEY}/unban`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_KEY}/unban`)
      .set("Authorization", `Bearer ${USER_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

describe("Admin User Management — POST /api/admin/jobs/:id/remove", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE jobs") && sql.includes("removed_at")) {
        return {
          rows: [
            {
              id: FAKE_JOB_ID,
              title: "Test Job",
              status: "cancelled",
              removed_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("returns 200 and removes a job", async () => {
    const res = await request(app)
      .post(`/api/admin/jobs/${FAKE_JOB_ID}/remove`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ reason: "Job violates platform terms" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("removed");
    expect(res.body.data).toHaveProperty("status", "cancelled");

    // Verify admin audit log was written
    const auditCalls = pool.query.mock.calls.filter(
      ([sql]) => sql.includes("admin_audit_log") && sql.includes("INSERT"),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
    expect(auditCalls[0][1]).toContain("remove_job");
  });

  it("returns 200 with default reason when none provided", async () => {
    const res = await request(app)
      .post(`/api/admin/jobs/${FAKE_JOB_ID}/remove`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for non-existent or already removed job", async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("admin_profiles")) {
        return { rows: [{ totp_enabled: false }] };
      }
      if (sql.includes("UPDATE jobs") && sql.includes("removed_at")) {
        return { rows: [] }; // No rows returned => job not found
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/admin/jobs/${FAKE_JOB_ID}/remove`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ reason: "Remove" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Job not found or already removed");
  });

  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .post(`/api/admin/jobs/${FAKE_JOB_ID}/remove`)
      .set("Authorization", `Bearer ${USER_TOKEN}`)
      .send({ reason: "Remove" });

    expect(res.status).toBe(403);
  });
});
