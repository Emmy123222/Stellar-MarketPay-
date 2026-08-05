/**
 * src/tests/contract/api.contract.expanded.test.js
 *
 * Contract tests for all major API endpoints per issue #801.
 *
 * Endpoints covered:
 *   GET    /api/jobs                         (base suite — assertContract)
 *   GET    /api/jobs/:id                     assertContract  ← spec added
 *   PATCH  /api/jobs/:id   (escrow)          assertContract  ← spec added
 *   DELETE /api/jobs/:id                     assertContract  ← spec added
 *   GET    /api/applications/job/:jobId      assertContract  (base suite)
 *   POST   /api/applications/:id/accept      assertContract  ← spec added
 *   GET    /api/profiles/:address            assertContract  ← spec added
 *   POST   /api/profiles                     assertContract  ← spec added
 *   GET    /api/notifications                assertContract  ← spec added
 *   PATCH  /api/notifications/:id/read       assertContract  ← spec added
 *   PATCH  /api/notifications/read-all       assertContract  ← spec added
 *
 * All 200/201 success shapes are validated against openapi.json via
 * assertContract().  Error shapes use the same validator where the spec
 * documents them, or direct property assertions otherwise.
 *
 * No real database is required — all pool.query calls are mocked.
 */
"use strict";

// ─── Global mocks (must be declared before the server module loads) ───────────

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

jest.mock("../../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

jest.mock("../../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    getHealth: jest.fn().mockReturnValue({ running: false, synced: false }),
  }))
);

jest.mock("../../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);

jest.mock("../../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

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

// Cache — always miss so routes hit the mocked pool, not a stale cache
jest.mock("../../services/cacheService", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  jobListKey: jest.fn().mockReturnValue("job-list-key"),
  profileKey: jest.fn((pk) => `profile:${pk}`),
  TTL: { JOBS_LIST: 60, PROFILE: 300 },
}));

// Notification service — unit-test the route handler in isolation from the real DB
jest.mock("../../services/notificationService", () => ({
  listInAppNotifications: jest.fn().mockResolvedValue({
    notifications: [],
    unreadCount: 0,
    nextCursor: null,
  }),
  markInAppNotificationRead: jest.fn().mockResolvedValue({
    id: 1,
    user_address: "G" + "A".repeat(55),
    type: "new_application",
    title: "New application",
    body: "Someone applied.",
    read: true,
    job_id: "11111111-1111-1111-1111-111111111111",
    link_path: "/jobs/11111111-1111-1111-1111-111111111111",
    created_at: new Date().toISOString(),
  }),
  markAllInAppNotificationsRead: jest.fn().mockResolvedValue({ updatedCount: 2 }),
  setBroadcastToUser: jest.fn(),
  notifyEscrowEvent: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: { APPLICATION_ACCEPTED: "application_accepted" },
  getUserPreferences: jest.fn().mockResolvedValue(null),
  processPendingNotifications: jest.fn().mockResolvedValue({ total: 0, sent: 0, failed: 0 }),
}));

// Profile service
jest.mock("../../services/profileService", () => ({
  getProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(null),
  updateAvailability: jest.fn(),
  getSkillEndorsements: jest.fn().mockResolvedValue([]),
  endorseSkill: jest.fn(),
  getClientSpendingAnalytics: jest.fn().mockResolvedValue(null),
  listProfiles: jest.fn().mockResolvedValue({ profiles: [], nextCursor: null, hasMore: false }),
  getClientReputation: jest.fn().mockResolvedValue({ score: null }),
  getProfileStats: jest.fn().mockResolvedValue(null),
  getResponseTime: jest.fn().mockResolvedValue(null),
  blockFreelancer: jest.fn(),
  unblockFreelancer: jest.fn(),
  markProfileForDeletion: jest.fn(),
  FREELANCER_TIERS: { NEWCOMER: "Newcomer", RISING: "Rising Talent", TOP_RATED: "Top Rated", EXPERT: "Expert" },
}));

// Application service — accept route is tested directly
jest.mock("../../services/applicationService", () => ({
  submitApplication: jest.fn(),
  getApplicationsForJob: jest.fn().mockResolvedValue([]),
  getApplicationsForFreelancer: jest.fn().mockResolvedValue([]),
  acceptApplication: jest.fn(),
  withdrawApplication: jest.fn(),
  closeBiddingForJob: jest.fn(),
  revealApplicationBid: jest.fn(),
}));

