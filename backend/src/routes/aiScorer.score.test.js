const express = require("express");
const request = require("supertest");
const aiScorerRoutes = require("./aiScorer");
const aiService = require("../services/aiService");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai-scorer", aiScorerRoutes);
  return app;
}

describe("POST /api/ai-scorer/score (#1394)", () => {
  let app;
  let originalScoreProposal;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    originalScoreProposal = aiService.scoreProposal;
  });

  afterEach(() => {
    aiService.scoreProposal = originalScoreProposal;
    jest.restoreAllMocks();
  });

  it("returns 503 with safe message when AI service throws", async () => {
    jest.spyOn(aiService, "scoreProposal").mockRejectedValue(new Error("Claude API error: 500 Internal Server Error"));
    jest.spyOn(console, "error").mockImplementation(() => {}); // Suppress error log in tests

    const res = await request(app)
      .post("/api/ai-scorer/score")
      .send({ proposal: "Test" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      score: null,
      reason: "AI scorer temporarily unavailable"
    });
    
    // Verify it was logged
    expect(console.error).toHaveBeenCalledWith("AI Scorer Error:", "Claude API error: 500 Internal Server Error");
  });
});
