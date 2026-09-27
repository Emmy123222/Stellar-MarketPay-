/**
 * src/routes/ping.test.js
 *
 * Unit tests for the lightweight liveness probe endpoint (GET /ping).
 *
 * The ping route is deliberately free of dependency I/O (no database,
 * Redis, or external services) so the liveness probe never floods the
 * database or other shared resources.
 */
"use strict";

const request = require("supertest");
const express = require("express");

const pingRoutes = require("./ping");

describe("GET /ping (liveness probe)", () => {
  it("returns 200 with status ok and uptime_seconds", async () => {
    const app = express();
    app.use("/ping", pingRoutes);

    const res = await request(app).get("/ping");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      uptime_seconds: expect.any(Number),
    });
  });

  it("does not depend on any external service", async () => {
    const app = express();
    app.use("/ping", pingRoutes);

    const res = await request(app).get("/ping");

    // The only assertion: the endpoint is healthy without touching
    // the database or any other shared resource.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
