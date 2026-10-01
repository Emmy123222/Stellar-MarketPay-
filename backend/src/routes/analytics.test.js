"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../services/jobService", () => ({
  getCategoryAnalytics: jest.fn(),
  getAnalyticsOverview: jest.fn(),
}));

const {
  getCategoryAnalytics,
  getAnalyticsOverview,
} = require("../services/jobService");
const analyticsRoutes = require("./analytics");

describe("Analytics Routes (/api/analytics)", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/analytics", analyticsRoutes);
  });

  describe("GET /api/analytics/categories", () => {
    it("200 — returns marketplace statistics per category", async () => {
      const mockCategories = [
        {
          category: "Smart Contracts",
          jobCount: 12,
          avgBudgetXLM: 450.5,
          filledCount: 8,
          avgDaysToFill: 3.2,
        },
        {
          category: "Frontend Development",
          jobCount: 0,
          avgBudgetXLM: 0,
          filledCount: 0,
          avgDaysToFill: null,
        },
      ];
      getCategoryAnalytics.mockResolvedValueOnce(mockCategories);

      const res = await request(app).get("/api/analytics/categories");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockCategories);
      expect(getCategoryAnalytics).toHaveBeenCalledTimes(1);
    });

    it("500 — propagates error to error handler", async () => {
      getCategoryAnalytics.mockRejectedValueOnce(new Error("Database failure"));

      const res = await request(app).get("/api/analytics/categories");

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/analytics/overview", () => {
    it("200 — returns platform overview totals", async () => {
      const mockOverview = {
        totalJobs: 25,
        openJobs: 10,
        inProgressJobs: 8,
        completedJobs: 5,
        cancelledJobs: 2,
        totalVolumeXLM: 12500,
        avgJobBudgetXLM: 500,
        avgDaysToFill: 4.5,
      };
      getAnalyticsOverview.mockResolvedValueOnce(mockOverview);

      const res = await request(app).get("/api/analytics/overview");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockOverview);
      expect(getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    it("500 — propagates error to error handler", async () => {
      getAnalyticsOverview.mockRejectedValueOnce(new Error("Database failure"));

      const res = await request(app).get("/api/analytics/overview");

      expect(res.status).toBe(500);
    });
  });
});
