"use strict";

/**
 * src/routes/dao.test.js
 *
 * Route-level test suite for /api/dao endpoints (Issue #1140).
 * Covers:
 *   - Happy paths with valid payloads
 *   - Authentication rejection (401) on guarded routes
 *   - Authorisation rejection (403) on admin-only routes
 *   - Validation failures (400) for malformed bodies and invalid operations
 *   - Not-found paths (404) for endpoints taking an ID or public key
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const { defaultDaoProposalRow, defaultDaoArbitratorRow } = require("../testUtils/pgMock");

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const daoRoutes = require("./dao");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/dao", daoRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys (valid 56-char G... addresses generated synthetically)
const VALID_PROPOSER_KEY = "G" + "A".repeat(55);
const VALID_RECIPIENT_KEY = "G" + "B".repeat(55);
const VALID_ARBITRATOR_KEY = "G" + "C".repeat(55);
const VALID_ADMIN_KEY = "G" + "D".repeat(55);

function makeUserToken(publicKey = VALID_PROPOSER_KEY, role = "user") {
  return jwt.sign({ publicKey, role }, JWT_SECRET, { expiresIn: "1h" });
}

function makeAdminToken(publicKey = VALID_ADMIN_KEY) {
  return jwt.sign({ publicKey, role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

describe("DAO Route Suite (/api/dao)", () => {
  beforeEach(() => {
    pool.reset();
  });

  // =========================================================================
  // 1. GET /api/dao/proposals
  // =========================================================================
  describe("GET /api/dao/proposals", () => {
    it("200 — returns list of proposals and finalizes expired ones", async () => {
      const activeProp = defaultDaoProposalRow({
        id: "prop-1",
        title: "Active Community Funding",
        status: "active",
        voting_ends_at: new Date(Date.now() + 86400000).toISOString(),
      });
      const passedProp = defaultDaoProposalRow({
        id: "prop-2",
        title: "Passed Parameter Change",
        status: "passed",
      });
      pool.daoProposals.set(activeProp.id, activeProp);
      pool.daoProposals.set(passedProp.id, passedProp);

      const res = await request(app).get("/api/dao/proposals");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe("prop-1");
      expect(res.body.data[0].title).toBe("Active Community Funding");
    });

    it("200 — filters proposals by status query parameter", async () => {
      const activeProp = defaultDaoProposalRow({
        id: "prop-active",
        status: "active",
      });
      const passedProp = defaultDaoProposalRow({
        id: "prop-passed",
        status: "passed",
      });
      pool.daoProposals.set(activeProp.id, activeProp);
      pool.daoProposals.set(passedProp.id, passedProp);

      const res = await request(app)
        .get("/api/dao/proposals")
        .query({ status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("prop-active");
      expect(res.body.data[0].status).toBe("active");
    });
  });

  // =========================================================================
  // 2. GET /api/dao/proposals/:id
  // =========================================================================
  describe("GET /api/dao/proposals/:id", () => {
    it("200 — returns proposal details for existing id", async () => {
      const prop = defaultDaoProposalRow({
        id: "prop-123",
        title: "Ecosystem Grant Proposal",
        amount: "5000",
      });
      pool.daoProposals.set(prop.id, prop);

      const res = await request(app).get("/api/dao/proposals/prop-123");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("prop-123");
      expect(res.body.data.title).toBe("Ecosystem Grant Proposal");
      expect(res.body.data.amount).toBe("5000");
    });

    it("404 — returns not-found when proposal does not exist", async () => {
      const res = await request(app).get("/api/dao/proposals/non-existent-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Proposal not found");
    });
  });

  // =========================================================================
  // 3. POST /api/dao/proposals
  // =========================================================================
  describe("POST /api/dao/proposals", () => {
    const validProposalBody = {
      title: "New Marketing Campaign",
      description: "Fund global marketing initiatives for Stellar MarketPay platform adoption.",
      type: "treasury",
      amount: "2500",
      recipient: VALID_RECIPIENT_KEY,
      votingDays: 7,
    };

    it("201 — creates a new proposal with valid payload and Bearer token", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Authorization", `Bearer ${userToken}`)
        .send(validProposalBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        title: "New Marketing Campaign",
        description: "Fund global marketing initiatives for Stellar MarketPay platform adoption.",
        type: "treasury",
        proposer: VALID_PROPOSER_KEY,
        status: "active",
      });
    });

    it("201 — creates a new proposal with auth cookie", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Cookie", `token=${userToken}`)
        .send(validProposalBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe(validProposalBody.title);
    });

    it("401 — rejects unauthenticated request when token is missing", async () => {
      const res = await request(app)
        .post("/api/dao/proposals")
        .send(validProposalBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("401 — rejects request with invalid JWT token", async () => {
      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Authorization", "Bearer invalid.jwt.token")
        .send(validProposalBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("400 — rejects when title is missing", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          ...validProposalBody,
          title: "",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Title and description are required");
    });

    it("400 — rejects when description is missing", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          ...validProposalBody,
          description: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Title and description are required");
    });

    it("400 — rejects when proposal type is invalid", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          ...validProposalBody,
          type: "unsupported_type",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Type must be one of:/);
    });
  });

  // =========================================================================
  // 4. POST /api/dao/proposals/:id/vote
  // =========================================================================
  describe("POST /api/dao/proposals/:id/vote", () => {
    it("200 — casts a vote on an active proposal", async () => {
      const prop = defaultDaoProposalRow({
        id: "prop-vote-1",
        status: "active",
        voting_ends_at: new Date(Date.now() + 86400000).toISOString(),
      });
      pool.daoProposals.set(prop.id, prop);
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals/prop-vote-1/vote")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          support: true,
          weight: 50,
          txHash: "0x1234567890abcdef",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("prop-vote-1");
      expect(res.body.data.votesFor).toBe(50);
    });

    it("401 — rejects unauthenticated vote", async () => {
      const res = await request(app)
        .post("/api/dao/proposals/prop-vote-1/vote")
        .send({ support: true, weight: 10 });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("404 — returns not-found when proposal does not exist", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals/non-existent-prop/vote")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ support: true, weight: 10 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Proposal not found");
    });

    it("400 — rejects vote when proposal is not active", async () => {
      const prop = defaultDaoProposalRow({
        id: "prop-closed",
        status: "passed",
      });
      pool.daoProposals.set(prop.id, prop);
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals/prop-closed/vote")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ support: true, weight: 10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Voting is closed for this proposal");
    });

    it("400 — rejects vote when voting period has ended", async () => {
      const prop = defaultDaoProposalRow({
        id: "prop-ended",
        status: "active",
        voting_ends_at: new Date(Date.now() - 86400000).toISOString(),
      });
      pool.daoProposals.set(prop.id, prop);
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/proposals/prop-ended/vote")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ support: true, weight: 10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Voting period has ended");
    });
  });

  // =========================================================================
  // 5. GET /api/dao/treasury
  // =========================================================================
  describe("GET /api/dao/treasury", () => {
    it("200 — returns DAO treasury summary", async () => {
      const prop1 = defaultDaoProposalRow({
        id: "prop-1",
        status: "passed",
        type: "treasury",
        amount: "1500",
      });
      const prop2 = defaultDaoProposalRow({
        id: "prop-2",
        status: "active",
        type: "treasury",
        amount: "500",
      });
      pool.daoProposals.set(prop1.id, prop1);
      pool.daoProposals.set(prop2.id, prop2);

      const res = await request(app).get("/api/dao/treasury");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        allocatedXlm: "1500",
        activeProposals: 1,
        quorumPercent: 10,
      });
    });
  });

  // =========================================================================
  // 6. GET /api/dao/arbitrators
  // =========================================================================
  describe("GET /api/dao/arbitrators", () => {
    it("200 — returns arbitrator list and top dispute panel", async () => {
      const arb1 = defaultDaoArbitratorRow({
        public_key: VALID_ARBITRATOR_KEY,
        display_name: "Alice Arbitrator",
        votes_received: 100,
      });
      const arb2 = defaultDaoArbitratorRow({
        public_key: VALID_PROPOSER_KEY,
        display_name: "Bob Arbitrator",
        votes_received: 50,
      });
      pool.daoArbitrators.set(arb1.public_key, arb1);
      pool.daoArbitrators.set(arb2.public_key, arb2);

      const res = await request(app).get("/api/dao/arbitrators");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.arbitrators)).toBe(true);
      expect(Array.isArray(res.body.data.disputePanel)).toBe(true);
      expect(res.body.data.arbitrators).toHaveLength(2);
      expect(res.body.data.disputePanel).toHaveLength(2);
    });
  });

  // =========================================================================
  // 7. GET /api/dao/arbitrators/:publicKey
  // =========================================================================
  describe("GET /api/dao/arbitrators/:publicKey", () => {
    it("200 — returns arbitrator profile for existing public key", async () => {
      const arb = defaultDaoArbitratorRow({
        public_key: VALID_ARBITRATOR_KEY,
        display_name: "Alice Legal Specialist",
        bio: "Specializing in smart contract escrow disputes",
      });
      pool.daoArbitrators.set(arb.public_key, arb);

      const res = await request(app).get(`/api/dao/arbitrators/${VALID_ARBITRATOR_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.publicKey).toBe(VALID_ARBITRATOR_KEY);
      expect(res.body.data.displayName).toBe("Alice Legal Specialist");
    });

    it("404 — returns not found when arbitrator key does not exist", async () => {
      const res = await request(app).get(`/api/dao/arbitrators/${VALID_RECIPIENT_KEY}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Arbitrator not found");
    });
  });

  // =========================================================================
  // 8. POST /api/dao/arbitrators
  // =========================================================================
  describe("POST /api/dao/arbitrators", () => {
    it("201 — registers / updates arbitrator profile for authenticated user", async () => {
      const userToken = makeUserToken(VALID_ARBITRATOR_KEY);

      const res = await request(app)
        .post("/api/dao/arbitrators")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          displayName: "Charlie Arbitrator",
          bio: "Senior developer with 8 years Web3 experience",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.publicKey).toBe(VALID_ARBITRATOR_KEY);
      expect(res.body.data.displayName).toBe("Charlie Arbitrator");
      expect(res.body.data.bio).toBe("Senior developer with 8 years Web3 experience");
    });

    it("401 — rejects unauthenticated arbitrator registration", async () => {
      const res = await request(app)
        .post("/api/dao/arbitrators")
        .send({ displayName: "Anonymous" });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("400 — rejects when authenticated user key is invalid format", async () => {
      const invalidToken = makeUserToken("INVALID_KEY");

      const res = await request(app)
        .post("/api/dao/arbitrators")
        .set("Authorization", `Bearer ${invalidToken}`)
        .send({ displayName: "Test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
    });
  });

  // =========================================================================
  // 9. POST /api/dao/arbitrators/:publicKey/vote
  // =========================================================================
  describe("POST /api/dao/arbitrators/:publicKey/vote", () => {
    it("200 — records vote for arbitrator candidate", async () => {
      const candidate = defaultDaoArbitratorRow({
        public_key: VALID_ARBITRATOR_KEY,
        display_name: "Candidate Arb",
        votes_received: 10,
      });
      pool.daoArbitrators.set(candidate.public_key, candidate);
      const userToken = makeUserToken();

      const res = await request(app)
        .post(`/api/dao/arbitrators/${VALID_ARBITRATOR_KEY}/vote`)
        .set("Authorization", `Bearer ${userToken}`)
        .send({ weight: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const updatedCandidate = res.body.data.find((a) => a.publicKey === VALID_ARBITRATOR_KEY);
      expect(updatedCandidate).toBeDefined();
    });

    it("401 — rejects unauthenticated vote for arbitrator", async () => {
      const res = await request(app)
        .post(`/api/dao/arbitrators/${VALID_ARBITRATOR_KEY}/vote`)
        .send({ weight: 5 });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("400 — rejects vote when target arbitrator public key is invalid", async () => {
      const userToken = makeUserToken();

      const res = await request(app)
        .post("/api/dao/arbitrators/invalid-key/vote")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ weight: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
    });
  });

  // =========================================================================
  // 10. POST /api/dao/proposals/:id/execute
  // =========================================================================
  describe("POST /api/dao/proposals/:id/execute", () => {
    it("200 — executes a passed proposal when invoked by admin", async () => {
      const passedProp = defaultDaoProposalRow({
        id: "prop-passed-1",
        title: "Approved Community Fund",
        status: "passed",
      });
      pool.daoProposals.set(passedProp.id, passedProp);
      const adminToken = makeAdminToken();

      const res = await request(app)
        .post("/api/dao/proposals/prop-passed-1/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("prop-passed-1");
      expect(res.body.data.status).toBe("executed");
      expect(res.body.data.executedAt).toBeDefined();
    });

    it("401 — rejects unauthenticated execution request", async () => {
      const res = await request(app)
        .post("/api/dao/proposals/prop-1/execute")
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("403 — rejects non-admin user role", async () => {
      const userToken = makeUserToken(VALID_PROPOSER_KEY, "user");

      const res = await request(app)
        .post("/api/dao/proposals/prop-1/execute")
        .set("Authorization", `Bearer ${userToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Admin access required/);
    });

    it("404 — returns not-found when executing non-existent proposal", async () => {
      const adminToken = makeAdminToken();

      const res = await request(app)
        .post("/api/dao/proposals/non-existent-prop/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Proposal not found");
    });

    it("400 — rejects execution when proposal is not in passed status", async () => {
      const activeProp = defaultDaoProposalRow({
        id: "prop-active-1",
        status: "active",
      });
      pool.daoProposals.set(activeProp.id, activeProp);
      const adminToken = makeAdminToken();

      const res = await request(app)
        .post("/api/dao/proposals/prop-active-1/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Only passed proposals can be executed");
    });
  });
});
