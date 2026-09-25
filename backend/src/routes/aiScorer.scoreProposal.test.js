"use strict";

/**
 * src/routes/aiScorer.scoreProposal.test.js — Issue #1548
 *
 * Real-time proposal scoring: Relevance / Clarity / Completeness (0-100).
 *
 * Note: `src/server.js` currently carries a pre-existing merge corruption
 * (duplicate route declarations) that is unrelated to this issue and stops the
 * whole app from booting, so these tests mount the aiScorer router on a minimal
 * Express app instead of requiring the full server.
 */

const express = require("express");
const request = require("supertest");

const aiScorerRoutes = require("./aiScorer");

const originalFetch = global.fetch;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai-scorer", aiScorerRoutes);
  return app;
}

function mockClaude(payload) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({
      content: [
        {
          text: typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      ],
    }),
  });
}

describe("POST /api/ai-scorer/score-proposal", () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    process.env.CLAUDE_API_KEY = "test-key-123";
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns 400 when the proposal is missing", async () => {
    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Proposal text required");
  });

  it("returns 400 when the proposal is blank", async () => {
    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({ proposal: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Proposal text required");
  });

  it("returns relevance, clarity and completeness scores (0-100)", async () => {
    mockClaude({
      relevance: 88,
      clarity: 72,
      completeness: 65,
      suggestions: ["Add a delivery timeline"],
    });

    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({
        proposal:
          "I have shipped three Soroban escrow contracts and will deliver in two weeks.",
        jobTitle: "Build a Soroban escrow contract",
        jobDescription: "Milestone-based escrow with dispute resolution.",
        skills: ["Rust", "Soroban"],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      relevance: 88,
      clarity: 72,
      completeness: 65,
      overall: 75,
    });
    expect(res.body.data.suggestions).toEqual(["Add a delivery timeline"]);
    expect(res.body.warning).toBeUndefined();
  });

  it("clamps out-of-range dimension scores into 0-100", async () => {
    mockClaude({ relevance: 150, clarity: -20, completeness: 80 });

    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({ proposal: "A reasonably detailed proposal body." });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      relevance: 100,
      clarity: 0,
      completeness: 80,
    });
  });

  it("returns a warning instead of an error when the Claude API fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({ proposal: "A reasonably detailed proposal body." });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      score: null,
      reason: "AI scorer temporarily unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith("AI proposal scoring failed:", "ECONNREFUSED");
    errorSpy.mockRestore();
  });

  it("returns a warning when the Claude API key is not configured", async () => {
    delete process.env.CLAUDE_API_KEY;
    global.fetch = jest.fn();

    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({ proposal: "A reasonably detailed proposal body." });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.warning).toMatch(/AI scoring is unavailable/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns a warning when Claude responds with malformed JSON", async () => {
    mockClaude("Sure! This proposal looks pretty good to me.");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app)
      .post("/api/ai-scorer/score-proposal")
      .send({ proposal: "A reasonably detailed proposal body." });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      score: null,
      reason: "AI scorer temporarily unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "AI proposal scoring failed:",
      expect.stringContaining("Unexpected token"),
    );
    errorSpy.mockRestore();
  });
});
