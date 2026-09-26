"use strict";

/**
 * src/routes/admin2fa.test.js
 *
 * Unit tests for admin TOTP endpoints mounted at /api/admin/2fa.
 *
 * Coverage per endpoint, per the scope of issue #1134:
 *   POST /api/admin/2fa/setup    : happy path + 401 + 403 + 400 (already enabled)
 *   POST /api/admin/2fa/verify   : happy path + 401 + 400 (validation / no setup)
 *   POST /api/admin/2fa/disable  : happy path + 401 + 400 (missing credential)
 *   GET  /api/admin/2fa/status   : happy path + 401 + 403
 *
 * These routes have no :id params — the "not found" case is covered by
 * verify when setup was never initiated (getDecryptedSecret → null).
 *
 * DB pool is mocked with src/testUtils/pgMock.js.
 * CSRF tokens are fetched via src/testUtils/csrfTestHelpers.js before each
 * mutating (POST) request.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { fetchCsrf, applyCsrf } = require("../testUtils/csrfTestHelpers");

// ─────────────────────────────────────────────────────────────────────────
// Mocks (must be installed before requiring server)
// ─────────────────────────────────────────────────────────────────────────

jest.mock("../services/priceAlertService", () => {
  const mod = jest.requireActual("../services/priceAlertService");
  class Mock {}
  Mock.prototype.start = jest.fn();
  Mock.prototype.stop = jest.fn();
  const out = Object.assign({}, mod, { PriceAlertService: Mock });
  Object.defineProperty(out, "__esModule", { value: false });
  return out;
});

jest.mock("../services/indexerService", () => {
  class MockIndexer {}
  MockIndexer.prototype.start = jest.fn();
  return MockIndexer;
});

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

jest.mock("../services/twoFactorService", () => ({
  generateSecret: jest.fn(),
  generateBackupCodes: jest.fn(),
  ensureAdminProfile: jest.fn().mockResolvedValue(undefined),
  getDecryptedSecret: jest.fn(),
  enable2FA: jest.fn().mockResolvedValue(undefined),
  verify2FA: jest.fn(),
  verifyBackupCode: jest.fn(),
  disable2FA: jest.fn().mockResolvedValue(undefined),
  get2FAStatus: jest.fn(),
}));

jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,FAKEQR"),
}));

jest.mock("speakeasy", () => ({
  totp: {
    verify: jest.fn(),
  },
}));

const pool = require("../db/pool");
const { JWT_SECRET } = require("../middleware/auth");
const twoFactor = require("../services/twoFactorService");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const express = require("express");
const cookieParser = require("cookie-parser");
const {
  doubleCsrfProtection,
  generateCsrfToken,
} = require("../middleware/csrf");
const admin2faRoutes = require("./admin2fa");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(doubleCsrfProtection);
app.use((req, res, next) => {
  res.cookie("dummy-csrf-token", "dummy");
  next();
});
app.get("/api/auth/csrf-token", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});
app.use("/api/admin/2fa", admin2faRoutes);
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers / fixtures
// ─────────────────────────────────────────────────────────────────────────

const ADMIN = "G" + "A".repeat(55);
const USER = "G" + "U".repeat(55);
const FAKE_SECRET = "JBSWY3DPEHPK3PXP";

function adminToken(extras = {}) {
  return jwt.sign(
    Object.assign(
      {
        publicKey: ADMIN,
        address: ADMIN,
        role: "admin",
        "2fa_verified": false,
      },
      extras,
    ),
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function userToken() {
  return jwt.sign(
    { publicKey: USER, address: USER, role: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function postWithCsrf(url, { token, body } = {}) {
  const csrf = await fetchCsrf(app);
  let req = request(app).post(url);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) req = req.send(body);
  return applyCsrf(req, csrf);
}

beforeEach(() => {
  jest.clearAllMocks();
  if (typeof pool.reset === "function") pool.reset();

  twoFactor.ensureAdminProfile.mockResolvedValue(undefined);
  twoFactor.enable2FA.mockResolvedValue(undefined);
  twoFactor.disable2FA.mockResolvedValue(undefined);
  twoFactor.generateSecret.mockReturnValue({
    base32: FAKE_SECRET,
    otpauth_url: `otpauth://totp/StellarMarketPay:${ADMIN}?secret=${FAKE_SECRET}`,
  });
  twoFactor.generateBackupCodes.mockReturnValue({
    plain: ["AAAA", "BBBB"],
    hashed: ["hash1", "hash2"],
  });
  twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
  twoFactor.getDecryptedSecret.mockResolvedValue(null);
  twoFactor.verify2FA.mockResolvedValue({
    success: false,
    error: "Invalid 2FA code",
  });
  twoFactor.verifyBackupCode.mockResolvedValue({
    success: false,
    error: "Invalid backup code",
  });
  QRCode.toDataURL.mockResolvedValue("data:image/png;base64,FAKEQR");
  speakeasy.totp.verify.mockReturnValue(true);
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/admin/2fa/status
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/2fa/status", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get("/api/admin/2fa/status");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not an admin", async () => {
    const res = await request(app)
      .get("/api/admin/2fa/status")
      .set("Authorization", `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it("returns 2FA status for an authenticated admin", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: true });

    const res = await request(app)
      .get("/api/admin/2fa/status")
      .set("Authorization", `Bearer ${adminToken({ "2fa_verified": true })}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totp_enabled: true,
      verified: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/2fa/setup
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/2fa/setup", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await postWithCsrf("/api/admin/2fa/setup");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not an admin", async () => {
    const res = await postWithCsrf("/api/admin/2fa/setup", {
      token: userToken(),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when 2FA is already enabled", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });

    const res = await postWithCsrf("/api/admin/2fa/setup", {
      token: adminToken(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already enabled/i);
  });

  it("returns QR code and manual entry key on happy path", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] }) // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [] }); // UPDATE secret

    const res = await postWithCsrf("/api/admin/2fa/setup", {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qrCode).toBe("data:image/png;base64,FAKEQR");
    expect(res.body.data.manualEntryKey).toBe(FAKE_SECRET);
    expect(twoFactor.ensureAdminProfile).toHaveBeenCalledWith(ADMIN);
    expect(twoFactor.generateSecret).toHaveBeenCalledWith(ADMIN);
    expect(QRCode.toDataURL).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/2fa/verify
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/2fa/verify", () => {
  it("accepts a valid TOTP during setup and enables 2FA", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(), body: { token: "123456", setup: true },
    });
    expect(res.status).toBe(200);
    expect(twoFactor.enable2FA).toHaveBeenCalledWith(ADMIN, FAKE_SECRET, ["hash1", "hash2"]);
    expect(speakeasy.totp.verify).toHaveBeenCalledWith(expect.objectContaining({ window: 1 }));
  });

  it("accepts the previous 30-second window but not a code two windows old", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    speakeasy.totp.verify.mockReturnValueOnce(true);
    const accepted = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(), body: { token: "123456", setup: true },
    });
    expect(accepted.status).toBe(200);

    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    speakeasy.totp.verify.mockReturnValueOnce(false);
    const rejected = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(), body: { token: "123456", setup: true },
    });
    expect(rejected.status).toBe(400);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await postWithCsrf("/api/admin/2fa/verify", {
      body: { token: "123456" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the TOTP body token is missing or not 6 digits", async () => {
    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: "12" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6-digit/i);
  });

  it("returns 400 when setup was never initiated (not-found equivalent)", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(null);

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: "123456", setup: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setup not initiated/i);
  });

  it("enables 2FA and returns backup codes on first-time verify", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    speakeasy.totp.verify.mockReturnValue(true);

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: "123456", setup: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.data.backupCodes).toEqual(["AAAA", "BBBB"]);
    expect(twoFactor.enable2FA).toHaveBeenCalled();

    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.role).toBe("admin");
    expect(decoded["2fa_verified"]).toBe(true);
  });

  it("returns 400 when the TOTP code is invalid during setup", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    speakeasy.totp.verify.mockReturnValue(false);

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: "000000", setup: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid verification code/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/admin/2fa/disable
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/2fa/disable", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await postWithCsrf("/api/admin/2fa/disable", {
      body: { token: "123456" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither TOTP nor backup code is provided", async () => {
    const res = await postWithCsrf("/api/admin/2fa/disable", {
      token: adminToken(),
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/TOTP token or backup code/i);
  });

  it("disables 2FA when a valid TOTP token is provided", async () => {
    twoFactor.verify2FA.mockResolvedValue({ success: true });

    const res = await postWithCsrf("/api/admin/2fa/disable", {
      token: adminToken({ "2fa_verified": true }),
      body: { token: "123456" },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/disabled/i);
    expect(twoFactor.disable2FA).toHaveBeenCalledWith(ADMIN);
  });

  it("disables 2FA when a valid backup code is provided", async () => {
    twoFactor.verifyBackupCode.mockResolvedValue({ success: true });

    const res = await postWithCsrf("/api/admin/2fa/disable", {
      token: adminToken({ "2fa_verified": true }),
      body: { backupCode: "AAAA" },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(twoFactor.verifyBackupCode).toHaveBeenCalledWith(ADMIN, "AAAA");
    expect(twoFactor.disable2FA).toHaveBeenCalledWith(ADMIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Issue #1459: TOTP Validation Window (window: 1 vs window: 2)
// ─────────────────────────────────────────────────────────────────────────

describe("TOTP validation window tolerance (Issue #1459)", () => {
  const actualSpeakeasy = jest.requireActual("speakeasy");
  const testSecret = "JBSWY3DPEHPK3PXP";

  it("exports TOTP_WINDOW as 1", () => {
    expect(admin2faRoutes.TOTP_WINDOW).toBe(1);
  });

  it("code from 61 seconds ago is rejected with window: 1", () => {
    const now = Math.floor(Date.now() / 1000);
    const staleToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now - 61,
    });

    const verified = actualSpeakeasy.totp.verify({
      secret: testSecret,
      encoding: "base32",
      token: staleToken,
      time: now,
      window: 1,
    });

    expect(verified).toBe(false);
  });

  it("code from 61 seconds ago would have passed with window: 2 (demonstrating why window: 2 was too wide)", () => {
    const now = Math.floor(Date.now() / 1000);
    const staleToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now - 61,
    });

    const verifiedWithWindow2 = actualSpeakeasy.totp.verify({
      secret: testSecret,
      encoding: "base32",
      token: staleToken,
      time: now,
      window: 2,
    });

    expect(verifiedWithWindow2).toBe(true);
  });

  it("accepts a code generated at current time with window: 1", () => {
    const now = Math.floor(Date.now() / 1000);
    const currentToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now,
    });

    const verified = actualSpeakeasy.totp.verify({
      secret: testSecret,
      encoding: "base32",
      token: currentToken,
      time: now,
      window: 1,
    });

    expect(verified).toBe(true);
  });

  it("accepts a code from 30 seconds ago (1 step back) with window: 1", () => {
    const now = Math.floor(Date.now() / 1000);
    const priorStepToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now - 30,
    });

    const verified = actualSpeakeasy.totp.verify({
      secret: testSecret,
      encoding: "base32",
      token: priorStepToken,
      time: now,
      window: 1,
    });

    expect(verified).toBe(true);
  });

  it("rejects a code from 61 seconds in the future with window: 1", () => {
    const now = Math.floor(Date.now() / 1000);
    const futureToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now + 61,
    });

    const verified = actualSpeakeasy.totp.verify({
      secret: testSecret,
      encoding: "base32",
      token: futureToken,
      time: now,
      window: 1,
    });

    expect(verified).toBe(false);
  });

  it("POST /api/admin/2fa/verify passes window: 1 to speakeasy.totp.verify during setup", async () => {
    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(FAKE_SECRET);
    speakeasy.totp.verify.mockReturnValue(true);

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: "123456", setup: true },
    });

    expect(res.status).toBe(200);
    expect(speakeasy.totp.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: FAKE_SECRET,
        encoding: "base32",
        token: "123456",
        window: 1,
      }),
    );
  });

  it("POST /api/admin/2fa/verify rejects a code generated 61 seconds ago when using real TOTP verification", async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now - 61,
    });

    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(testSecret);

    speakeasy.totp.verify.mockImplementation((opts) =>
      actualSpeakeasy.totp.verify({ ...opts, time: now }),
    );

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: staleToken, setup: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid verification code/i);
    expect(twoFactor.enable2FA).not.toHaveBeenCalled();
  });

  it("POST /api/admin/2fa/verify accepts a current code when using real TOTP verification", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentToken = actualSpeakeasy.totp({
      secret: testSecret,
      encoding: "base32",
      time: now,
    });

    twoFactor.get2FAStatus.mockResolvedValue({ totp_enabled: false });
    twoFactor.getDecryptedSecret.mockResolvedValue(testSecret);

    speakeasy.totp.verify.mockImplementation((opts) =>
      actualSpeakeasy.totp.verify({ ...opts, time: now }),
    );

    const res = await postWithCsrf("/api/admin/2fa/verify", {
      token: adminToken(),
      body: { token: currentToken, setup: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(twoFactor.enable2FA).toHaveBeenCalled();
  });
});
