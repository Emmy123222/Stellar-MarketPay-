/**
 * src/routes/auth.js
 */
"use strict";
const express = require("express");
const jwt = require("jsonwebtoken");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
const { JWT_SECRET } = require("../middleware/auth");

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
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === "mainnet" 
  ? "Public Global Stellar Network ; September 2015" 
  : "Test SDF Network ; September 2015";

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

    const serverKeypair = getServerKeypair();
    const challenge = Utils.buildChallengeTx(
      serverKeypair,
      accountId,
      HOME_DOMAIN,
      300, // 5 minutes timeout
      NETWORK_PASSPHRASE
    );

    res.json({ transaction: challenge });
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
router.post("/", (req, res) => {
  try {
    const { transaction } = req.body;
    if (!transaction) {
      return res.status(400).json({ error: "Missing transaction in request body" });
    }

    const serverKeypair = getServerKeypair();
    const accountId = Utils.verifyChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      "" // webAuthEndpoint is optional or typically HOME_DOMAIN if not specified differently
    );

    const token = jwt.sign({ publicKey: accountId }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, token });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

module.exports = router;
