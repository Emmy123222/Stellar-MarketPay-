/**
 * Tests for stellarServiceKey.js — Issue #536
 * Verifies service keypair loading, IP validation, and signing behaviour.
 */
"use strict";

// Reset module between tests so the cached keypair doesn't bleed across
beforeEach(() => {
  jest.resetModules();
  delete process.env.STELLAR_SERVICE_SECRET;
  delete process.env.STELLAR_SERVICE_ALLOWED_IPS;
});

describe("loadServiceKeypair", () => {
  test("throws when STELLAR_SERVICE_SECRET is not set", () => {
    const { loadServiceKeypair } = require("./stellarServiceKey");
    expect(() => loadServiceKeypair()).toThrow("STELLAR_SERVICE_SECRET");
  });

  test("throws when STELLAR_SERVICE_SECRET is an invalid key", () => {
    process.env.STELLAR_SERVICE_SECRET = "not-a-valid-stellar-secret";
    const { loadServiceKeypair } = require("./stellarServiceKey");
    expect(() => loadServiceKeypair()).toThrow("Invalid service secret key");
  });

  test("returns a valid Keypair when secret is correct", () => {
    // Use a known valid Stellar secret key (test/dev only — never production)
    process.env.STELLAR_SERVICE_SECRET =
      "SCZANGBA5RLBRQD6VGZPBVBFN4XFZJVKUCYNUG6SDXPN64CAQHG5GQX";
    const { loadServiceKeypair } = require("./stellarServiceKey");
    const kp = loadServiceKeypair();
    expect(kp).toBeDefined();
    expect(typeof kp.publicKey()).toBe("string");
    expect(kp.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
  });
});

describe("signWithServiceKey", () => {
  const VALID_SECRET =
    "SCZANGBA5RLBRQD6VGZPBVBFN4XFZJVKUCYNUG6SDXPN64CAQHG5GQX";

  test("calls signFn with the keypair when IP is allowed", async () => {
    process.env.STELLAR_SERVICE_SECRET = VALID_SECRET;
    const { signWithServiceKey } = require("./stellarServiceKey");
    const signFn = jest.fn().mockResolvedValue("signed");
    const result = await signWithServiceKey("127.0.0.1", signFn);
    expect(signFn).toHaveBeenCalledTimes(1);
    expect(result).toBe("signed");
  });

  test("throws 403 when request IP is not in the allowed list", async () => {
    process.env.STELLAR_SERVICE_SECRET = VALID_SECRET;
    process.env.STELLAR_SERVICE_ALLOWED_IPS = "10.0.0.1,10.0.0.2";
    const { signWithServiceKey } = require("./stellarServiceKey");
    const signFn = jest.fn();
    await expect(signWithServiceKey("192.168.1.100", signFn)).rejects.toMatchObject({
      status: 403,
    });
    expect(signFn).not.toHaveBeenCalled();
  });

  test("contract call fails if service keypair secret is wrong", async () => {
    process.env.STELLAR_SERVICE_SECRET = "not-a-real-stellar-key-at-all-xxx";
    // loadServiceKeypair is called lazily inside signWithServiceKey
    const { signWithServiceKey } = require("./stellarServiceKey");
    await expect(signWithServiceKey("127.0.0.1", jest.fn())).rejects.toThrow(
      "Invalid service secret key"
    );
  });
});

describe("verifyServiceKey", () => {
  test("returns true for the public key matching the loaded keypair", () => {
    process.env.STELLAR_SERVICE_SECRET =
      "SCZANGBA5RLBRQD6VGZPBVBFN4XFZJVKUCYNUG6SDXPN64CAQHG5GQX";
    const { verifyServiceKey, getServicePublicKey } = require("./stellarServiceKey");
    const pubKey = getServicePublicKey();
    expect(verifyServiceKey(pubKey)).toBe(true);
  });

  test("returns false for a different public key", () => {
    process.env.STELLAR_SERVICE_SECRET =
      "SCZANGBA5RLBRQD6VGZPBVBFN4XFZJVKUCYNUG6SDXPN64CAQHG5GQX";
    const { verifyServiceKey } = require("./stellarServiceKey");
    expect(verifyServiceKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(false);
  });
});
