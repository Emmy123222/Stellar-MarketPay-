/**
 * @swagger
 * tags:
 *   name: Developer
 *   description: API key management for developers
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { apiKeyRateLimiter } = require("../middleware/apiKeyRateLimiter");
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

/**
 * @swagger
 * /api/developer/keys:
 *   get:
 *     summary: List API keys
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: API keys listed
 *   post:
 *     summary: Create a new API key
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *     responses:
 *       201:
 *         description: API key created (full key shown once)
 */
router.get("/keys", apiKeyRateLimiter("dev_keys_list"), async (req, res, next) => {
  try {
    const keys = await listApiKeys(req.user.publicKey);
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
});

router.post("/keys", apiKeyRateLimiter("dev_keys_create"), async (req, res, next) => {
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

/**
 * @swagger
 * /api/developer/keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key revoked
 *       404:
 *         description: Key not found
 */
router.delete(
  "/keys/:id",
  apiKeyRateLimiter("dev_key_revoke"),
  async (req, res, next) => {
    try {
      const revoked = await revokeApiKey(req.user.publicKey, req.params.id);
      if (!revoked) {
        return res.status(404).json({ error: "API key not found" });
      }

      res.json({ success: true, message: "API key revoked" });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/developer/keys/{id}/rotate:
 *   post:
 *     summary: Rotate an API key
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key rotated (new key shown once)
 *       404:
 *         description: Key not found or already rotating
 */
router.post(
  "/keys/:id/rotate",
  apiKeyRateLimiter("dev_key_rotate"),
  async (req, res, next) => {
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
  },
);

module.exports = router;
