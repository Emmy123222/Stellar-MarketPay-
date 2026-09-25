"use strict";

const express = require("express");
const request = require("supertest");

// Replace the Redis-backed store with an in-memory implementation so the
// unit test can run without a live Redis instance. All limiter instances
// share the same module-level Map.
jest.mock("../middleware/redisRateLimitStore", () => {
  const store = new Map();

  class InMemoryStore {
    constructor({ prefix } = {}) {
      this.prefix = prefix || "";
      this.localKeys = false;
      this.windowMs = 0;
    }

    init(options) {
      this.windowMs = Number(options?.windowMs) || 0;
    }

    async increment(key) {
      const fullKey = `${this.prefix}${key}`;
      const now = Date.now();
      let record = store.get(fullKey);

      if (!record || record.expiresAt <= now) {
        record = { totalHits: 0, expiresAt: now + this.windowMs };
      }

      record.totalHits += 1;
      store.set(fullKey, record);

      return {
        totalHits: record.totalHits,
        resetTime: new Date(record.expiresAt),
      };
    }

    async decrement(key) {
      const fullKey = `${this.prefix}${key}`;
      const record = store.get(fullKey);
      if (!record) return;
      if (record.totalHits <= 1) {
        store.delete(fullKey);
      } else {
        record.totalHits -= 1;
        store.set(fullKey, record);
      }
    }

    async resetKey(key) {
      store.delete(`${this.prefix}${key}`);
    }
  }

  return {
    RedisRateLimitStore: InMemoryStore,
    getRateLimitRedisClient: () => ({}),
    storeUnavailableError: (cause) => {
      const err = new Error("Rate limiting service unavailable");
      err.status = 503;
      err.cause = cause;
      return err;
    },
  };
});

// Mock the faucet service so we can isolate rate-limit behavior.
jest.mock("../services/faucetService", () => ({
  fundTestnetWallet: jest.fn().mockResolvedValue({
    success: true,
    message: "Successfully funded testnet wallet",
    fundedAmount: "10000",
    newBalance: "10000",
    transactionHash: "abc123",
    ledger: 1,
  }),
  checkAccountNeedsFunding: jest.fn().mockResolvedValue({
    needsFunding: true,
    currentBalance: "0",
    exists: false,
  }),
  isTestnet: () => true,
}));

const faucetRouter = require("./faucet");

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/faucet", faucetRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("faucet wallet-based rate limiting", () => {
  const previousTrustedProxies = process.env.TRUSTED_PROXY_IPS;

  beforeEach(() => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1,::ffff:127.0.0.1";
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (previousTrustedProxies === undefined) {
      delete process.env.TRUSTED_PROXY_IPS;
    } else {
      process.env.TRUSTED_PROXY_IPS = previousTrustedProxies;
    }
  });

  it("allows the first funding request for a wallet", async () => {
    const app = buildApp();
    const wallet = "G" + "A".repeat(55);

    const res = await request(app)
      .post("/api/faucet/fund")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: wallet });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("blocks a second funding request for the same wallet within 24 hours", async () => {
    const app = buildApp();
    const wallet = "G" + "B".repeat(55);

    await request(app)
      .post("/api/faucet/fund")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: wallet })
      .expect(200);

    const blocked = await request(app)
      .post("/api/faucet/fund")
      .set("X-Forwarded-For", "198.51.100.99")
      .send({ publicKey: wallet });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.body).toEqual({
      message: "Too many requests — please wait before trying again",
    });
  });

  it("does not apply the wallet limit to the check endpoint", async () => {
    const app = buildApp();
    const wallet = "G" + "C".repeat(55);

    // First funding request consumes the wallet bucket.
    await request(app)
      .post("/api/faucet/fund")
      .set("X-Forwarded-For", "203.0.113.20")
      .send({ publicKey: wallet })
      .expect(200);

    // The check endpoint should still succeed for the same wallet.
    const check = await request(app)
      .get(`/api/faucet/check/${wallet}`)
      .set("X-Forwarded-For", "203.0.113.21");

    expect(check.status).toBe(200);
    expect(check.body.success).toBe(true);
  });
});