/**
 * src/routes/messageRoutes.js
 * Private messaging endpoints for job participants.
 *
 * @swagger
 * tags:
 *   name: Messages
 *   description: In-app messaging between users
 */

"use strict";
const express = require("express");
const multer  = require("multer");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const messageService = require("../services/messageService");
const { uploadFile, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } = require("../services/ipfsService");
const generalRateLimiter = createRateLimiter(60, 1); // 60 req/min for message operations

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    // Accept encrypted blobs (octet-stream) and known MIME types
    cb(null, file.mimetype === "application/octet-stream" || ALLOWED_MIME_TYPES.includes(file.mimetype));
  },
});

/**
 * @swagger
 * /api/messages/job/{jobId}:
 *   post:
 *     summary: Send a message in a job thread
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Message content (encrypted)
 *               contractTxHash:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message sent
 *   get:
 *     summary: Get messages for a job thread
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Message list (marks as read)
 */
router.post("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { content, contractTxHash } = req.body;
    const senderAddress = req.user.publicKey;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ success: false, error: "Message content is required" });
    }

    const message = await messageService.createMessage({
      jobId,
      senderAddress,
      content: content.trim(),
      contractTxHash: contractTxHash || null,
    });

    res.status(201).json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

router.get("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userAddress = req.user.publicKey;

    const messages = await messageService.getMessagesByJob(jobId, userAddress);
    res.json({ success: true, data: messages });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/unread-count:
 *   get:
 *     summary: Get total unread message count
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get("/unread-count", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const userAddress = req.user.publicKey;
    const count = await messageService.getUnreadCount(userAddress);
    res.json({ success: true, data: { unreadCount: count } });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/{messageId}/tx-hash:
 *   patch:
 *     summary: Attach on-chain tx hash to a message
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *             properties:
 *               txHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tx hash attached
 */
router.patch("/:messageId/tx-hash", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { txHash } = req.body;

    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ success: false, error: "txHash is required" });
    }

    const message = await messageService.attachTxHash(messageId, txHash);
    res.json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/job/{jobId}/attachments:
 *   post:
 *     summary: Upload an encrypted file attachment
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               senderNaclPub:
 *                 type: string
 *     responses:
 *       201:
 *         description: Attachment uploaded to IPFS
 */
router.post("/job/:jobId/attachments", verifyJWT, generalRateLimiter, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "File is required" });
    const { jobId } = req.params;
    const senderAddress = req.user.publicKey;
    const senderNaclPub = req.body.senderNaclPub || null;

    const uploaded = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    const message = await messageService.createFileAttachment({
      jobId,
      senderAddress,
      cid:          uploaded.cid,
      fileName:     req.file.originalname,
      fileSize:     uploaded.size,
      fileMime:     req.file.mimetype,
      senderNaclPub,
    });
    res.status(201).json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
