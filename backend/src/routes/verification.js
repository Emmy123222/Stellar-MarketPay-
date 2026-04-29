const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { createRateLimiter } = require("../middleware/rateLimiter");

const verificationRateLimiter = createRateLimiter(5, 1);

// In-memory store for verification tokens (use database in production)
const verificationTokens = new Map();
const verifications = new Map();

// Send email verification link
router.post("/email", verificationRateLimiter, async (req, res, next) => {
  try {
    const { email, publicKey } = req.body;
    if (!email || !publicKey) {
      return res.status(400).json({ error: "Email and publicKey required" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    verificationTokens.set(token, { email, publicKey, expiresAt, type: "email" });

    // In production: send email with verification link
    const verificationLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify?token=${token}`;
    console.log(`Email verification link: ${verificationLink}`);

    res.json({ success: true, message: "Verification email sent" });
  } catch (error) {
    next(error);
  }
});

// Verify email with token
router.post("/email/confirm", async (req, res, next) => {
  try {
    const { token } = req.body;
    const verification = verificationTokens.get(token);

    if (!verification || verification.expiresAt < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (verification.type !== "email") {
      return res.status(400).json({ error: "Invalid verification type" });
    }

    verifications.set(verification.publicKey, {
      emailVerified: true,
      phoneVerified: false,
      idVerified: false,
      email: verification.email,
      verifiedAt: new Date(),
    });

    verificationTokens.delete(token);

    res.json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    next(error);
  }
});

// Send phone verification OTP
router.post("/phone", verificationRateLimiter, async (req, res, next) => {
  try {
    const { phone, publicKey } = req.body;
    if (!phone || !publicKey) {
      return res.status(400).json({ error: "Phone and publicKey required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    verificationTokens.set(otp, { phone, publicKey, expiresAt, type: "phone" });

    // In production: send SMS via Twilio or similar
    console.log(`Phone verification OTP for ${phone}: ${otp}`);

    res.json({ success: true, message: "OTP sent to phone" });
  } catch (error) {
    next(error);
  }
});

// Verify phone OTP
router.post("/phone/confirm", async (req, res, next) => {
  try {
    const { otp, publicKey } = req.body;
    const verification = verificationTokens.get(otp);

    if (!verification || verification.expiresAt < Date.now() || verification.publicKey !== publicKey) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const user = verifications.get(publicKey) || {};
    verifications.set(publicKey, { ...user, phoneVerified: true, phone: verification.phone });

    verificationTokens.delete(otp);

    res.json({ success: true, message: "Phone verified successfully" });
  } catch (error) {
    next(error);
  }
});

// Submit ID verification (admin review required)
router.post("/id/submit", verificationRateLimiter, async (req, res, next) => {
  try {
    const { publicKey, idType, idNumber, fullName } = req.body;
    if (!publicKey || !idType || !idNumber || !fullName) {
      return res.status(400).json({ error: "All fields required" });
    }

    const user = verifications.get(publicKey) || {};
    verifications.set(publicKey, {
      ...user,
      idSubmitted: true,
      idVerified: false,
      idType,
      idNumber,
      fullName,
      idSubmittedAt: new Date(),
    });

    res.json({ success: true, message: "ID submitted for review" });
  } catch (error) {
    next(error);
  }
});

// Get verification status for a user
router.get("/:publicKey", async (req, res, next) => {
  try {
    const user = verifications.get(req.params.publicKey) || {
      emailVerified: false,
      phoneVerified: false,
      idVerified: false,
    };

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
