"use strict";

const express = require("express");
const request = require("supertest");

// Mock the database pool
jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const searchRoutes = require("./search");
const {
  searchAll,
  searchJobs,
  searchFreelancers,
  searchProposals,
} = require("../services/unifiedSearchService");

describe("Unified Search API & Service", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/search", searchRoutes);
  });

  describe("GET /api/search", () => {
    it("returns empty arrays when query parameter q is missing or empty", async () => {
      const res = await request(app).get("/api/search");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        jobs: [],
        freelancers: [],
        proposals: [],
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("returns empty arrays when query parameter q is whitespace", async () => {
      const res = await request(app).get("/api/search?q=   ");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        jobs: [],
        freelancers: [],
        proposals: [],
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("executes full-text search across all three entity types and returns results", async () => {
      // Mock database responses for jobs, freelancers, and proposals
      pool.query.mockImplementation(async (sql, _params) => {
        if (sql.includes("FROM jobs")) {
          return {
            rows: [
              {
                id: "job-1",
                title: "Soroban Smart Contract Developer",
                description: "Build Rust smart contracts for Stellar DEX",
                budget: "1000",
                currency: "USDC",
                category: "Smart Contracts",
                status: "open",
                clientAddress: "GCLIENT123",
                createdAt: "2026-09-01T00:00:00Z",
                rank: "0.85",
              },
            ],
          };
        }
        if (sql.includes("FROM profiles")) {
          return {
            rows: [
              {
                publicKey: "GFREELANCER123",
                displayName: "Alice Stellar",
                bio: "Experienced Soroban Rust engineer",
                skills: ["Soroban", "Rust", "TypeScript"],
                rating: "4.95",
                completedJobs: 12,
                role: "freelancer",
                createdAt: "2026-08-01T00:00:00Z",
                rank: "0.92",
              },
            ],
          };
        }
        if (sql.includes("FROM dao_proposals")) {
          return {
            rows: [
              {
                id: "prop-1",
                title: "Fund Soroban Security Audit Grant",
                description: "Proposal to allocate treasury funds for audits",
                type: "treasury",
                proposer: "GPROPOSER123",
                amount: "50000",
                recipient: "GAUDIT123",
                status: "active",
                votingEndsAt: "2026-10-01T00:00:00Z",
                createdAt: "2026-09-15T00:00:00Z",
                rank: "0.78",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const res = await request(app).get("/api/search?q=soroban");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("jobs");
      expect(res.body).toHaveProperty("freelancers");
      expect(res.body).toHaveProperty("proposals");

      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.jobs[0].title).toBe("Soroban Smart Contract Developer");
      expect(res.body.jobs[0].rank).toBe(0.85);

      expect(res.body.freelancers).toHaveLength(1);
      expect(res.body.freelancers[0].displayName).toBe("Alice Stellar");
      expect(res.body.freelancers[0].skills).toContain("Rust");
      expect(res.body.freelancers[0].rank).toBe(0.92);

      expect(res.body.proposals).toHaveLength(1);
      expect(res.body.proposals[0].title).toBe("Fund Soroban Security Audit Grant");
      expect(res.body.proposals[0].type).toBe("treasury");
      expect(res.body.proposals[0].rank).toBe(0.78);
    });
  });

  describe("unifiedSearchService tsvector query verification", () => {
    it("uses tsvector and ts_rank with plainto_tsquery for jobs", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await searchJobs("stellar rust", 5);

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector");
      expect(sql).toContain("ts_rank");
      expect(sql).toContain("plainto_tsquery('english', $1)");
      expect(sql).toContain("LIMIT $2");
      expect(params).toEqual(["stellar rust", 5]);
    });

    it("uses tsvector and ts_rank with plainto_tsquery for freelancers", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await searchFreelancers("alice", 5);

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector");
      expect(sql).toContain("ts_rank");
      expect(sql).toContain("plainto_tsquery('english', $1)");
      expect(sql).toContain("role IN ('freelancer', 'both')");
      expect(sql).toContain("LIMIT $2");
      expect(params).toEqual(["alice", 5]);
    });

    it("uses tsvector and ts_rank with plainto_tsquery for DAO proposals", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await searchProposals("treasury audit", 5);

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector");
      expect(sql).toContain("ts_rank");
      expect(sql).toContain("plainto_tsquery('english', $1)");
      expect(sql).toContain("LIMIT $2");
      expect(params).toEqual(["treasury audit", 5]);
    });

    it("handles database errors gracefully in searchAll without failing the whole request", async () => {
      pool.query.mockImplementation(async (sql) => {
        if (sql.includes("FROM jobs")) throw new Error("Jobs DB timeout");
        return { rows: [] };
      });

      const result = await searchAll("test");
      expect(result.jobs).toEqual([]);
      expect(result.freelancers).toEqual([]);
      expect(result.proposals).toEqual([]);
    });
  });
});
