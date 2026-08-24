"use strict";

const request = require("supertest");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-0000-0000-0000-000000000000"),
}));

jest.mock("../services/indexerService", () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  }));
});

jest.mock("../services/priceAlertService", () => ({
  PriceAlertService: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  })),
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

const originalFetch = global.fetch;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/ai/score-job", () => {
  let app;

  beforeAll(() => {
    process.env.CLAUDE_API_KEY = "test-key-123";
    process.env.CONTRACT_ID = "CCONTRACTID123456789012345678901234567890123456789012";
    process.env.STELLAR_NETWORK = "testnet";
    process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.PLATFORM_WALLET_ADDRESS = "GPLATFORMWALLET1234567890123456789012345678901234567890";
    app = require("../server");
  });

  afterAll(() => {
    global.fetch = originalFetch;
    delete process.env.CLAUDE_API_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when description is missing", async () => {
    const res = await request(app)
      .post("/api/ai/score-job")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Job description required");
  });

  it("returns 400 when description is empty string", async () => {
    const res = await request(app)
      .post("/api/ai/score-job")
      .send({ description: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Job description required");
  });

  it("returns a score when Claude API responds successfully", async () => {
    const mockScoreData = {
      score: 85,
      scoreBreakdown: {
        clarity: 90,
        completeness: 80,
        budgetReasonableness: 85,
        skillSpecificity: 85,
      },
      suggestions: ["Add a timeline"],
      missingInformation: ["Budget"],
      strengths: ["Clear title"],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ text: JSON.stringify(mockScoreData) }],
      }),
    });

    const res = await request(app)
      .post("/api/ai/score-job")
      .send({ description: "Build a Soroban smart contract for escrow with milestone-based payments" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.score).toBe(85);
    expect(res.body.data.scoreBreakdown).toEqual(mockScoreData.scoreBreakdown);
    expect(res.body.data.suggestions).toEqual(["Add a timeline"]);
    expect(res.body.data.missingInformation).toEqual(["Budget"]);
    expect(res.body.data.strengths).toEqual(["Clear title"]);
  });

  it("falls back to default score when fetch throws a network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/api/ai/score-job")
      .send({ description: "We need a website built with React and Node.js" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.score).toBe(60);
    expect(res.body.data.suggestions).toEqual([
      "Add more specific project requirements",
      "Include budget information",
    ]);
    expect(res.body.data.missingInformation).toEqual([
      "Timeline",
      "Experience level required",
    ]);
  });

  it("falls back to default score when Claude API returns a non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("Internal Server Error"),
    });

    const res = await request(app)
      .post("/api/ai/score-job")
      .send({ description: "We need a website built with React and Node.js" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.score).toBe(60);
  });

  it("falls back to default score when Claude returns malformed JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ text: "Sure, here's my analysis: this is a great job description!" }],
      }),
    });

    const res = await request(app)
      .post("/api/ai/score-job")
      .send({ description: "Build a Soroban DEX with AMM functionality and integrated wallet" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.score).toBe(65); // Fallback score when JSON parsing fails (analysis.score is 65)
  });
});
