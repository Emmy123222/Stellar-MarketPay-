/**
 * src/routes/webauthn.js
 * WebAuthn / Passkey authentication routes (Issue #218)
 *
 * Registration flow:
 *   POST /api/webauthn/register-options  → get options (requires JWT)
 *   POST /api/webauthn/register-verify   → verify & store credential (requires JWT)
 *
 * Authentication flow:
 *   POST /api/webauthn/login-options     → get options (public)
 *   POST /api/webauthn/login-verify      → verify & issue JWT (public)
 *
 * Credential management:
 *   GET    /api/webauthn/credentials     → list passkeys (requires JWT)
 *   DELETE /api/webauthn/credentials/:id → remove passkey (requires JWT)
 */
"use strict";

const express  = require("express");
const router   = express.Router();
const pool     = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT, requireAdminRole, requireAdmin2FA } = require("../middleware/auth");
const { issueTokenPair, setAuthCookies } = require("../services/authTokens");
const {
  assertCanRegisterCredential,
  recordRegistrationAttempt,
  registerCredential,
  listCredentials,
  removeCredential,
  adminListCredentials,
  adminRevokeCredential,
} = require("../services/webauthnService");

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const RP_ID   = process.env.WEBAUTHN_RP_ID   || "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME  || "Stellar MarketPay";
const ORIGIN  = process.env.WEBAUTHN_ORIGIN   || "http://localhost:3000";

// Temporary in-memory challenge store (TTL 5 minutes)
const challengeStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of challengeStore) {
    if (v.createdAt < cutoff) challengeStore.delete(k);
  }
}, 60 * 1000).unref();

const webauthnRateLimiter = createRateLimiter(10, 1);

// ─── Registration ──────────────────────────────────────────────────────────────

router.post("/register-options", verifyJWT, webauthnRateLimiter, async (req, res, next) => {
  try {
    const publicKey = req.user.publicKey;
    await assertCanRegisterCredential(publicKey);

    const { rows: existing } = await pool.query(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
      [publicKey]
    );

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(publicKey),
      userName: publicKey.slice(0, 8) + "…" + publicKey.slice(-4),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credential_id,
        type: "public-key",
        transports: c.transports || [],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    challengeStore.set(`reg:${publicKey}`, { challenge: options.challenge, createdAt: Date.now() });
    res.json({ success: true, data: options });
  } catch (e) { next(e); }
});

router.post("/register-verify", verifyJWT, webauthnRateLimiter, async (req, res, next) => {
  try {
    const publicKey = req.user.publicKey;
    const { credential, name } = req.body;
    await assertCanRegisterCredential(publicKey);
    recordRegistrationAttempt(publicKey);

    const stored = challengeStore.get(`reg:${publicKey}`);
    if (!stored) {
      const e = new Error("No pending registration challenge. Please try again.");
      e.status = 400;
      throw e;
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      const e = new Error("Passkey registration verification failed");
      e.status = 400;
      throw e;
    }

    challengeStore.delete(`reg:${publicKey}`);

    const { credential: cred } = verification.registrationInfo;
    await registerCredential({
      publicKey,
      credentialId: Buffer.from(cred.id).toString("base64url"),
      credentialName: (name || "Passkey").slice(0, 64),
      publicKeyCose: Buffer.from(cred.publicKey).toString("base64"),
      counter: cred.counter,
      transports: credential.response?.transports || [],
    });

    res.json({ success: true, message: "Passkey registered successfully" });
  } catch (e) { next(e); }
});

// ─── Authentication ─────────────────────────────────────────────────────────────

router.post("/login-options", webauthnRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }

    const { rows: credentials } = await pool.query(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
      [publicKey]
    );

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map((c) => ({
        id: c.credential_id,
        type: "public-key",
        transports: c.transports || [],
      })),
      userVerification: "preferred",
    });

    challengeStore.set(`auth:${publicKey}`, { challenge: options.challenge, createdAt: Date.now() });
    res.json({ success: true, data: options });
  } catch (e) { next(e); }
});

router.post("/login-verify", webauthnRateLimiter, async (req, res, next) => {
  try {
    const { credential, publicKey } = req.body;
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }

    const stored = challengeStore.get(`auth:${publicKey}`);
    if (!stored) {
      const e = new Error("No pending authentication challenge. Please try again.");
      e.status = 400;
      throw e;
    }

    const credentialId = credential.id;
    const { rows } = await pool.query(
      "SELECT * FROM webauthn_credentials WHERE credential_id = $1 AND public_key = $2",
      [credentialId, publicKey]
    );

    if (!rows.length) {
      const e = new Error("Passkey not found for this account");
      e.status = 404;
      throw e;
    }

    const storedCred = rows[0];
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: storedCred.credential_id,
        publicKey: Buffer.from(storedCred.public_key_cose, "base64"),
        counter: Number(storedCred.counter),
        transports: storedCred.transports,
      },
    });

    if (!verification.verified) {
      const e = new Error("Passkey authentication failed");
      e.status = 401;
      throw e;
    }

    challengeStore.delete(`auth:${publicKey}`);

    await pool.query(
      "UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2",
      [verification.authenticationInfo.newCounter, credentialId]
    );

    const { accessToken, refreshToken } = issueTokenPair({ publicKey });
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ success: true, token: accessToken });
  } catch (e) { next(e); }
});

// ─── Credential management ─────────────────────────────────────────────────────

router.get("/credentials", verifyJWT, async (req, res, next) => {
  try {
    const rows = await listCredentials(req.user.publicKey);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

router.delete("/credentials/:id", verifyJWT, async (req, res, next) => {
  try {
    await removeCredential({ id: req.params.id, publicKey: req.user.publicKey });
    res.json({ success: true, message: "Passkey removed" });
  } catch (e) { next(e); }
});

router.get("/admin/credentials", verifyJWT, requireAdminRole, requireAdmin2FA, async (req, res, next) => {
  try {
    const rows = await adminListCredentials(req.query.publicKey);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

router.delete("/admin/credentials/:id", verifyJWT, requireAdminRole, requireAdmin2FA, async (req, res, next) => {
  try {
    const credential = await adminRevokeCredential(req.params.id);
    res.json({ success: true, message: "Passkey revoked", data: credential });
  } catch (e) { next(e); }
});

module.exports = router;
