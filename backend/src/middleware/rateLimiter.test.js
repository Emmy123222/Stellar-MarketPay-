"use strict";

const express = require("express");
const request = require("supertest");
const { createRateLimiter, getRateLimitScale, scaleMaxRequests, rateLimitLogger } = require("./rateLimiter");

function buildTestApp(maxRequests = 3, options = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createRateLimiter(maxRequests, 1, options));
  app.get("/test", (req, res) => {
    res.json({ ip: req.ip });
  });
  app.post("/test", (req, res) => {
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
    expect(getRateLimitScale()).toBe(1);
  });

  it("ignores invalid (non-numeric / sub-1) values and falls back to 1", () => {
    process.env.RATE_LIMIT_SCALE = "not-a-number";
    expect(getRateLimitScale()).toBe(1);
    process.env.RATE_LIMIT_SCALE = "0";
    expect(getRateLimitScale()).toBe(1);
    process.env.RATE_LIMIT_SCALE = "-5";
    expect(getRateLimitScale()).toBe(1);
  });

  it("multiplies the request ceiling when a valid scale is configured", async () => {
    process.env.RATE_LIMIT_SCALE = "10";
    const app = buildTestApp(3);

    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
  });
});

describe("Retry-After header on 429 responses", () => {
  it("includes Retry-After header with correct seconds on 429", async () => {
    const app = buildTestApp(1, { name: "test-retry" });

    const first = await request(app).get("/test");
    expect(first.status).toBe(200);

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // 1 minute window → Retry-After should be 60
    expect(Number(blocked.headers["retry-after"])).toBe(60);
  });

  it("returns Retry-After in the 15-minute window", async () => {
    const app = buildTestApp(1, { name: "test-15min" });

    // Create a limiter with 15-minute window for testing
    const limiter = createRateLimiter(1, 15, { name: "test-15min-limiter" });
    const testApp = express();
    testApp.set("trust proxy", 1);
    testApp.use(limiter);
    testApp.get("/test", (req, res) => res.json({ ok: true }));

    const first = await request(testApp).get("/test");
    expect(first.status).toBe(200);

    const blocked = await request(testApp).get("/test");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBe(900); // 15 * 60 = 900
  });
});

describe("rate limiter logging", () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(rateLimitLogger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs a warning with endpoint, ip, method, and path when rate limit is exceeded", async () => {
    const app = buildTestApp(1, { name: "test-endpoint" });

    const first = await request(app).get("/test");
    expect(first.status).toBe(200);

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logEntry = warnSpy.mock.calls[0][0];
    expect(logEntry).toMatchObject({
      endpoint: "test-endpoint",
      method: "GET",
      path: "/test",
    });
    expect(logEntry.ip).toBeDefined();
    expect(typeof logEntry.ip).toBe("string");
    expect(logEntry.retryAfter).toBe(60);
  });

  it("logs the endpoint name specified in options", async () => {
    const app = buildTestApp(1, { name: "auth-write" });

    await request(app).get("/test"); // 1st request (succeeds)
    await request(app).get("/test"); // 2nd request (blocked)

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0].endpoint).toBe("auth-write");
  });
});

describe("rate limiter named options", () => {
  it("accepts a custom name for endpoint identification", async () => {
    const app = buildTestApp(2, { name: "custom-endpoint" });

    const first = await request(app).get("/test");
    const second = await request(app).get("/test");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
  });

  it("works without options for backward compatibility", async () => {
    const app = buildTestApp(2);

    const first = await request(app).get("/test");
    const second = await request(app).get("/test");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
  });
});

describe("per-endpoint rate limits", () => {
  describe("auth-write limiter (10 per 15 minutes)", () => {
    it("allows up to 10 requests in a 15-minute window", async () => {
      const limiter = createRateLimiter(10, 15, { name: "auth-write" });
      const app = express();
      app.set("trust proxy", 1);
      app.use(limiter);
      app.post("/auth", (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 10; i++) {
        const res = await request(app).post("/auth");
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).post("/auth");
      expect(blocked.status).toBe(429);
    });
  });

  describe("applications-write limiter (5 per minute)", () => {
    it("allows up to 5 POST requests per minute", async () => {
      const limiter = createRateLimiter(5, 1, { name: "applications-write" });
      const app = express();
      app.set("trust proxy", 1);
      app.use(limiter);
      app.post("/applications", (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 5; i++) {
        const res = await request(app).post("/applications");
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).post("/applications");
      expect(blocked.status).toBe(429);
    });
  });

  describe("jobs-write limiter (3 per minute)", () => {
    it("allows up to 3 POST requests per minute", async () => {
      const limiter = createRateLimiter(3, 1, { name: "jobs-write" });
      const app = express();
      app.set("trust proxy", 1);
      app.use(limiter);
      app.post("/jobs", (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        const res = await request(app).post("/jobs");
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).post("/jobs");
      expect(blocked.status).toBe(429);
    });
  });

  describe("read limiters (100 per minute)", () => {
    it("allows up to 100 GET requests per minute", async () => {
      const limiter = createRateLimiter(100, 1, { name: "read" });
      const app = express();
      app.set("trust proxy", 1);
      app.use(limiter);
      app.get("/data", (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 100; i++) {
        const res = await request(app).get("/data");
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).get("/data");
      expect(blocked.status).toBe(429);
    });
  });
});

describe("scaleMaxRequests", () => {
  const originalScale = process.env.RATE_LIMIT_SCALE;

  afterEach(() => {
    if (originalScale === undefined) {
      delete process.env.RATE_LIMIT_SCALE;
    } else {
      process.env.RATE_LIMIT_SCALE = originalScale;
    }
  });

  it("returns the raw value when scale is 1", () => {
    delete process.env.RATE_LIMIT_SCALE;
    expect(scaleMaxRequests(10)).toBe(10);
  });

  it("multiplies by the scale factor", () => {
    process.env.RATE_LIMIT_SCALE = "5";
    expect(scaleMaxRequests(10)).toBe(50);
  });

  it("always returns at least 1", () => {
    process.env.RATE_LIMIT_SCALE = "1";
    expect(scaleMaxRequests(0)).toBe(1);
    expect(scaleMaxRequests(-5)).toBe(1);
  });
});
