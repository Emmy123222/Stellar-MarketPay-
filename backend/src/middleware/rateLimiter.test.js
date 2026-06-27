"use strict";

const express = require("express");
const request = require("supertest");
const { createRateLimiter } = require("./rateLimiter");

function buildTestApp(maxRequests = 3) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createRateLimiter(maxRequests, 1));
  app.get("/test", (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe("rate limiter IP handling", () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXY_IPS;

  afterEach(() => {
    if (originalTrustedProxies === undefined) {
      delete process.env.TRUSTED_PROXY_IPS;
    } else {
      process.env.TRUSTED_PROXY_IPS = originalTrustedProxies;
    }
  });

  it("blocks requests after the limit regardless of spoofed X-Forwarded-For values", async () => {
    delete process.env.TRUSTED_PROXY_IPS;
    const app = buildTestApp(3);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .get("/test")
        .set("X-Forwarded-For", `10.0.0.${i + 1}`);
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "10.0.0.99");

    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/too many requests/i);
  });

  it("uses a consistent key for the same connection when headers are spoofed", async () => {
    delete process.env.TRUSTED_PROXY_IPS;
    const app = buildTestApp(2);

    const first = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "203.0.113.10");
    const second = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "198.51.100.20");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const third = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "192.0.2.30");

    expect(third.status).toBe(429);
  });

  it("uses forwarded client IP when the request arrives via a trusted proxy", async () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1,::ffff:127.0.0.1";
    const app = buildTestApp(2);

    const first = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "203.0.113.10");
    const second = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "203.0.113.10");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.ip).toBe("203.0.113.10");

    const third = await request(app)
      .get("/test")
      .set("X-Forwarded-For", "203.0.113.10");

    expect(third.status).toBe(429);
  });
});

describe("rate limiter RATE_LIMIT_SCALE override", () => {
  const originalScale = process.env.RATE_LIMIT_SCALE;

  afterEach(() => {
    if (originalScale === undefined) {
      delete process.env.RATE_LIMIT_SCALE;
    } else {
      process.env.RATE_LIMIT_SCALE = originalScale;
    }
  });

  it("defaults to a scale of 1 when the variable is unset", () => {
    delete process.env.RATE_LIMIT_SCALE;
    const { getRateLimitScale } = require("./rateLimiter");
    expect(getRateLimitScale()).toBe(1);
  });

  it("ignores invalid (non-numeric / sub-1) values and falls back to 1", () => {
    const { getRateLimitScale } = require("./rateLimiter");
    process.env.RATE_LIMIT_SCALE = "not-a-number";
    expect(getRateLimitScale()).toBe(1);
    process.env.RATE_LIMIT_SCALE = "0";
    expect(getRateLimitScale()).toBe(1);
    process.env.RATE_LIMIT_SCALE = "-5";
    expect(getRateLimitScale()).toBe(1);
  });

  it("multiplies the request ceiling when a valid scale is configured", async () => {
    process.env.RATE_LIMIT_SCALE = "10";
    // base ceiling of 3 → scaled to 30
    const app = buildTestApp(3);

    // 30 requests must all succeed, the 31st must be throttled
    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
  });
});