// Contract audit service — side effect only
jest.mock("../../services/contractAuditService", () => ({
  logContractInteraction: jest.fn().mockResolvedValue(undefined),
}));

// IPFS — not needed for these tests
jest.mock("../../services/ipfsService", () => ({
  uploadFile: jest.fn(),
  getGatewayUrl: jest.fn().mockReturnValue("https://ipfs.io/ipfs/test"),
  MAX_FILE_SIZE: 5 * 1024 * 1024,
}));

// Price alert service used inside profiles route
jest.mock("../../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../../services/priceAlertService", () => ({
  upsertPriceAlertPreference: jest.fn(),
  getPriceAlertPreference: jest.fn().mockResolvedValue(null),
  start: jest.fn(),
}), { virtual: false });

// ─── Imports ──────────────────────────────────────────────────────────────────

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { assertContract, validateContract } = require("../../testUtils/contractValidator");

const app = require("../../server");
const pool = require("../../db/pool");
const { listInAppNotifications, markInAppNotificationRead, markAllInAppNotificationsRead } = require("../../services/notificationService");
const { getProfile, upsertProfile } = require("../../services/profileService");
const { acceptApplication } = require("../../services/applicationService");

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_CLIENT_KEY    = "G" + "B".repeat(55);
const FAKE_FREELANCER_KEY = "G" + "A".repeat(55);
const FAKE_JOB_ID        = "11111111-1111-1111-1111-111111111111";
const FAKE_APP_ID        = "22222222-2222-2222-2222-222222222222";
const LONG_PROPOSAL      =
  "I am an experienced Stellar developer ready to build this project efficiently and on time.";

const VALID_TOKEN = jwt.sign(
  { publicKey: FAKE_CLIENT_KEY },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

const FREELANCER_TOKEN = jwt.sign(
  { publicKey: FAKE_FREELANCER_KEY },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

// ─── Row builders ─────────────────────────────────────────────────────────────

function buildJobRow(overrides = {}) {
  return {
    id: FAKE_JOB_ID,
    title: "Build a Smart Contract on Stellar Network",
    description:
      "Looking for an experienced developer to build a dApp on Stellar with Soroban contracts.",
    budget: 500,
    currency: "XLM",
    category: "Smart Contracts",
    skills: [],
    status: "open",
    client_address: FAKE_CLIENT_KEY,
    freelancer_address: null,
    escrow_contract_id: null,
    applicant_count: 0,
    share_count: 0,
    boosted: false,
    boosted_until: null,
    deadline: null,
    timezone: null,
    screening_questions: [],
    milestones: [],
    visibility: "public",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildApplicationRow(overrides = {}) {
  return {
    id: FAKE_APP_ID,
    job_id: FAKE_JOB_ID,
    freelancer_address: FAKE_FREELANCER_KEY,
    proposal: LONG_PROPOSAL,
    bid_amount: 450,
    currency: "XLM",
    status: "pending",
    screening_answers: {},
    bid_commitment: null,
    bid_revealed: false,
    revealed_bid_amount: null,
    revealed_at: null,
    created_at: new Date().toISOString(),
    accepted_at: null,
    ...overrides,
  };
}

function buildProfileRow(overrides = {}) {
  return {
    public_key: FAKE_FREELANCER_KEY,
    role: "freelancer",
    display_name: "Alice Dev",
    bio: "Stellar developer with 3 years of Soroban experience.",
    skills: ["Rust", "Soroban"],
    completed_jobs: 5,
    total_earned_xlm: "1250.0000000",
    rating: 4.8,
    tier: "Top Rated",
    availability: { status: "available" },
    portfolio_items: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildNotificationRow(overrides = {}) {
  return {
    id: 1,
    user_address: FAKE_CLIENT_KEY,
    type: "new_application",
    title: "New application received",
    body: "Someone applied to your job.",
    read: false,
    job_id: FAKE_JOB_ID,
    link_path: `/jobs/${FAKE_JOB_ID}`,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Shape validators replaced by assertContract() ───────────────────────────
//
// All previously-inline validators have been removed.  Every 200/201 success
// path now calls assertContract() which compiles the openapi.json schema for
// that path/method/status and fails with a field-level diff on mismatch.
//
// The helpers below remain only for 4xx/5xx paths that are NOT documented in
// the spec (the spec only requires success shapes to match).

function assert4xxErrorShape(body) {
  expect(body).toHaveProperty("error");
  expect(typeof body.error).toBe("string");
}

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────

describe("GET /api/jobs/:id — get single job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql) => {
      if (sql === "SELECT * FROM jobs WHERE id = $1") {
        return { rows: [buildJobRow()] };
      }
      return { rows: [] };
    });
  });

  it("200 — response shape matches OpenAPI contract (/api/jobs/{id} GET 200)", async () => {
    const res = await request(app).get(`/api/jobs/${FAKE_JOB_ID}`);

    expect(res.status).toBe(200);
    assertContract("/api/jobs/{id}", "get", 200, res.body);
    expect(res.body.data.id).toBe(FAKE_JOB_ID);
  });

  it("404 — error shape when job not found", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/jobs/00000000-0000-0000-0000-000000000000");

    expect([404, 500]).toContain(res.status);
    assert4xxErrorShape(res.body);
  });
});

// ─── PATCH /api/jobs/:id/escrow ───────────────────────────────────────────────

describe("PATCH /api/jobs/:id/escrow — store escrow contract ID", () => {
  const FAKE_ESCROW_ID = "CESCROWCONTRACT1234567890123456789012345678901234567890";

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE jobs") && sql.includes("escrow_contract_id")) {
        return { rows: [buildJobRow({ escrow_contract_id: FAKE_ESCROW_ID })] };
      }
      if (sql.includes("INSERT INTO contract_audit")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  it("200 — response shape matches OpenAPI contract (/api/jobs/{id} PATCH 200)", async () => {
    const res = await request(app)
      .patch(`/api/jobs/${FAKE_JOB_ID}/escrow`)
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ escrowContractId: FAKE_ESCROW_ID });

    expect(res.status).toBe(200);
    assertContract("/api/jobs/{id}", "patch", 200, res.body);
  });

  it("401 — rejects unauthenticated request", async () => {
    const res = await request(app)
      .patch(`/api/jobs/${FAKE_JOB_ID}/escrow`)
      .send({ escrowContractId: FAKE_ESCROW_ID });

    expect(res.status).toBe(401);
    assertContract("/api/jobs/{id}", "patch", 401, res.body);
  });
});

