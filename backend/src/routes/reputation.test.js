"use strict";

/**
 * src/routes/reputation.test.js — Issue #1561
 */

jest.mock("../services/reputationService", () => ({
  getReputation: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { getReputation } = require("../services/reputationService");
const reputationRoutes = require("./reputation");

const app = express();
app.use("/api/reputation", reputationRoutes);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const USER = "G" + "A".repeat(55);

describe("GET /api/reputation/:userId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("200 — returns the reputation score", async () => {
    getReputation.mockResolvedValue({ userId: USER, score: 80, scoreBps: 8000, label: "Trusted" });

    const res = await request(app).get(`/api/reputation/${USER}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ score: 80, scoreBps: 8000 });
    expect(getReputation).toHaveBeenCalledWith(USER);
  });

  it("400 — rejects malformed addresses", async () => {
    const res = await request(app).get("/api/reputation/not-a-key");
    expect(res.status).toBe(400);
    expect(getReputation).not.toHaveBeenCalled();
  });

  it("404 — when the address has no profile", async () => {
    getReputation.mockResolvedValue(null);
    const res = await request(app).get(`/api/reputation/${USER}`);
    expect(res.status).toBe(404);
  });

  it("500 — propagates service errors", async () => {
    getReputation.mockRejectedValue(new Error("db down"));
    const res = await request(app).get(`/api/reputation/${USER}`);
    expect(res.status).toBe(500);
  });
});
