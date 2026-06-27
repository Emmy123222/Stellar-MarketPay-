"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} = require("../services/developerService");

function requireDeveloperWallet(req, res, next) {
  if (!req.user?.publicKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(verifyJWT, requireDeveloperWallet);

router.get("/keys", async (req, res, next) => {
  try {
    const keys = await listApiKeys(req.user.publicKey);
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
});

router.post("/keys", async (req, res, next) => {
  try {
    const { label } = req.body || {};
    const created = await createApiKey({
      ownerPublicKey: req.user.publicKey,
      label,
    });

    res.status(201).json({
      success: true,
      data: {
        id: created.key.id,
        label: created.key.label,
        keyPrefix: created.key.key_prefix,
        createdAt: created.key.created_at,
        apiKey: created.apiKey,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/keys/:id", async (req, res, next) => {
  try {
    const revoked = await revokeApiKey(req.user.publicKey, req.params.id);
    if (!revoked) {
      return res.status(404).json({ error: "API key not found" });
    }

    res.json({ success: true, message: "API key revoked" });
  } catch (error) {
    next(error);
  }
});

router.post("/keys/:id/rotate", async (req, res, next) => {
  try {
    const result = await rotateApiKey(req.user.publicKey, req.params.id);
    if (!result) {
      return res.status(404).json({ error: "API key not found or already rotating" });
    }

    res.status(200).json({
      success: true,
      data: {
        id: result.key.id,
        label: result.key.label,
        createdAt: result.key.created_at,
        rotatingAt: result.key.rotating_at,
        apiKey: result.apiKey,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
