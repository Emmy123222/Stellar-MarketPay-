"use strict";

/**
 * src/services/twoFactorService.test.js
 *
 * Unit tests for twoFactorService (Issue #1459).
 * Verifies TOTP window tolerance (window: 1), rejecting codes older than 1 interval
 * (e.g., 61 seconds ago), secret generation, and backup codes.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const speakeasy = require("speakeasy");
const { encrypt } = require("../utils/encryption");
const {
  generateSecret,
  generateBackupCodes,
  verify2FA,
  get2FAStatus,
  disable2FA,
  TOTP_WINDOW,
} = require("./twoFactorService");

const TEST_ADMIN_ID = "G" + "A".repeat(55);

describe("twoFactorService (Issue #1459)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (typeof pool.reset === "function") pool.reset();
  });

  describe("TOTP_WINDOW constant", () => {
    it("is defined and set to 1", () => {
      expect(TOTP_WINDOW).toBe(1);
    });
  });

  describe("generateSecret and generateBackupCodes", () => {
    it("generates a valid base32 secret and otpauth url", () => {
      const secret = generateSecret(TEST_ADMIN_ID);
      expect(secret.base32).toBeDefined();
      expect(secret.base32.length).toBeGreaterThanOrEqual(16);
      expect(decodeURIComponent(secret.otpauth_url)).toContain(
        `StellarMarketPay:${TEST_ADMIN_ID}`,
      );
    });

    it("generates 8 plain and hashed backup codes", () => {
      const { plain, hashed } = generateBackupCodes();
      expect(plain).toHaveLength(8);
      expect(hashed).toHaveLength(8);
      expect(plain[0]).toMatch(/^[A-F0-9]{10}$/);
    });
  });

  describe("verify2FA with window tolerance (window: 1)", () => {
    it("rejects when 2FA is not enabled for the admin", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const res = await verify2FA(TEST_ADMIN_ID, "123456");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/2FA not enabled/i);
    });

    it("accepts a code generated for the current time step with window: 1", async () => {
      const secret = speakeasy.generateSecret().base32;
      const now = Math.floor(Date.now() / 1000);
      const currentToken = speakeasy.totp({
        secret,
        encoding: "base32",
        time: now,
      });

      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: TEST_ADMIN_ID,
              totp_secret: encrypt(secret),
              totp_enabled: true,
              totp_attempts: 0,
              totp_locked_until: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts = 0

      const res = await verify2FA(TEST_ADMIN_ID, currentToken);
      expect(res.success).toBe(true);
    });

    it("rejects a code from 61 seconds ago with window: 1", async () => {
      const secret = speakeasy.generateSecret().base32;
      const now = Math.floor(Date.now() / 1000);
      const staleToken = speakeasy.totp({
        secret,
        encoding: "base32",
        time: now - 61,
      });

      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: TEST_ADMIN_ID,
              totp_secret: encrypt(secret),
              totp_enabled: true,
              totp_attempts: 0,
              totp_locked_until: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts

      const res = await verify2FA(TEST_ADMIN_ID, staleToken);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/invalid 2fa code/i);
    });

    it("rejects when account is locked due to too many failed attempts", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TEST_ADMIN_ID,
            totp_secret: encrypt("FAKE"),
            totp_enabled: true,
            totp_attempts: 5,
            totp_locked_until: new Date(
              Date.now() + 10 * 60 * 1000,
            ).toISOString(),
          },
        ],
      });

      const res = await verify2FA(TEST_ADMIN_ID, "123456");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/account locked/i);
    });
  });

  describe("disable2FA and get2FAStatus", () => {
    it("disables 2FA by clearing secrets and backup codes", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await disable2FA(TEST_ADMIN_ID);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /UPDATE\s+admin_profiles[\s\S]+totp_enabled\s*=\s*false/,
        ),
        expect.arrayContaining([TEST_ADMIN_ID]),
      );
    });

    it("returns correct status from database", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ totp_enabled: true }],
      });
      const status = await get2FAStatus(TEST_ADMIN_ID);
      expect(status.totp_enabled).toBe(true);
    });
  });
});
