"use strict";

/**
 * src/routes/invitations.test.js
 *
 * Unit tests for the job invitation endpoints mounted at /api/invitations.
 *
 * Coverage per endpoint, per the scope of issue #1145:
 *   GET   /api/invitations                 : happy path + 401
 *   PATCH /api/invitations/:id/decline     : happy path + 401 + 404 + 403
 *   POST  /api/invitations/:id/accept      : happy path + 401 + 404 + 403 + 400
 *
 * DB pool is mocked with src/testUtils/pgMock.js.
 * CSRF tokens are fetched via src/testUtils/csrfTestHelpers.js before each
 * mutating (PATCH/POST) request.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { fetchCsrf, applyCsrf } = require("../testUtils/csrfTestHelpers");

// ─────────────────────────────────────────────────────────────────────────
// Mocks (must be installed before requiring server)
// ─────────────────────────────────────────────────────────────────────────

jest.mock("../services/priceAlertService", () => {
  const mod = jest.requireActual("../services/priceAlertService");
  class Mock {}
  Mock.prototype.start = jest.fn();
  Mock.prototype.stop = jest.fn();
  const out = Object.assign({}, mod, { PriceAlertService: Mock });
  Object.defineProperty(out, "__esModule", { value: false });
  return out;
});

jest.mock("../services/indexerService", () => {
  class MockIndexer {}
  MockIndexer.prototype.start = jest.fn();
  return MockIndexer;
});

jest.mock("../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  const mockConnect = jest.fn().mockResolvedValue({
    query: mockQuery,
    release: jest.fn(),
  });
  const mock = {
    query: mockQuery,
    connect: mockConnect,
    end: jest.fn(),
    reset: jest.fn(),
  };
  mock.readPool = { query: mockQuery, connect: mockConnect };
  mock.writePool = mock;
  return mock;
});

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

jest.mock("../services/notificationService", () => {
  const mod = jest.requireActual("../services/notificationService");
  return Object.assign({}, mod, {
    queueNotification: jest.fn().mockResolvedValue(undefined),
    EVENT_TYPES: {
      JOB_INVITED: "JOB_INVITED",
      APPLICATION_RECEIVED: "APPLICATION_RECEIVED",
    },
    createJobNotification: jest.fn().mockResolvedValue(undefined),
    setBroadcastToUser: jest.fn(() => undefined),
  });
});

jest.mock("../services/profileService", () => ({
  calculateFreelancerTier: jest.fn(() => "Starter"),
  isBlocked: jest.fn().mockResolvedValue(false),
}));

const pool = require("../db/pool");
const { JWT_SECRET } = require("../middleware/auth");

// ─────────────────────────────────────────────────────────────────────────
// Helpers / fixtures
// ─────────────────────────────────────────────────────────────────────────

const FREELANCER = "G" + "F".repeat(55);
const OTHER_USER  = "G" + "O".repeat(55);
const CLIENT      = "G" + "C".repeat(55);

const JOB_ID = "11111111-2222-3333-4444-555555555555";
const INV_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const APP_ID = "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";

function tokenFor(publicKey, extras = {}) {
  return jwt.sign(
    Object.assign({ publicKey, address: publicKey, role: "user" }, extras),
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

/**
 * Queue of query row-results. Any query whose index is not explicitly set
 * returns the default { rows: [] } from the auto-mock. Setting a queue entry
 * to the sentinel value `NO_OVERRIDE` keeps the default.
 */
