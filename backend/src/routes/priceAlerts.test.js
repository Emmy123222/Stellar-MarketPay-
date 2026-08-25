"use strict";

/**
 * src/routes/priceAlerts.test.js
 *
 * Route-level test suite for /api/price-alerts endpoints (Issue #1149).
 * Covers:
 *   - Happy paths with valid payloads (POST create, GET list, DELETE by id)
 *   - Authentication rejection (401) on guarded routes
 *   - Validation failure (400) for malformed POST bodies
 *   - Not-found paths (404) for DELETE on unknown or unowned alerts
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const { defaultPriceAlertRow } = require("../testUtils/pgMock");

const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const { doubleCsrfProtection, generateCsrfToken } = require("../middleware/csrf");
const { fetchCsrf, applyCsrf } = require("../testUtils/csrfTestHelpers");
const priceAlertRoutes = require("./priceAlerts");

const app = express();
app.use(cookieParser());
app.get("/api/auth/csrf-token", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});
app.use(doubleCsrfProtection);
app.use(express.json());
app.use("/api/price-alerts", priceAlertRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

const USER_ADDRESS = "G" + "A".repeat(55);
const OTHER_USER_ADDRESS = "G" + "B".repeat(55);

function makeToken(publicKey = USER_ADDRESS) {
  return jwt.sign({ publicKey, role: "freelancer" }, JWT_SECRET, { expiresIn: "1h" });
}

async function authedPost(path, body, publicKey = USER_ADDRESS) {
  const csrf = await fetchCsrf(app);
  return applyCsrf(
    request(app)
      .post(path)
      .set("Authorization", `Bearer ${makeToken(publicKey)}`)
      .send(body),
    csrf,
  );
}

async function authedDelete(path, publicKey = USER_ADDRESS) {
  const csrf = await fetchCsrf(app);
  return applyCsrf(
    request(app)
      .delete(path)
      .set("Authorization", `Bearer ${makeToken(publicKey)}`),
    csrf,
  );
}

describe("Price Alerts Route Suite (/api/price-alerts)", () => {
  beforeEach(() => {
    pool.reset();
  });

  describe("POST /api/price-alerts", () => {
    it("201 — creates a price alert with a valid payload", async () => {
      const res = await authedPost("/api/price-alerts", {
        condition: "above",
        threshold: 0.15,
        oneTime: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        userAddress: USER_ADDRESS,
        condition: "above",
        threshold: "0.15",
        oneTime: true,
        triggered: false,
      });
      expect(res.body.data.id).toBeDefined();
    });

    it("401 — rejects unauthenticated create requests", async () => {
      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app).post("/api/price-alerts").send({
          condition: "above",
          threshold: 0.15,
        }),
        csrf,
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("401 — rejects create requests with an invalid token", async () => {
      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app)
          .post("/api/price-alerts")
          .set("Authorization", "Bearer not-a-valid-token")
          .send({ condition: "above", threshold: 0.15 }),
        csrf,
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("400 — rejects invalid condition values", async () => {
      const res = await authedPost("/api/price-alerts", {
        condition: "sideways",
        threshold: 0.15,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("condition must be 'above' or 'below'");
    });

    it("400 — rejects non-positive thresholds", async () => {
      const res = await authedPost("/api/price-alerts", {
        condition: "below",
        threshold: 0,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("threshold must be a positive number");
    });

    it("400 — rejects non-numeric thresholds", async () => {
      const res = await authedPost("/api/price-alerts", {
        condition: "above",
        threshold: "not-a-number",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("threshold must be a positive number");
    });
  });

  describe("GET /api/price-alerts", () => {
    it("200 — returns active alerts for the authenticated user", async () => {
      const alert = defaultPriceAlertRow({
        id: "alert-1",
        user_address: USER_ADDRESS,
        condition: "below",
        threshold: "0.1200000",
      });
      const otherAlert = defaultPriceAlertRow({
        id: "alert-2",
        user_address: OTHER_USER_ADDRESS,
        condition: "above",
        threshold: "0.2000000",
      });
      pool.priceAlerts.set(alert.id, alert);
      pool.priceAlerts.set(otherAlert.id, otherAlert);

      const res = await request(app)
        .get("/api/price-alerts")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: "alert-1",
        userAddress: USER_ADDRESS,
        condition: "below",
        threshold: "0.1200000",
      });
    });

    it("200 — returns an empty list when the user has no alerts", async () => {
      const res = await request(app)
        .get("/api/price-alerts")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("401 — rejects unauthenticated list requests", async () => {
      const res = await request(app).get("/api/price-alerts");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });
  });

  describe("DELETE /api/price-alerts/:id", () => {
    it("200 — deletes an owned price alert", async () => {
      const alert = defaultPriceAlertRow({
        id: "alert-owned",
        user_address: USER_ADDRESS,
      });
      pool.priceAlerts.set(alert.id, alert);

      const res = await authedDelete("/api/price-alerts/alert-owned");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ deleted: true });
      expect(pool.priceAlerts.has("alert-owned")).toBe(false);
    });

    it("401 — rejects unauthenticated delete requests", async () => {
      const csrf = await fetchCsrf(app);
      const res = await applyCsrf(
        request(app).delete("/api/price-alerts/alert-missing"),
        csrf,
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("404 — returns not found when the alert id does not exist", async () => {
      const res = await authedDelete("/api/price-alerts/alert-missing");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Price alert not found or not owned by user");
    });

    it("404 — returns not found when the alert belongs to another user", async () => {
      const alert = defaultPriceAlertRow({
        id: "alert-other",
        user_address: OTHER_USER_ADDRESS,
      });
      pool.priceAlerts.set(alert.id, alert);

      const res = await authedDelete("/api/price-alerts/alert-other");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Price alert not found or not owned by user");
      expect(pool.priceAlerts.has("alert-other")).toBe(true);
    });
  });
});
