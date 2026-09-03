"use strict";
/**
 * backend/src/routes/profiles.migrate.test.js
 * Tests for POST /api/profiles/migrate and the migrated-address redirect —
 * Issue #885 (Stellar account merge / identity migration).
 *
 * Strategy: mock pg with createPgMock (which supports BEGIN/COMMIT via
 * connect()), mock the stellar-sdk Keypair for signature verification, and
 * drive the router with supertest.
 */

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
jest.mock("../utils/email", () => ({ sendEmail: jest.fn() }));
// NOTE: @stellar/stellar-sdk n'est PAS mocké : les tests génèrent de vraies
// paires de clés et de vraies signatures ed25519 (voir makeBody/signer), ce
// qui couvre la vérification cryptographique réelle du service.

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const { Keypair } = require("@stellar/stellar-sdk");
const profilesRouter = require("./profiles");
const cache = require("../services/cacheService");
const { buildChallenge } = require("../services/profileMigrationService");

const app = express();
app.use(express.json());
app.use("/api/profiles", profilesRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// Vraies paires de clés : les signatures sont réellement vérifiées par le
// service (ed25519), ce qui teste le chemin cryptographique de bout en bout.
const KP_OLD = Keypair.random();
const KP_NEW = Keypair.random();
const OLD_KEY = KP_OLD.publicKey();
const NEW_KEY = KP_NEW.publicKey();
const ISSUED_AT = new Date().toISOString();

function signer(kp, iso) {
  // Both signatures must be over the SAME challenge string.
  return kp.sign(Buffer.from(buildChallenge(OLD_KEY, NEW_KEY, iso), "utf8")).toString("hex");
}

function makeBody(overrides = {}) {
  const issuedAt = overrides.issuedAt ?? ISSUED_AT;
  return {
    oldPublicKey: OLD_KEY,
    newPublicKey: NEW_KEY,
    oldSignature: signer(KP_OLD, issuedAt),
    newSignature: signer(KP_NEW, issuedAt),
    issuedAt,
    ...overrides,
  };
}

describe("POST /api/profiles/migrate (Issue #885)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
    cache.del.mockResolvedValue();
  });

  it("200 - happy path: verifies both signatures, migrates, returns summary", async () => {
    // Precondition: old profile exists, new does not.
    pool.query.mockImplementation(async (sql, params) => {
      if (/INSERT INTO profiles/.test(sql)) {
        return { rows: [{ public_key: NEW_KEY }], rowCount: 1 }; // profile created
      }
      if (/FROM profiles WHERE public_key = \$1$/.test(sql) && params[0] === OLD_KEY) {
        return { rows: [{ public_key: OLD_KEY, migrated_to: null }] };
      }
      if (/FROM profiles WHERE public_key = \$1$/.test(sql) && params[0] === NEW_KEY) {
        return { rows: [] };
      }
      if (/^UPDATE /.test(sql)) {
        return { rows: [], rowCount: 2 }; // rows re-pointed old -> new
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app).post("/api/profiles/migrate").send(makeBody());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile_created).toBe(true);
    expect(res.body.data.migratedTo).toBe(NEW_KEY);
    expect(res.body.data["jobs_client"]).toBeDefined();
    // Cache invalidated for both addresses
    expect(cache.del).toHaveBeenCalledWith(`profile:${OLD_KEY}`);
    expect(cache.del).toHaveBeenCalledWith(`profile:${NEW_KEY}`);
  });

  it("400 - missing issuedAt", async () => {
    const body = makeBody();
    delete body.issuedAt;
    const res = await request(app).post("/api/profiles/migrate").send(body);
    expect(res.status).toBe(400);
  });

  it("400 - signature not 64 bytes", async () => {
    const res = await request(app)
      .post("/api/profiles/migrate")
      .send(makeBody({ oldSignature: "tooshort" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oldSignature/);
  });

  it("400 - invalid Stellar address", async () => {
    const res = await request(app)
      .post("/api/profiles/migrate")
      .send(makeBody({ oldPublicKey: "not-a-key" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oldPublicKey/);
  });

  it("400 - old and new addresses must differ", async () => {
    const res = await request(app)
      .post("/api/profiles/migrate")
      .send(makeBody({ newPublicKey: OLD_KEY }));
    expect(res.status).toBe(400);
  });

  it("400 - challenge expired (issuedAt too old)", async () => {
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/profiles/migrate")
      .send(makeBody({ issuedAt: stale }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("401 - old signature fails verification (wrong key)", async () => {
    // Sign with the WRONG (new) key: the challenge is over the same pair, so
    // only the signature content is invalid.
    const body = makeBody();
    body.oldSignature = signer(KP_NEW, body.issuedAt);
    const res = await request(app).post("/api/profiles/migrate").send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/oldSignature/);
  });

  it("409 - old address already migrated", async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/FROM profiles WHERE public_key = \$1$/.test(sql) && params[0] === OLD_KEY) {
        return { rows: [{ public_key: OLD_KEY, migrated_to: NEW_KEY }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).post("/api/profiles/migrate").send(makeBody());
    expect(res.status).toBe(409);
  });

  it("409 - new address is itself migrated", async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/FROM profiles WHERE public_key = \$1$/.test(sql) && params[0] === OLD_KEY) {
        return { rows: [{ public_key: OLD_KEY, migrated_to: null }] };
      }
      if (/FROM profiles WHERE public_key = \$1$/.test(sql) && params[0] === NEW_KEY) {
        return { rows: [{ public_key: NEW_KEY, migrated_to: OLD_KEY }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).post("/api/profiles/migrate").send(makeBody());
    expect(res.status).toBe(409);
  });

  it("404 - old profile not found", async () => {
    pool.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = await request(app).post("/api/profiles/migrate").send(makeBody());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/profiles/:publicKey — migrated redirect (Issue #885)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  it("200 - missing profile with migrated_to returns redirect payload", async () => {
    const { getProfile } = require("../services/profileService");
    getProfile.mockRejectedValue(Object.assign(new Error("Profile not found"), { status: 404 }));
    // getRedirectTarget queries profiles for migrated_to
    pool.query.mockImplementation(async (sql) => {
      if (/migrated_to IS NOT NULL/.test(sql)) {
        return { rows: [{ migrated_to: NEW_KEY }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app).get(`/api/profiles/${OLD_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.redirect).toBe(true);
    expect(res.body.data.migrated_to).toBe(NEW_KEY);
    expect(res.body.data.publicKey).toBe(OLD_KEY);
  });

  it("404 - non-migrated missing address stays 404", async () => {
    const { getProfile } = require("../services/profileService");
    getProfile.mockRejectedValue(Object.assign(new Error("Profile not found"), { status: 404 }));
    pool.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

    const res = await request(app).get(`/api/profiles/${OLD_KEY}`);
    expect(res.status).toBe(404);
  });
});