// ─── DELETE /api/jobs/:id ─────────────────────────────────────────────────────

describe("DELETE /api/jobs/:id — delete a job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it("200 — response shape matches OpenAPI contract (/api/jobs/{id} DELETE 200)", async () => {
    const res = await request(app)
      .delete(`/api/jobs/${FAKE_JOB_ID}`)
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/jobs/{id}", "delete", 200, res.body);
    expect(res.body.success).toBe(true);
  });

  it("401 — rejects unauthenticated deletion", async () => {
    const res = await request(app).delete(`/api/jobs/${FAKE_JOB_ID}`);

    expect(res.status).toBe(401);
    assertContract("/api/jobs/{id}", "delete", 401, res.body);
  });
});

// ─── GET /api/applications — via freelancer sub-route ────────────────────────

describe("GET /api/applications/freelancer/:publicKey — list freelancer applications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/applications/job/{jobId} GET 200)", async () => {
    const { getApplicationsForFreelancer } = require("../../services/applicationService");
    getApplicationsForFreelancer.mockResolvedValueOnce([buildApplicationRow()]);

    const res = await request(app).get(
      `/api/applications/freelancer/${FAKE_FREELANCER_KEY}`
    );

    expect(res.status).toBe(200);
    // Freelancer list uses the same { success, data: Application[] } shape as the
    // job-scoped list — both are documented under /api/applications/job/{jobId} GET.
    assertContract("/api/applications/job/{jobId}", "get", 200, res.body);
  });

  it("200 — returns empty array when freelancer has no applications", async () => {
    const { getApplicationsForFreelancer } = require("../../services/applicationService");
    getApplicationsForFreelancer.mockResolvedValueOnce([]);

    const res = await request(app).get(
      `/api/applications/freelancer/${FAKE_FREELANCER_KEY}`
    );

    expect(res.status).toBe(200);
    assertContract("/api/applications/job/{jobId}", "get", 200, res.body);
    expect(res.body.data).toEqual([]);
  });
});

// ─── POST /api/applications/:id/accept ───────────────────────────────────────

