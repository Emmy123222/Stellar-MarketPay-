"use strict";

/**
 * src/routes/applications.test.js
 *
 * Route-level test suite for /api/applications endpoints (Issue #1136).
 *
 * Scope, per endpoint:
 *   - GET    /job/:jobId              — happy path, invalid tier filter 400
 *   - GET    /freelancer/:publicKey   — happy path
 *   - POST   /                        — submit application, 201 happy path, 400 validation
 *   - POST   /job/:jobId/close-bidding— happy path, 400 validation
 *   - POST   /:id/reveal              — reveal sealed bid, 400 validation
 *   - POST   /:id/accept              — accept application, 400 validation, 404 + 403 from service
 *   - DELETE /:id                     — withdraw application, 400 validation, 404/403 from service
 *
 * The route delegates to services (applicationService, jobService,
 * contractAuditService, notificationService) rather than touching the pool
 * directly, so we mock those services and exercise the HTTP layer: JSON
 * parsing, zod validation, JSONB depth middleware, rate-limit pass-through,
 * and the route handlers' own logic (broadcast hooks, response shaping).
 */

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/profileService", () => ({
  FREELANCER_TIERS: {
    NEWCOMER: "Newcomer",
    RISING_TALENT: "Rising Talent",
    TOP_RATED: "Top Rated",
    EXPERT: "Expert",
  },
}));

jest.mock("../services/applicationService", () => ({
  submitApplication: jest.fn(),
  getApplicationsForJob: jest.fn(),
  getApplicationsForFreelancer: jest.fn(),
  acceptApplication: jest.fn(),
  withdrawApplication: jest.fn(),
  closeBiddingForJob: jest.fn(),
  revealApplicationBid: jest.fn(),
}));

jest.mock("../services/jobService", () => ({
  getJob: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  logContractInteraction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/notificationService", () => ({
  notifyEscrowEvent: jest.fn().mockResolvedValue(true),
  EVENT_TYPES: { APPLICATION_ACCEPTED: "application_accepted" },
}));

const express = require("express");
const request = require("supertest");
const applicationsRoutes = require("./applications");
const {
  submitApplication,
  getApplicationsForJob,
  getApplicationsForFreelancer,
  acceptApplication,
  withdrawApplication,
  closeBiddingForJob,
  revealApplicationBid,
} = require("../services/applicationService");
const { getJob } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");
const { notifyEscrowEvent } = require("../services/notificationService");

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRoutes);
// Simulated broadcast hook (also present on the real app in server.js).
app.locals.broadcastRealtime = jest.fn();

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// Addresses are validated by the application service, so any non-empty string is
// acceptable at the HTTP layer. Use realistic Stellar-formatted G-addresses.
const CLIENT = "G" + "A".repeat(55);
const FREELANCER = "G" + "B".repeat(55);
const JOB_ID = "job-101";
const APP_ID = "app-1";

function fakeApplication(overrides = {}) {
  return {
    id: APP_ID,
    jobId: JOB_ID,
    job_id: JOB_ID,
    freelancerAddress: FREELANCER,
    freelancer_address: FREELANCER,
    proposal: "I can build this.",
    bidAmount: 500,
    bid_amount: "500.0000000",
    currency: "XLM",
    status: "pending",
    createdAt: new Date().toISOString(),
    created_at: new Date().toISOString(),
    estimatedDuration: "2 weeks",
    ...overrides,
  };
}

