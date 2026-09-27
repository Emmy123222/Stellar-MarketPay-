"use strict";

/**
 * Refresh token rotation + replay detection (issue #1398).
 * Uses an in-memory fake of the refresh_tokens table instead of Postgres.
 */

jest.mock("../db/pool", () => {
  const {
    createRefreshTokenStoreFake,
  } = require("../testUtils/refreshTokenStoreFake");
  const store = createRefreshTokenStoreFake();
  return { query: jest.fn(store.query), __store: store };
});

// Avoid loading the (ESM-heavy) Stellar SDK; the refresh route never uses it.
jest.mock("@stellar/stellar-sdk", () => ({
  Utils: { buildChallengeTx: jest.fn(), verifyChallengeTx: jest.fn() },
  Keypair: { random: () => ({ secret: () => "S", publicKey: () => "G" }), fromSecret: () => ({ publicKey: () => "G" }) },
}));
jest.mock("../services/twoFactorService", () => ({
  ensureAdminProfile: jest.fn(),
  get2FAStatus: jest.fn().mockResolvedValue({ totp_enabled: false }),
}));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const {
  REFRESH_COOKIE_NAME,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
} = require("./authTokens");

const store = pool.__store;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const PAYLOAD = { publicKey: "GTESTPUBLICKEY", network: "testnet" };

beforeEach(() => {
  store.reset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("refresh token storage", () => {
  it("stores only the SHA-256 hash of the token, unused", async () => {
    const { refreshToken } = await issueTokenPair(PAYLOAD);

    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.token_hash).toBe(sha256(refreshToken));
    expect(JSON.stringify(row)).not.toContain(refreshToken);
    expect(row.used_at).toBeNull();
    expect(row.public_key).toBe(PAYLOAD.publicKey);
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("refresh token rotation", () => {
  it("issues a new pair, marks the old token used_at and keeps the family", async () => {
    const first = await issueTokenPair({ ...PAYLOAD, role: "admin" });

    const rotated = await rotateRefreshToken(first.refreshToken);

    expect(rotated).not.toBeNull();
    expect(rotated.accessToken).toEqual(expect.any(String));
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    const oldRow = store.findByHash(sha256(first.refreshToken));
    const newRow = store.findByHash(sha256(rotated.refreshToken));
    expect(oldRow.used_at).toBeInstanceOf(Date);
    expect(newRow.used_at).toBeNull();
    expect(newRow.family_id).toBe(oldRow.family_id);
    expect(newRow.payload).toMatchObject({ publicKey: PAYLOAD.publicKey, role: "admin" });
  });

  it("allows the newly issued token to be rotated again", async () => {
    const first = await issueTokenPair(PAYLOAD);
    const second = await rotateRefreshToken(first.refreshToken);
    const third = await rotateRefreshToken(second.refreshToken);

    expect(third).not.toBeNull();
    expect(third.refreshToken).not.toBe(second.refreshToken);
  });

  it("returns null for missing, unknown and expired tokens", async () => {
    expect(await rotateRefreshToken(undefined)).toBeNull();
    expect(await rotateRefreshToken("not-a-real-token")).toBeNull();

    const { refreshToken } = await issueTokenPair(PAYLOAD);
    store.findByHash(sha256(refreshToken)).expires_at = new Date(Date.now() - 1000);
    expect(await rotateRefreshToken(refreshToken)).toBeNull();
  });

  it("lets only one of two concurrent rotations of the same token succeed", async () => {
    const { refreshToken } = await issueTokenPair(PAYLOAD);

    const results = await Promise.all([
      rotateRefreshToken(refreshToken),
      rotateRefreshToken(refreshToken),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("replay detection", () => {
  it("rejects a token that has already been used", async () => {
    const { refreshToken } = await issueTokenPair(PAYLOAD);

    expect(await rotateRefreshToken(refreshToken)).not.toBeNull();
    expect(await rotateRefreshToken(refreshToken)).toBeNull();
  });

  it("revokes the whole token family when a used token is replayed", async () => {
    const first = await issueTokenPair(PAYLOAD);
    const second = await rotateRefreshToken(first.refreshToken);

    // Attacker replays the stolen, already-used token...
    expect(await rotateRefreshToken(first.refreshToken)).toBeNull();

    // ...so the legitimate newest token is dead too.
    expect(store.findByHash(sha256(second.refreshToken)).revoked_at).toBeInstanceOf(Date);
    expect(await rotateRefreshToken(second.refreshToken)).toBeNull();
  });

  it("does not touch other sessions when one family is revoked", async () => {
    const mine = await issueTokenPair(PAYLOAD);
    const other = await issueTokenPair({ publicKey: "GOTHERUSER" });

    await rotateRefreshToken(mine.refreshToken);
    await rotateRefreshToken(mine.refreshToken); // replay

    expect(await rotateRefreshToken(other.refreshToken)).not.toBeNull();
  });
});

describe("logout revocation", () => {
  it("revokes the token so it can no longer be exchanged", async () => {
    const { refreshToken } = await issueTokenPair(PAYLOAD);

    await revokeRefreshToken(refreshToken);

    expect(await rotateRefreshToken(refreshToken)).toBeNull();
  });
});

describe("POST /api/auth/refresh", () => {
  const authRouter = require("../routes/auth");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

  const cookieOf = (res, name) =>
    (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${name}=`))?.split(";")[0];

  it("rotates the refresh cookie and returns 401 when the old one is replayed", async () => {
    const { refreshToken } = await issueTokenPair(PAYLOAD);
    const oldCookie = `${REFRESH_COOKIE_NAME}=${refreshToken}`;

    const ok = await request(app).post("/api/auth/refresh").set("Cookie", oldCookie);
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.token).toEqual(expect.any(String));
    const newCookie = cookieOf(ok, REFRESH_COOKIE_NAME);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldCookie);

    const replay = await request(app).post("/api/auth/refresh").set("Cookie", oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatch(/invalid refresh token/i);

    // Replay killed the family, so the freshly issued cookie is rejected too.
    const afterReplay = await request(app).post("/api/auth/refresh").set("Cookie", newCookie);
    expect(afterReplay.status).toBe(401);
  });

  it("returns 401 when no refresh cookie is sent", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });
});
