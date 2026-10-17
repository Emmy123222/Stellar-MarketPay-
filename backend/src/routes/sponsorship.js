/**
 * src/routes/sponsorship.js
 * Gas fee sponsorship API endpoints (Issue #1554)
 *
 * @swagger
 * tags:
 *   name: Sponsorship
 *   description: Gas fee sponsorship for verified onboarding freelancers
 */
"use strict";

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const sponsorshipService = require("../services/sponsorshipService");
const { createError, ErrorCodes } = require("../utils/errors");

const sponsorshipRateLimiter = createRateLimiter(20, 1);

function optionalAuth(req, res, next) {
  let token = null;
  if (req.cookies?.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (token && process.env.JWT_SECRET) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // ignore
    }
  }
  next();
}

/**
 * @swagger
 * /api/sponsorship/account:
 *   get:
 *     summary: Get platform sponsoring account public key
 *     tags: [Sponsorship]
 *     responses:
 *       200:
 *         description: Platform sponsoring account public key
 */
router.get("/account", (req, res) => {
  const publicKey = sponsorshipService.getSponsoringPublicKey();
  res.json({
    success: true,
    data: {
      sponsoringAccount: publicKey,
      publicKey,
    },
  });
});

/**
 * @swagger
 * /api/sponsorship/status:
 *   get:
 *     summary: Check eligibility and remaining sponsorship credits
 *     tags: [Sponsorship]
 *     responses:
 *       200:
 *         description: Eligibility status and credits
 */
router.get("/status", optionalAuth, async (req, res, next) => {
  try {
    const freelancerId =
      req.user?.publicKey ||
      req.query.freelancerId ||
      req.query.publicKey;

    if (!freelancerId) {
      return res.status(400).json({
        success: false,
        error: "Freelancer address is required (connect wallet or pass publicKey)",
      });
    }

    const eligibility = await sponsorshipService.checkEligibility(freelancerId);
    res.json({
      success: true,
      data: {
        freelancerId,
        ...eligibility,
        sponsorAccount: sponsorshipService.getSponsoringPublicKey(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/sponsorship/request:
 *   post:
 *     summary: Request gas fee sponsorship for a transaction
 *     tags: [Sponsorship]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - xdr
 *             properties:
 *               xdr:
 *                 type: string
 *                 description: Base64-encoded transaction XDR to be sponsored
 *               freelancerId:
 *                 type: string
 *                 description: Optional freelancer public key if unauthenticated
 *     responses:
 *       200:
 *         description: Sponsored transaction envelope
 *       400:
 *         description: Invalid XDR or missing parameters
 *       403:
 *         description: Not eligible or credits exhausted
 */
router.post("/request", sponsorshipRateLimiter, optionalAuth, async (req, res, next) => {
  try {
    const xdr = req.body?.xdr || req.body?.transactionXdr;
    const freelancerId =
      req.user?.publicKey ||
      req.body?.freelancerId ||
      req.body?.publicKey;

    if (!xdr) {
      throw createError(ErrorCodes.VALIDATION_ERROR, "Transaction XDR is required in 'xdr' field", 400);
    }

    if (!freelancerId) {
      throw createError(
        ErrorCodes.UNAUTHORIZED || "UNAUTHORIZED",
        "Freelancer address is required to check sponsorship eligibility",
        401
      );
    }

    const result = await sponsorshipService.sponsorTransaction(freelancerId, xdr);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