describe("POST /api/applications/:id/accept — client accepts application", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/applications/{id}/accept POST 200)", async () => {
    acceptApplication.mockResolvedValueOnce({
      ...buildApplicationRow(),
      jobId: FAKE_JOB_ID,
      freelancerAddress: FAKE_FREELANCER_KEY,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    });

    pool.query.mockResolvedValue({ rows: [buildJobRow()] });

    const res = await request(app)
      .post(`/api/applications/${FAKE_APP_ID}/accept`)
      .send({ clientAddress: FAKE_CLIENT_KEY });

    expect(res.status).toBe(200);
    assertContract("/api/applications/{id}/accept", "post", 200, res.body);
    expect(res.body.data.status).toBe("accepted");
  });

  it("404/500 — error shape when application not found", async () => {
    acceptApplication.mockRejectedValueOnce(
      Object.assign(new Error("Application not found"), { status: 404 })
    );

    const res = await request(app)
      .post("/api/applications/00000000-0000-0000-0000-000000000000/accept")
      .send({ clientAddress: FAKE_CLIENT_KEY });

    expect([404, 500]).toContain(res.status);
    assert4xxErrorShape(res.body);
  });
});

// ─── GET /api/profiles/:address ───────────────────────────────────────────────

describe("GET /api/profiles/:address — get a user profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/profiles/{address} GET 200)", async () => {
    getProfile.mockResolvedValueOnce(buildProfileRow());

    const res = await request(app).get(`/api/profiles/${FAKE_FREELANCER_KEY}`);

    expect(res.status).toBe(200);
    assertContract("/api/profiles/{address}", "get", 200, res.body);
    expect(res.body.data.publicKey).toBe(FAKE_FREELANCER_KEY);
  });

  it("200 — null profile (new address) still passes contract (/api/profiles/{address} GET 200)", async () => {
    getProfile.mockResolvedValueOnce(null);

    const res = await request(app).get(
      `/api/profiles/GNEWPROFILE${"X".repeat(46)}`
    );

    expect(res.status).toBe(200);
    assertContract("/api/profiles/{address}", "get", 200, res.body);
  });
});

// ─── POST /api/profiles — upsert profile ──────────────────────────────────────

describe("POST /api/profiles — upsert user profile", () => {
  const PROFILE_BODY = {
    publicKey: FAKE_FREELANCER_KEY,
    role: "freelancer",
    displayName: "Alice Dev",
    bio: "Soroban developer.",
    skills: ["Rust", "Soroban"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/profiles POST 200)", async () => {
    upsertProfile.mockResolvedValueOnce(buildProfileRow());

    const res = await request(app)
      .post("/api/profiles")
      .send(PROFILE_BODY);

    expect(res.status).toBe(200);
    assertContract("/api/profiles", "post", 200, res.body);
  });

  it("200 — minimal body (publicKey only) passes contract", async () => {
    upsertProfile.mockResolvedValueOnce(
      buildProfileRow({ display_name: null, bio: null, skills: [] })
    );

    const res = await request(app)
      .post("/api/profiles")
      .send({ publicKey: FAKE_FREELANCER_KEY });

    expect(res.status).toBe(200);
    assertContract("/api/profiles", "post", 200, res.body);
  });
});

// ─── GET /api/notifications — authenticated ───────────────────────────────────

describe("GET /api/notifications — list in-app notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/notifications GET 200)", async () => {
    listInAppNotifications.mockResolvedValueOnce({
      notifications: [buildNotificationRow()],
      unreadCount: 1,
      nextCursor: null,
    });

    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/notifications", "get", 200, res.body);
    expect(res.body.data.unreadCount).toBe(1);
    expect(res.body.data.notifications).toHaveLength(1);
  });

  it("200 — empty list still passes contract", async () => {
    listInAppNotifications.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
      nextCursor: null,
    });

    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/notifications", "get", 200, res.body);
    expect(res.body.data.notifications).toHaveLength(0);
  });

  it("200 — has_more:true when nextCursor present", async () => {
    listInAppNotifications.mockResolvedValueOnce({
      notifications: [buildNotificationRow()],
      unreadCount: 5,
      nextCursor: "cursor-xyz",
    });

    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/notifications", "get", 200, res.body);
    expect(res.body.data.has_more).toBe(true);
    expect(typeof res.body.data.next_cursor).toBe("string");
  });

  it("401 — response shape matches OpenAPI contract (/api/notifications GET 401)", async () => {
    const res = await request(app).get("/api/notifications");

    expect(res.status).toBe(401);
    assertContract("/api/notifications", "get", 401, res.body);
  });
});

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────

