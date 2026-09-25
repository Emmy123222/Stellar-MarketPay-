"use strict";

const express = require("express");
const request = require("supertest");
const mockQuery = jest.fn();

jest.mock("../db/pool", () => ({ query: (...args) => mockQuery(...args) }));
jest.mock("../middleware/auth", () => ({
  verifyJWT: (req, _res, next) => {
    req.user = { publicKey: "GUSER" };
    next();
  },
}));

const savedSearchesRoutes = require("./savedSearches");
const app = express();
app.use(express.json());
app.use("/api/saved-searches", savedSearchesRoutes);

describe("saved search lifecycle", () => {
  beforeEach(() => mockQuery.mockReset());

  it("deactivates an owned saved search", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "search-1", active: false, deleted_at: "2026-09-23T00:00:00Z" }],
    });

    const response = await request(app)
      .patch("/api/saved-searches/search-1")
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    const [query, params] = mockQuery.mock.calls[0];
    expect(query).toContain("active = $3");
    expect(query).toContain("deleted_at = CASE WHEN $3 = FALSE");
    expect(params).toEqual([undefined, undefined, false, "search-1", "GUSER"]);
  });
});
