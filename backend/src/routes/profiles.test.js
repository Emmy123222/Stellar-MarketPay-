"use strict";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/profileService", () => ({
  listProfiles: jest.fn(),
  getProfile: jest.fn(),
  upsertProfile: jest.fn(),
  blockFreelancer: jest.fn(),
  unblockFreelancer: jest.fn(),
  markProfileForDeletion: jest.fn(),
}));

jest.mock("../services/priceAlertService", () => ({}));
jest.mock("../services/notificationService", () => ({}));
jest.mock("../services/notificationPreferencesService", () => ({
  updatePreferences: jest.fn(),
  getPreferences: jest.fn(),
}));
jest.mock("../services/cacheService", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  profileKey: jest.fn((k) => `profile:${k}`),
  TTL: { PROFILE: 3600 },
}));
jest.mock("../services/ipfsService", () => ({}));
jest.mock("../utils/email", () => ({
  sendEmail: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const profilesRouter = require("./profiles");
const cache = require("../services/cacheService");
const profileService = require("../services/profileService");
const notificationPreferencesService = require("../services/notificationPreferencesService");
const { sendEmail } = require("../utils/email");

const app = express();
app.use(express.json());
app.use("/api/profiles", profilesRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const PUB_KEY = "GBBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const OTHER_KEY = "GAAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

function makeToken(publicKey) {
  return jwt.sign({ publicKey, role: "freelancer" }, JWT_SECRET);
}

describe("Profiles Routes Suite (/api/profiles)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
  });

  describe("GET /api/profiles", () => {
    it("200 - happy path: list profiles", async () => {
      profileService.listProfiles.mockResolvedValue({
        profiles: [{ publicKey: PUB_KEY }],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app).get("/api/profiles");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("GET /api/profiles/:publicKey", () => {
    it("200 - happy path: get one profile", async () => {
      profileService.getProfile.mockResolvedValue({ publicKey: PUB_KEY });
      const res = await request(app).get(`/api/profiles/${PUB_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.publicKey).toBe(PUB_KEY);
    });

    it("404 - not found", async () => {
      const err = new Error("Profile not found");
      err.status = 404;
      profileService.getProfile.mockRejectedValue(err);

      const res = await request(app).get(`/api/profiles/${PUB_KEY}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/profiles", () => {
    it("200 - happy path: upsert profile", async () => {
      const payload = { publicKey: PUB_KEY, displayName: "Test" };
      profileService.upsertProfile.mockResolvedValue(payload);

      const res = await request(app).post("/api/profiles").send(payload);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(profileService.upsertProfile).toHaveBeenCalled();
    });

    it("400 - validation failure", async () => {
      const payload = { publicKey: 12345 }; // Wrong type for zod schema
      const res = await request(app).post("/api/profiles").send(payload);
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/profiles/:publicKey", () => {
    it("200 - happy path", async () => {
      const payload = { displayName: "Updated" };
      profileService.upsertProfile.mockResolvedValue({ ...payload, publicKey: PUB_KEY });
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send(payload);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).put(`/api/profiles/${PUB_KEY}`).send({});
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it("400 - validation failure", async () => {
      const payload = { displayName: 123 }; // Invalid type
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send(payload);
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/profiles/:publicKey/notificationPreferences", () => {
    it("200 - happy path", async () => {
      const prefs = { email: true };
      notificationPreferencesService.getPreferences.mockResolvedValue(prefs);
      const res = await request(app)
        .patch(`/api/profiles/${PUB_KEY}/notificationPreferences`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({ preferences: prefs });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).patch(`/api/profiles/${PUB_KEY}/notificationPreferences`).send({});
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .patch(`/api/profiles/${PUB_KEY}/notificationPreferences`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it("400 - validation failure", async () => {
      const res = await request(app)
        .patch(`/api/profiles/${PUB_KEY}/notificationPreferences`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({}); // Missing preferences object
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/profiles/:publicKey/block", () => {
    it("200 - happy path", async () => {
      profileService.blockFreelancer.mockResolvedValue({});
      const res = await request(app)
        .post(`/api/profiles/${PUB_KEY}/block`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({ address: OTHER_KEY });
      expect(res.status).toBe(200);
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).post(`/api/profiles/${PUB_KEY}/block`).send({});
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .post(`/api/profiles/${PUB_KEY}/block`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`)
        .send({ address: "foo" });
      expect(res.status).toBe(403);
    });

    it("400 - validation failure", async () => {
      const res = await request(app)
        .post(`/api/profiles/${PUB_KEY}/block`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({}); // Missing address
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/profiles/:publicKey/block/:address", () => {
    it("200 - happy path", async () => {
      profileService.unblockFreelancer.mockResolvedValue({});
      const res = await request(app)
        .delete(`/api/profiles/${PUB_KEY}/block/${OTHER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`);
      expect(res.status).toBe(200);
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).delete(`/api/profiles/${PUB_KEY}/block/${OTHER_KEY}`);
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .delete(`/api/profiles/${PUB_KEY}/block/${OTHER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`);
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/profiles/:publicKey/encryption-key", () => {
    const validKey = Buffer.alloc(32).toString("base64");

    it("200 - happy path", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ encryption_public_key: validKey }] });
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}/encryption-key`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({ encryptionPublicKey: validKey });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).put(`/api/profiles/${PUB_KEY}/encryption-key`).send({});
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}/encryption-key`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`)
        .send({ encryptionPublicKey: validKey });
      expect(res.status).toBe(403);
    });

    it("400 - validation failure", async () => {
      const res = await request(app)
        .put(`/api/profiles/${PUB_KEY}/encryption-key`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`)
        .send({ encryptionPublicKey: "not-base64-or-wrong-length" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/profiles/:publicKey/data", () => {
    it("200 - happy path", async () => {
      profileService.markProfileForDeletion.mockResolvedValue({ email: "test@test.com" });
      const res = await request(app)
        .delete(`/api/profiles/${PUB_KEY}/data`)
        .set("Authorization", `Bearer ${makeToken(PUB_KEY)}`);
      expect(res.status).toBe(200);
      expect(sendEmail).toHaveBeenCalled();
    });

    it("401 - auth rejection", async () => {
      const res = await request(app).delete(`/api/profiles/${PUB_KEY}/data`);
      expect(res.status).toBe(401);
    });

    it("403 - authz rejection", async () => {
      const res = await request(app)
        .delete(`/api/profiles/${PUB_KEY}/data`)
        .set("Authorization", `Bearer ${makeToken(OTHER_KEY)}`);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/profiles/:publicKey/earnings", () => {
    it("200 - happy path", async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: "1", amount_xlm: "100", currency: "XLM", released_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { month: "2024-01", total_xlm: "100" },
          ],
        });

      const res = await request(app).get(`/api/profiles/${PUB_KEY}/earnings`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payments).toHaveLength(1);
    });
  });
});
