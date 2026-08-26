"use strict";

/**
 * backend/tests/routes/priceAlerts.test.js
 *
 * Route tests for src/routes/priceAlerts.js — issue #1149.
 *
 * Auth and priceAlertService are mocked so the suite runs against a
 * standalone Express app, independent of the database and JWT signing.
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../src/middleware/auth", () => ({
  verifyJWT: jest.fn((req, res, next) => {
    req.user = { publicKey: "GAAAATESTUSERADDRESS0000000000000000000000000000000" };
    next();
  }),
}));

jest.mock("../../src/services/priceAlertService", () => ({
  createPriceAlert: jest.fn(),
  listPriceAlerts: jest.fn(),
  deletePriceAlert: jest.fn(),
}));

const { verifyJWT } = require("../../src/middleware/auth");
const {
  createPriceAlert,
  listPriceAlerts,
  deletePriceAlert,
} = require("../../src/services/priceAlertService");
const { structuredErrorHandler } = require("../../src/utils/errors");
const priceAlertRoutes = require("../../src/routes/priceAlerts");

const USER_ADDRESS = "GAAAATESTUSERADDRESS0000000000000000000000000000000";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/price-alerts", priceAlertRoutes);
  app.use(structuredErrorHandler);
  return app;
}

describe("Price Alerts Routes", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    verifyJWT.mockImplementation((req, res, next) => {
      req.user = { publicKey: USER_ADDRESS };
      next();
    });
    app = buildApp();
  });

  describe("POST /api/price-alerts", () => {
    const ALERT_ROW = {
      id: "alert-1",
      user_address: USER_ADDRESS,
      condition: "above",
      threshold: "0.15",
      one_time: true,
      triggered: false,
      triggered_at: null,
      created_at: "2026-08-26T00:00:00.000Z",
    };

    it("creates a price alert and returns 201 with the serialized alert", async () => {
      createPriceAlert.mockResolvedValue(ALERT_ROW);

      const res = await request(app)
        .post("/api/price-alerts")
        .send({ condition: "above", threshold: 0.15 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        data: {
          id: "alert-1",
          userAddress: USER_ADDRESS,
          condition: "above",
          threshold: "0.15",
          oneTime: true,
          triggered: false,
          triggeredAt: null,
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      });
      expect(createPriceAlert).toHaveBeenCalledWith({
        userAddress: USER_ADDRESS,
        condition: "above",
        threshold: 0.15,
        oneTime: true,
      });
    });

    it("defaults oneTime to true when omitted", async () => {
      createPriceAlert.mockResolvedValue(ALERT_ROW);

      await request(app)
        .post("/api/price-alerts")
        .send({ condition: "above", threshold: 0.15 });

      expect(createPriceAlert).toHaveBeenCalledWith(
        expect.objectContaining({ oneTime: true })
      );
    });

    it("respects an explicit oneTime: false", async () => {
      createPriceAlert.mockResolvedValue({ ...ALERT_ROW, one_time: false });

      await request(app)
        .post("/api/price-alerts")
        .send({ condition: "above", threshold: 0.15, oneTime: false });

      expect(createPriceAlert).toHaveBeenCalledWith(
        expect.objectContaining({ oneTime: false })
      );
    });

    it("propagates service validation errors with their status code", async () => {
      const err = new Error("condition must be 'above' or 'below'");
      err.status = 400;
      createPriceAlert.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/price-alerts")
        .send({ condition: "sideways", threshold: 0.15 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("condition must be 'above' or 'below'");
    });

    it("returns 401 when not authenticated", async () => {
      verifyJWT.mockImplementation((req, res) => {
        res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
      });

      const res = await request(app)
        .post("/api/price-alerts")
        .send({ condition: "above", threshold: 0.15 });

      expect(res.status).toBe(401);
      expect(createPriceAlert).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/price-alerts", () => {
    it("returns the authenticated user's alerts", async () => {
      listPriceAlerts.mockResolvedValue([
        {
          id: "alert-1",
          user_address: USER_ADDRESS,
          condition: "below",
          threshold: "0.10",
          one_time: true,
          triggered: false,
          triggered_at: null,
          created_at: "2026-08-25T00:00:00.000Z",
        },
      ]);

      const res = await request(app).get("/api/price-alerts");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [
          {
            id: "alert-1",
            userAddress: USER_ADDRESS,
            condition: "below",
            threshold: "0.10",
            oneTime: true,
            triggered: false,
            triggeredAt: null,
            createdAt: "2026-08-25T00:00:00.000Z",
          },
        ],
      });
      expect(listPriceAlerts).toHaveBeenCalledWith(USER_ADDRESS);
    });

    it("returns an empty array when the user has no alerts", async () => {
      listPriceAlerts.mockResolvedValue([]);

      const res = await request(app).get("/api/price-alerts");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it("returns 401 when not authenticated", async () => {
      verifyJWT.mockImplementation((req, res) => {
        res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
      });

      const res = await request(app).get("/api/price-alerts");

      expect(res.status).toBe(401);
      expect(listPriceAlerts).not.toHaveBeenCalled();
    });

    it("propagates unexpected service errors as 500s", async () => {
      listPriceAlerts.mockRejectedValue(new Error("DB unavailable"));

      const res = await request(app).get("/api/price-alerts");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("DB unavailable");
    });
  });

  describe("DELETE /api/price-alerts/:id", () => {
    it("deletes the alert and returns 200", async () => {
      deletePriceAlert.mockResolvedValue(true);

      const res = await request(app).delete("/api/price-alerts/alert-1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { deleted: true } });
      expect(deletePriceAlert).toHaveBeenCalledWith("alert-1", USER_ADDRESS);
    });

    it("returns 404 when the alert doesn't exist or isn't owned by the user", async () => {
      const err = new Error("Price alert not found or not owned by user");
      err.status = 404;
      deletePriceAlert.mockRejectedValue(err);

      const res = await request(app).delete("/api/price-alerts/missing-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Price alert not found or not owned by user");
    });

    it("returns 401 when not authenticated", async () => {
      verifyJWT.mockImplementation((req, res) => {
        res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
      });

      const res = await request(app).delete("/api/price-alerts/alert-1");

      expect(res.status).toBe(401);
      expect(deletePriceAlert).not.toHaveBeenCalled();
    });
  });
});
