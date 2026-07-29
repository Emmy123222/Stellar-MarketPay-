/**
 * src/routes/auth.js
 */
"use strict";
const express = require("express");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
const { ensureAdminProfile, get2FAStatus } = require("../services/twoFactorService");
const pool = require("../db/pool");
const {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
} = require("../services/authTokens");
const { generateCsrfToken } = require("../middleware/csrf");

const router = express.Router();

let cachedServerKeypair = null;
function getServerKeypair() {
  if (!cachedServerKeypair) {
    const serverPrivateKey = process.env.SERVER_PRIVATE_KEY || Keypair.random().secret();
    cachedServerKeypair = Keypair.fromSecret(serverPrivateKey);
  }
  return cachedServerKeypair;
}

const HOME_DOMAIN = process.env.HOME_DOMAIN || "localhost:4000";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function resolvePassphrase(network) {
  return network === "mainnet" ? MAINNET_PASSPHRASE : TESTNET_PASSPHRASE;
}

/**
 * @swagger
 * /api/auth/csrf-token:
 *   get:
 *     summary: Issue a CSRF token for double-submit protection
 *     description: |
 *       Generates a fresh CSRF token, sets it as a non-HttpOnly `csrf-token`
 *       cookie, and returns it in the response body. The frontend Axios
 *       instance attaches this token in the `X-CSRF-Token` header on every
 *       subsequent state-mutating request (`POST`, `PUT`, `PATCH`, `DELETE`).
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: CSRF token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 csrfToken:
 *                   type: string
 *                   description: Token the client must echo in `X-CSRF-Token`
 */
router.get("/csrf-token", (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
});

/**
 * @swagger
 * /api/auth:
 *   get:
 *     summary: Get authentication challenge transaction
 *     description: Returns a Stellar challenge transaction for web authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: account
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar account address to challenge
 *     responses:
 *       200:
 *         description: Challenge transaction generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: string
 *                   description: Base64-encoded Stellar transaction
 *       400:
 *         description: Bad request - missing account or invalid format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/", (req, res) => {
  try {
    const accountId = req.query.account;
    if (!accountId) {
      return res.status(400).json({ error: "Missing account parameter" });
    }
    const network = req.query.network === "mainnet" ? "mainnet" : "testnet";
    const networkPassphrase = resolvePassphrase(network);

    const serverKeypair = getServerKeypair();
    const challenge = Utils.buildChallengeTx(
      serverKeypair,
      accountId,
      HOME_DOMAIN,
      300, // 5 minutes timeout
      networkPassphrase
    );

    res.json({ transaction: challenge, network });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/auth:
 *   post:
 *     summary: Authenticate with signed challenge transaction
 *     description: Verifies a signed Stellar challenge transaction and issues a JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transaction
 *             properties:
 *               transaction:
 *                 type: string
 *                 description: Base64-encoded signed Stellar transaction
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *       400:
 *         description: Bad request - missing transaction or invalid format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid signature or expired challenge
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/", async (req, res) => {
  try {
    const { transaction, network: reqNetwork } = req.body;
    if (!transaction) {
      return res.status(400).json({ error: "Missing transaction in request body" });
    }
    const network = reqNetwork === "mainnet" ? "mainnet" : "testnet";
    const networkPassphrase = resolvePassphrase(network);

    const serverKeypair = getServerKeypair();
    const accountId = Utils.verifyChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      networkPassphrase,
      HOME_DOMAIN,
      ""
    );

    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const isAdmin = adminAddresses.includes(accountId);

    const payload = { publicKey: accountId, network };
    if (isAdmin) {
      await ensureAdminProfile(accountId);
      payload.role = "admin";
      const status = await get2FAStatus(accountId);
      payload["2fa_verified"] = !status.totp_enabled;
    }

    // Stamp last_login_at so the weekly digest knows this user is active.
    // Uses ON CONFLICT to handle the case where the profile row may not yet
    // exist (it will be created by profileService on first access).
    try {
      await pool.query(
        `UPDATE profiles SET last_login_at = NOW() WHERE public_key = $1`,
        [accountId]
      );
    } catch (stampErr) {
      // Non-fatal: log and continue issuing the token
      console.warn("[auth] Could not stamp last_login_at:", stampErr.message);
    }

    const { accessToken, refreshToken, csrfToken } = issueTokenPair(payload);
    setAuthCookies(res, accessToken, refreshToken, csrfToken);
    res.json({ success: true, token: accessToken, csrfToken });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

router.post("/refresh", (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  const rotated = rotateRefreshToken(refreshToken);

  if (!rotated) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Unauthorized: Invalid refresh token" });
  }

  setAuthCookies(res, rotated.accessToken, rotated.refreshToken, rotated.csrfToken);
  return res.json({ success: true, token: rotated.accessToken, csrfToken: rotated.csrfToken });
});

router.post("/logout", (req, res) => {
  revokeRefreshToken(getRefreshTokenFromRequest(req));
  clearAuthCookies(res);
  res.json({ success: true });
});

module.exports = router;
