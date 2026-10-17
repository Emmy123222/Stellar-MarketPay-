"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const categoriesRouter = require("./categories");

const app = express();
app.use("/api/categories", categoriesRouter);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  res.status(err.status || 500).json({ error: err.message });
});

describe("GET /api/categories", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it("returns the category tree and one-hour public cache header", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: 1, slug: "technology", name: "Technology", parent_id: null },
        { id: 2, slug: "web", name: "Web Development", parent_id: 1 },
      ],
    });

    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{
        id: 1,
        slug: "technology",
        name: "Technology",
        children: [{ id: 2, slug: "web", name: "Web Development", children: [] }],
      }],
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("returns an empty list when no categories exist", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("forwards database errors to the error handler", async () => {
    pool.query.mockRejectedValue(new Error("database unavailable"));

    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "database unavailable" });
  });
});
