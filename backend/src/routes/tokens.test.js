"use strict";

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/tokenService", () => ({
  getTokenMetadata: jest.fn(),
  getTokenBalance: jest.fn(),
  validateTokenContract: jest.fn(),
  getPopularTokens: jest.fn(),
  searchTokens: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const tokenService = require("../services/tokenService");
const tokensRouter = require("./tokens");

const app = express();
app.use("/api/tokens", tokensRouter);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  res.status(err.status || 500).json({ error: err.message });
});

describe.each([
  ["/api/tokens", "token list"],
  ["/api/tokens/popular", "popular token list"],
])("GET %s", (path, label) => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.getPopularTokens.mockReturnValue([]);
  });

  it(`returns the ${label} with a one-hour public cache header`, async () => {
    const tokens = [{ symbol: "XLM", name: "Stellar Lumens" }];
    tokenService.getPopularTokens.mockReturnValue(tokens);

    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: tokens });
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it(`returns an empty ${label}`, async () => {
    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it(`forwards ${label} service errors`, async () => {
    tokenService.getPopularTokens.mockImplementation(() => {
      throw new Error("token registry unavailable");
    });

    const res = await request(app).get(path);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "token registry unavailable" });
  });
});