describe("PATCH /api/notifications/:id/read — mark single notification read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/notifications/{id}/read PATCH 200)", async () => {
    markInAppNotificationRead.mockResolvedValueOnce(
      buildNotificationRow({ read: true })
    );

    const res = await request(app)
      .patch("/api/notifications/1/read")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/notifications/{id}/read", "patch", 200, res.body);
    expect(res.body.data.read).toBe(true);
  });

  it("401 — response shape matches OpenAPI contract (/api/notifications/{id}/read PATCH 401)", async () => {
    const res = await request(app).patch("/api/notifications/1/read");

    expect(res.status).toBe(401);
    assertContract("/api/notifications/{id}/read", "patch", 401, res.body);
  });
});

// ─── PATCH /api/notifications/read-all ───────────────────────────────────────

describe("PATCH /api/notifications/read-all — mark all notifications read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — response shape matches OpenAPI contract (/api/notifications/read-all PATCH 200)", async () => {
    markAllInAppNotificationsRead.mockResolvedValueOnce({ updatedCount: 5 });

    const res = await request(app)
      .patch("/api/notifications/read-all")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    assertContract("/api/notifications/read-all", "patch", 200, res.body);
    expect(typeof res.body.data.updatedCount).toBe("number");
  });

  it("401 — response shape matches OpenAPI contract (/api/notifications/read-all PATCH 401)", async () => {
    const res = await request(app).patch("/api/notifications/read-all");

    expect(res.status).toBe(401);
    assertContract("/api/notifications/read-all", "patch", 401, res.body);
  });
});

// ─── Cross-cutting: tampered shape guard ─────────────────────────────────────

describe("Tampered shape guard — expanded endpoints", () => {
  it("GET /api/jobs/{id}: fails when data.id is a number instead of UUID string", () => {
    const tampered = { success: true, data: { id: 123, title: "Test", status: "open", budget: 500 } };
    const { valid } = validateContract("/api/jobs/{id}", "get", 200, tampered);
    expect(valid).toBe(false);
  });

  it("GET /api/jobs/{id}: passes for a spec-conformant single job body", () => {
    const conformant = {
      success: true,
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Build escrow",
        status: "open",
        budget: 500,
        createdAt: new Date().toISOString(),
      },
    };
    const { valid } = validateContract("/api/jobs/{id}", "get", 200, conformant);
    expect(valid).toBe(true);
  });

  it("POST /api/applications/{id}/accept: fails when status is not a valid enum value", () => {
    const tampered = {
      success: true,
      data: {
        id: "22222222-2222-2222-2222-222222222222",
        jobId: "11111111-1111-1111-1111-111111111111",
        freelancerId: "G" + "A".repeat(55),
        status: "approved", // not in enum: pending | accepted | rejected
        bidAmount: 450,
      },
    };
    const { valid } = validateContract("/api/applications/{id}/accept", "post", 200, tampered);
    expect(valid).toBe(false);
  });

  it("GET /api/notifications: fails when unreadCount is a string instead of integer", () => {
    const tampered = {
      success: true,
      data: {
        notifications: [],
        unreadCount: "five",   // spec: integer
        next_cursor: null,
        has_more: false,
      },
    };
    const { valid } = validateContract("/api/notifications", "get", 200, tampered);
    expect(valid).toBe(false);
  });

  it("PATCH /api/notifications/read-all: fails when updatedCount is missing", () => {
    const tampered = { success: true, data: {} }; // updatedCount required
    const { valid } = validateContract("/api/notifications/read-all", "patch", 200, tampered);
    expect(valid).toBe(false);
  });

  it("GET /api/profiles/{address}: passes when data is null (new address)", () => {
    const conformant = { success: true, data: null };
    const { valid } = validateContract("/api/profiles/{address}", "get", 200, conformant);
    expect(valid).toBe(true);
  });

  it("DELETE /api/jobs/{id}: fails when success is missing", () => {
    const tampered = { message: "deleted" }; // no success field
    const { valid } = validateContract("/api/jobs/{id}", "delete", 200, tampered);
    expect(valid).toBe(false);
  });
});
