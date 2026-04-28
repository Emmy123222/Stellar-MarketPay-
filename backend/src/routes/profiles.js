/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

const profileUpdateRateLimiter = createRateLimiter(5, 1); // 5 profile updates per minute
const generalProfileRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for getting profiles

const { getProfile, upsertProfile, updateAvailability } = require("../services/profileService");
const { uploadFile, getGatewayUrl } = require("../services/ipfsService");
const {
  upsertPriceAlertPreference,
  getPriceAlertPreference,
} = require("../services/priceAlertService");
const multer = require("multer");

// Configure multer for memory storage (files will be uploaded to IPFS, not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png", 
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

router.get("/:publicKey", generalProfileRateLimiter ,async (req, res, next) => {
  try { res.json({ success: true, data: await getProfile(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.post("/", profileUpdateRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await upsertProfile(req.body) }); }
  catch (e) { next(e); }
});

router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, req.body),
    });
  }
  catch (e) { next(e); }
});

router.post("/:publicKey/verify", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { verifyIdentity } = require("../services/profileService");
    res.json({
      success: true,
      data: await verifyIdentity(req.params.publicKey, req.body.didHash),
    });
  }
  catch (e) { next(e); }
});

router.get("/:publicKey/price-alerts", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const pref = await getPriceAlertPreference(req.params.publicKey);
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/price-alerts", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const pref = await upsertPriceAlertPreference({
      freelancerAddress: req.params.publicKey,
      minXlmPriceUsd: req.body.minXlmPriceUsd,
      maxXlmPriceUsd: req.body.maxXlmPriceUsd,
      emailNotificationsEnabled: req.body.emailNotificationsEnabled,
      email: req.body.email,
    });
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

// IPFS file upload route
router.post("/:publicKey/upload-files", profileUpdateRateLimiter, upload.array("files", 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: "No files provided" });
    }

    const uploadedFiles = [];
    
    for (const file of req.files) {
      const result = await uploadFile(file.buffer, file.originalname, file.mimetype);
      uploadedFiles.push(result);
    }

    res.json({ 
      success: true, 
      data: {
        uploadedFiles,
        gatewayUrls: uploadedFiles.map(f => getGatewayUrl(f.cid))
      }
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