describe("Applications Routes Suite (/api/applications)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (app.locals.broadcastRealtime).mockClear();
  });

  // =========================================================================
  // GET /job/:jobId
  // =========================================================================
  describe("GET /job/:jobId", () => {
    it("200 — happy path: returns applications for a job", async () => {
      getApplicationsForJob.mockResolvedValue([
        { id: APP_ID, freelancer_address: FREELANCER, bid_amount: "500.0000000", status: "pending" },
      ]);

      const res = await request(app).get(`/api/applications/job/${JOB_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(getApplicationsForJob).toHaveBeenCalledWith(JOB_ID, { tier: null });
    });

    it("200 — passes a tier filter through to the service", async () => {
      getApplicationsForJob.mockResolvedValue([]);

      const res = await request(app).get(`/api/applications/job/${JOB_ID}?tier=Expert`);

      expect(res.status).toBe(200);
      expect(getApplicationsForJob).toHaveBeenCalledWith(JOB_ID, { tier: "Expert" });
    });

    it("400 — rejects an invalid freelancer tier filter", async () => {
      const res = await request(app).get(`/api/applications/job/${JOB_ID}?tier=Platinum`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid freelancer tier filter/);
      expect(getApplicationsForJob).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /freelancer/:publicKey
  // =========================================================================
  describe("GET /freelancer/:publicKey", () => {
    it("200 — happy path: returns applications by a freelancer", async () => {
      getApplicationsForFreelancer.mockResolvedValue([fakeApplication()]);

      const res = await request(app).get(`/api/applications/freelancer/${FREELANCER}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(getApplicationsForFreelancer).toHaveBeenCalledWith(FREELANCER);
    });
  });

  // =========================================================================
  // POST /  — submit an application
  // =========================================================================
  describe("POST /", () => {
    const validBody = {
      jobId: JOB_ID,
      freelancerAddress: FREELANCER,
      proposal: "I can build this project.",
      bidAmount: 500,
      estimatedDuration: "2 weeks",
      screeningAnswers: { experience: "advanced" },
    };

    it("201 — happy path: submits an application and broadcasts", async () => {
      submitApplication.mockResolvedValue(fakeApplication());
      getJob.mockResolvedValue({ title: "Build a dApp", budget: "500" });

      const res = await request(app)
        .post("/api/applications")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(APP_ID);
      expect(submitApplication).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, freelancerAddress: FREELANCER }),
      );
      expect(app.locals.broadcastRealtime).toHaveBeenCalled();
    });

    it("201 — returns success without broadcasting when no broadcast hook is present", async () => {
      const appNoBroadcast = express();
      appNoBroadcast.use(express.json());
      appNoBroadcast.use("/api/applications", applicationsRoutes);
      appNoBroadcast.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        const status = err.statusCode || err.status || 500;
        res.status(status).json({ error: err.message });
      });

      submitApplication.mockResolvedValue(fakeApplication());

      const res = await request(appNoBroadcast)
        .post("/api/applications")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("400 — rejects a missing required field (bidAmount)", async () => {
      const res = await request(app)
        .post("/api/applications")
        .send({ jobId: JOB_ID, freelancerAddress: FREELANCER, proposal: "hi" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      expect(submitApplication).not.toHaveBeenCalled();
    });

    it("400 — rejects a non-positive bidAmount", async () => {
      const res = await request(app)
        .post("/api/applications")
        .send({ ...validBody, bidAmount: -5 });

      expect(res.status).toBe(400);
    });

    it("400 — rejects a request body nested deeper than the JSONB limit", async () => {
      const deeplyNested = { a: { b: { c: { d: { e: { f: 1 } } } } } };
      const res = await request(app)
        .post("/api/applications")
        .send({ ...validBody, screeningAnswers: deeplyNested });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("JSONB_DEPTH_EXCEEDED");
    });
  });

  // =========================================================================
  // POST /job/:jobId/close-bidding
  // =========================================================================
  describe("POST /job/:jobId/close-bidding", () => {
    it("200 — happy path: closes the bidding round", async () => {
      closeBiddingForJob.mockResolvedValue({ bidding_closed_at: new Date().toISOString() });

      const res = await request(app)
        .post(`/api/applications/job/${JOB_ID}/close-bidding`)
        .send({ clientAddress: CLIENT });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(closeBiddingForJob).toHaveBeenCalledWith(JOB_ID, CLIENT);
    });

    it("400 — rejects when clientAddress is missing", async () => {
      const res = await request(app)
        .post(`/api/applications/job/${JOB_ID}/close-bidding`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/clientAddress/);
    });
  });

  // =========================================================================
  // POST /:id/reveal  — reveal a sealed bid
  // =========================================================================
  describe("POST /:id/reveal", () => {
    it("200 — happy path: reveals a sealed bid", async () => {
      revealApplicationBid.mockResolvedValue({ ...fakeApplication(), bidRevealed: true });

      const res = await request(app)
        .post(`/api/applications/${APP_ID}/reveal`)
        .send({ freelancerAddress: FREELANCER, bidAmount: 500, nonce: "abc123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bidRevealed).toBe(true);
      expect(revealApplicationBid).toHaveBeenCalledWith(APP_ID, FREELANCER, 500, "abc123");
    });

    it("400 — rejects when nonce is missing", async () => {
      const res = await request(app)
        .post(`/api/applications/${APP_ID}/reveal`)
        .send({ freelancerAddress: FREELANCER, bidAmount: 500 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it("400 — rejects a non-positive bidAmount", async () => {
      const res = await request(app)
        .post(`/api/applications/${APP_ID}/reveal`)
        .send({ freelancerAddress: FREELANCER, bidAmount: 0, nonce: "abc" });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // POST /:id/accept  — client accepts a proposal
  // =========================================================================
  describe("POST /:id/accept", () => {
    it("200 — happy path: accepts, logs interaction, notifies and broadcasts", async () => {
      const appRow = fakeApplication();
      acceptApplication.mockResolvedValue(appRow);
      getJob.mockResolvedValue({
        id: JOB_ID,
        title: "Build a dApp",
        clientAddress: CLIENT,
        freelancerAddress: FREELANCER,
        budget: "500",
        currency: "XLM",
      });

      const res = await request(app)
        .post(`/api/applications/${APP_ID}/accept`)
        .send({ clientAddress: CLIENT, contractTxHash: "tx-123" });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(APP_ID);
      expect(logContractInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "start_work", callerAddress: CLIENT }),
      );
      expect(notifyEscrowEvent).toHaveBeenCalled();
      expect(app.locals.broadcastRealtime).toHaveBeenCalled();
    });

    it("400 — rejects when clientAddress is missing", async () => {
      const res = await request(app)
        .post(`/api/applications/${APP_ID}/accept`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/clientAddress/);
    });

    it("404 — surfaces application-not-found from the service", async () => {
      const err = new Error("Application not found");
      err.status = 404;
      acceptApplication.mockRejectedValue(err);

      const res = await request(app)
        .post(`/api/applications/${APP_ID}/accept`)
        .send({ clientAddress: CLIENT });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Application not found");
    });

    it("403 — surfaces authorization rejection from the service", async () => {
      const err = new Error("Only the job client can accept applications");
      err.status = 403;
      acceptApplication.mockRejectedValue(err);

      const res = await request(app)
        .post(`/api/applications/${APP_ID}/accept`)
        .send({ clientAddress: CLIENT });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can accept applications");
    });
  });

  // =========================================================================
  // DELETE /:id  — freelancer withdraws an application
  // =========================================================================
  describe("DELETE /:id", () => {
    it("200 — happy path: withdraws the application and broadcasts", async () => {
      withdrawApplication.mockResolvedValue({ ...fakeApplication(), status: "withdrawn" });

      const res = await request(app)
        .delete(`/api/applications/${APP_ID}`)
        .send({ freelancerAddress: FREELANCER });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("withdrawn");
      expect(withdrawApplication).toHaveBeenCalledWith(APP_ID, FREELANCER);
      expect(app.locals.broadcastRealtime).toHaveBeenCalled();
    });

    it("400 — rejects when freelancerAddress is missing", async () => {
      const res = await request(app)
        .delete(`/api/applications/${APP_ID}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/freelancerAddress/);
    });

    it("404 — surfaces application-not-found from the service", async () => {
      const err = new Error("Application not found");
      err.status = 404;
      withdrawApplication.mockRejectedValue(err);

      const res = await request(app)
        .delete(`/api/applications/${APP_ID}`)
        .send({ freelancerAddress: FREELANCER });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Application not found");
    });

    it("403 — surfaces authorization rejection from the service", async () => {
      const err = new Error(
        "Only the freelancer who submitted can withdraw this application",
      );
      err.status = 403;
      withdrawApplication.mockRejectedValue(err);

      const res = await request(app)
        .delete(`/api/applications/${APP_ID}`)
        .send({ freelancerAddress: FREELANCER });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Only the freelancer who submitted/);
    });
  });
});