const NO_OVERRIDE = Symbol("NO_OVERRIDE");
function seedQueryResults(results) {
  // results[] is an array in the order pool.query will be called
  pool.query.mockImplementation(() => {
    const next = results.shift();
    if (next === undefined || next === NO_OVERRIDE) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve(next);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────

describe("/api/invitations routes", () => {
  let app;

  beforeAll(() => {
    process.env.CONTRACT_ID = "CCONTRACTID123456789012345678901234567890123456789012";
    process.env.STELLAR_NETWORK = "testnet";
    process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.PLATFORM_WALLET_ADDRESS = "G" + "P".repeat(55);
    app = require("../server");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset pool.query to the default mocked resolver; individual tests
    // override with seedQueryResults() / mockResolvedValueOnce().
    pool.query.mockResolvedValue({ rows: [] });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/invitations
  // ───────────────────────────────────────────────────────────────────────

  describe("GET /api/invitations", () => {
    it("returns 401 when no token is provided", async () => {
      const res = await request(app).get("/api/invitations");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("returns 401 for an invalid token", async () => {
      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", "Bearer not-a-real-jwt");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired/);
    });

    it("returns pending invitations for the authed freelancer", async () => {
      pool.query.mockResolvedValue({
        rows: [
          {
            id: INV_ID,
            job_id: JOB_ID,
            job_title: "Smart Contract Auditor",
            job_budget: "2500.0000000",
            job_currency: "XLM",
            client_address: CLIENT,
            client_name: "Client Name",
            freelancer_address: FREELANCER,
            status: "pending",
            created_at: "2026-08-24T00:00:00.000Z",
          },
        ],
      });

      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: INV_ID,
        jobId: JOB_ID,
        jobTitle: "Smart Contract Auditor",
        jobBudget: "2500.0000000",
        jobCurrency: "XLM",
        clientAddress: CLIENT,
        clientName: "Client Name",
        freelancerAddress: FREELANCER,
        status: "pending",
        createdAt: "2026-08-24T00:00:00.000Z",
      });
    });

    it("returns an empty array when there are no pending invitations", async () => {
      pool.query.mockResolvedValue({ rows: [] });
      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/invitations/:id/decline
  // ───────────────────────────────────────────────────────────────────────

  describe("PATCH /api/invitations/:id/decline", () => {
    it("returns 401 when no token is provided", async () => {
      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app).patch(`/api/invitations/${INV_ID}/decline`),
        csrf
      );
      expect(res.status).toBe(401);
    });

    it("returns 404 when the invitation does not exist", async () => {
      // declineInvitation SELECT returns empty rows → 404
      pool.query.mockResolvedValueOnce({ rows: [] });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .patch(`/api/invitations/${INV_ID}/decline`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`),
        csrf
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Invitation not found");
    });

    it("returns 403 when a different freelancer tries to decline", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: INV_ID, job_id: JOB_ID, freelancer_address: FREELANCER, status: "pending" }],
      });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .patch(`/api/invitations/${INV_ID}/decline`)
          .set("Authorization", `Bearer ${tokenFor(OTHER_USER)}`),
        csrf
      );
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the invited freelancer can decline");
    });

    it("declines the invitation (returns 200) for the invited freelancer", async () => {
      const updated = {
        id: INV_ID,
        job_id: JOB_ID,
        freelancer_address: FREELANCER,
        status: "declined",
      };
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: INV_ID, job_id: JOB_ID, freelancer_address: FREELANCER, status: "pending" }],
        })
        .mockResolvedValueOnce({ rows: [updated] });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .patch(`/api/invitations/${INV_ID}/decline`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`),
        csrf
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("declined");
      expect(res.body.data.id).toBe(INV_ID);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/invitations/:id/accept
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/invitations/:id/accept", () => {
    it("returns 401 when no token is provided", async () => {
      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .send({ proposal: "A".repeat(60), bidAmount: 500 }),
        csrf
      );
      expect(res.status).toBe(401);
    });

    it("returns 404 when the invitation does not exist", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`)
          .send({ proposal: "A".repeat(60), bidAmount: 500 }),
        csrf
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Invitation not found");
    });

    it("returns 403 when a different freelancer tries to accept", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: INV_ID, job_id: JOB_ID, freelancer_address: FREELANCER, status: "pending" }],
      });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .set("Authorization", `Bearer ${tokenFor(OTHER_USER)}`)
          .send({ proposal: "A".repeat(60), bidAmount: 500 }),
        csrf
      );
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the invited freelancer can accept");
    });

    it("returns 400 when proposal is missing", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: INV_ID, job_id: JOB_ID, freelancer_address: FREELANCER, status: "pending" }],
      });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`)
          .send({ bidAmount: 500 }),
        csrf
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("proposal and bidAmount are required");
    });

    it("returns 400 when bidAmount is missing", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: INV_ID, job_id: JOB_ID, freelancer_address: FREELANCER, status: "pending" }],
      });

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`)
          .send({ proposal: "A".repeat(60) }),
        csrf
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("proposal and bidAmount are required");
    });

    it("accepts a valid invitation → 201 with auto-created application", async () => {
      const PROPOSAL = "I have extensive experience with Soroban escrow contracts and can deliver this auditor role on time and within budget.";
      const BID = 2500;
      const INVITATION_ROW = {
        id: INV_ID,
        job_id: JOB_ID,
        freelancer_address: FREELANCER,
        client_address: CLIENT,
        status: "pending",
      };
      const JOB_ROW = {
        id: JOB_ID,
        title: "Soroban Escrow Auditor",
        status: "open",
        visibility: "invite_only",
        client_address: CLIENT,
        budget: "5000.0000000",
        currency: "XLM",
        screening_questions: null,
        applicant_count: 0,
      };
      const APP_ROW = {
        id: APP_ID,
        job_id: JOB_ID,
        freelancer_address: FREELANCER,
        proposal: PROPOSAL,
        bid_amount: BID.toFixed(7),
        currency: "XLM",
        status: "pending",
        screening_answers: {},
        bid_commitment: null,
        bid_revealed: false,
        revealed_bid_amount: null,
        revealed_at: null,
        created_at: "2026-08-24T00:00:00.000Z",
        accepted_at: null,
        withdrawn_at: null,
        completed_jobs: 0,
        total_jobs: 0,
        avg_rating: null,
        total_earned_xlm: 0,
        profile_created_at: "2026-01-01T00:00:00.000Z",
      };

      // submitApplication() runs, in order:
      //   1. pool.query("SELECT jobs ...") for getJob(jobId)
      //   2. pool.query("SELECT 1 FROM job_invitations ...") (invite-only check)
      //   3. pool.query("INSERT INTO applications ... RETURNING *")
      //   4. pool.query("UPDATE jobs SET applicant_count ...")
      //   5. (notifications use mocked services)
      // Plus the queries the route itself does around submitApplication:
      //   R0. route: SELECT * FROM job_invitations WHERE id = $1
      //   R5. route: UPDATE job_invitations SET status = 'accepted' WHERE id = $1
      seedQueryResults([
        { rows: [INVITATION_ROW] },                // R0
        { rows: [JOB_ROW] },                       // 1 getJob
        { rows: [{ ok: 1 }] },                     // 2 invite-only verify
        { rows: [APP_ROW] },                       // 3 INSERT applications
        { rows: [{ applicant_count: 1 }] },        // 4 UPDATE jobs
        NO_OVERRIDE,                               // 5 UPDATE invitations
      ]);

      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post(`/api/invitations/${INV_ID}/accept`)
          .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`)
          .send({ proposal: PROPOSAL, bidAmount: BID }),
        csrf
      );

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: APP_ID,
        jobId: JOB_ID,
        freelancerAddress: FREELANCER,
        proposal: PROPOSAL,
        bidAmount: BID.toFixed(7),
        currency: "XLM",
        status: "pending",
      });
    });
  });
});
