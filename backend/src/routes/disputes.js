/**
 * src/routes/disputes.js
 * Dispute evidence upload/retrieval with IPFS storage (Issue #223)
 *
 * @swagger
 * tags:
 *   name: Disputes
 *   description: Dispute evidence and resolution
 */
"use strict";

const express    = require("express");
const router     = express.Router();
const multer     = require("multer");
const pool       = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT }         = require("../middleware/auth");
const s3Service            = require("../services/s3Service");
const { validateIpfsCid }    = require("../services/disputeService");
const sorobanEvidence       = require("../services/sorobanEvidence");
const { createError, ErrorCodes } = require("../utils/errors");

const MAX_FILES_PER_PARTY = 5;
const MAX_FILE_SIZE       = 10 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES  = new Set([
  "image/jpeg", "image/png", "image/gif", "video/mp4",
  "application/pdf",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error(`File type ${file.mimetype} is not allowed`), { status: 400 }));
  },
});

const readRateLimiter   = createRateLimiter(30, 1);
const uploadRateLimiter = createRateLimiter(5, 1);

/**
 * @swagger
 * /api/disputes/{jobId}/onchain-cids:
 *   get:
 *     summary: Get chain-attested evidence CID list
 *     tags: [Disputes]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: On-chain CIDs
 */
// GET /api/disputes/:jobId/onchain-cids
const readOnchainRateLimiter = createRateLimiter(15, 1);
router.get("/:jobId/onchain-cids", readOnchainRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { rows: jobRows } = await pool.query(
      "SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1",
      [jobId],
    );
    if (!jobRows.length) {
      throw createError(ErrorCodes.JOB_NOT_FOUND, "Job not found", 404);
    }
    // Visibility: same audience as the dispute itself (anyone can read).
    // Reserving the option to gate this further once SOROBAN_RPC is finalized.
    const cids = await sorobanEvidence.getOnchainEvidenceCids(jobId);
    res.json({ success: true, data: { jobId, cids } });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/disputes/{jobId}:
 *   get:
 *     summary: Get dispute details and evidence list
 *     tags: [Disputes]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Dispute detail with evidence list
 *       404:
 *         description: Job not found
 */
// GET /api/disputes/:jobId
router.get("/:jobId", readRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const { rows: jobRows } = await pool.query(
      `SELECT id, title, status, client_address, freelancer_address, created_at
       FROM jobs WHERE id = $1`,
      [jobId]
    );

    if (!jobRows.length) {
      throw createError(ErrorCodes.JOB_NOT_FOUND, "Job not found", 404);
    }

    const { rows: evidence } = await pool.query(
      `SELECT id, uploader_address, file_name, file_size, mime_type, ipfs_cid, created_at
       FROM dispute_evidence
       WHERE job_id = $1
       ORDER BY created_at ASC`,
      [jobId]
    );

    res.json({
      success: true,
      data: {
        job: jobRows[0],
        evidence: evidence.map((ev) => ({
          id:              ev.id,
          uploaderAddress: ev.uploader_address,
          fileName:        ev.file_name,
          fileSize:        ev.file_size,
          mimeType:        ev.mime_type,
          fileUrl:         ev.ipfs_cid,
          gatewayUrl:      s3Service.getGatewayUrl(ev.ipfs_cid),
          createdAt:       ev.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/disputes/{jobId}/evidence:
 *   post:
 *     summary: Upload dispute evidence file
 *     tags: [Disputes]
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
 *                 description: Evidence file (max 5 MB, images/PDF/text)
 *     responses:
 *       201:
 *         description: Evidence uploaded
 *       400:
 *         description: File limit reached or invalid file
 *       403:
 *         description: Only client or freelancer can upload
 */
// POST /api/disputes/:jobId/evidence
router.post(
  "/:jobId/evidence",
  verifyJWT,
  uploadRateLimiter,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const { jobId }          = req.params;
      const uploaderAddress    = req.user.publicKey;

      if (!req.file) {
        throw createError(ErrorCodes.BAD_REQUEST, "No file provided", 400);
      }

      const { rows: jobRows } = await pool.query(
        "SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1",
        [jobId]
      );

      if (!jobRows.length) {
        throw createError(ErrorCodes.JOB_NOT_FOUND, "Job not found", 404);
      }

      const job = jobRows[0];
      if (job.client_address !== uploaderAddress && job.freelancer_address !== uploaderAddress) {
        throw createError(ErrorCodes.FORBIDDEN, "Only the client or freelancer can upload evidence", 403);
      }

      const { rows: countRows } = await pool.query(
        "SELECT COUNT(*) FROM dispute_evidence WHERE job_id = $1 AND uploader_address = $2",
        [jobId, uploaderAddress]
      );

      if (parseInt(countRows[0].count, 10) >= MAX_FILES_PER_PARTY) {
        throw createError(ErrorCodes.EVIDENCE_LIMIT_REACHED, `Maximum ${MAX_FILES_PER_PARTY} files allowed per party`, 400);
      }

      let ipfsResult;
      try {
        ipfsResult = await s3Service.uploadFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype
        );
      } catch (ipfsError) {
        throw createError(
          ipfsError.code || ErrorCodes.IPFS_UPLOAD_FAILED,
          ipfsError.message || "Upload service temporarily unavailable. Please try again later.",
          ipfsError.status || 503
        );
      }

      const fileUrl = validateIpfsCid(ipfsResult?.cid);

      const { rows } = await pool.query(
        `INSERT INTO dispute_evidence
           (job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jobId, uploaderAddress, req.file.originalname, req.file.size, req.file.mimetype, fileUrl]
      );

      const ev = rows[0];
      res.status(201).json({
        success: true,
        data: {
          id:              ev.id,
          uploaderAddress: ev.uploader_address,
          fileName:        ev.file_name,
          fileSize:        ev.file_size,
          mimeType:        ev.mime_type,
          fileUrl:         ev.ipfs_cid,
          gatewayUrl:      s3Service.getGatewayUrl(ev.ipfs_cid),
          createdAt:       ev.created_at,
        },
      });
    } catch (e) { next(e); }
  }
);

/**
 * @swagger
 * /api/disputes/{jobId}/evidence/{id}/url:
 *   get:
 *     summary: Generate signed URL for evidence access
 *     tags: [Disputes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Signed proxy URL (valid 15 min)
 */
// GET /api/disputes/:jobId/evidence/:id/url — generate signed URL
router.get("/:jobId/evidence/:id/url", verifyJWT, readRateLimiter, async (req, res, next) => {
  try {
    const { jobId, id } = req.params;
    const requesterAddress = req.user.publicKey;

    // Verify requester is client or freelancer of this job
    const { rows: jobRows } = await pool.query(
      "SELECT client_address, freelancer_address FROM jobs WHERE id = $1",
      [jobId]
    );
    if (!jobRows.length) throw createError(ErrorCodes.JOB_NOT_FOUND, "Job not found", 404);

    const { client_address, freelancer_address } = jobRows[0];
    if (requesterAddress !== client_address && requesterAddress !== freelancer_address) {
      throw createError(ErrorCodes.FORBIDDEN, "Only the client or freelancer can access evidence URLs", 403);
    }

    // Fetch the evidence record
    const { rows: evRows } = await pool.query(
      "SELECT id, ipfs_cid, file_name, mime_type FROM dispute_evidence WHERE id = $1 AND job_id = $2",
      [id, jobId]
    );
    if (!evRows.length) throw createError(ErrorCodes.EVIDENCE_NOT_FOUND, "Evidence not found", 404);

    const evidence = evRows[0];

    // Generate signed token valid for 15 min
    const token = ipfsService.generateSignedUrlToken(evidence.ipfs_cid, jobId, requesterAddress);

    // Write audit log entry
    await pool.query(
      `INSERT INTO audit_log (action, resource_type, resource_id, actor_address, metadata)
       VALUES ('evidence_access', 'dispute_evidence', $1, $2, $3::jsonb)`,
      [id, requesterAddress, JSON.stringify({ jobId, cid: evidence.ipfs_cid })]
    ).catch(() => {}); // non-fatal if audit_log table schema differs

    const expiresAt = new Date(Date.now() + ipfsService.SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    res.json({
      success: true,
      data: {
        url:       `/api/disputes/${jobId}/evidence/${id}/proxy?token=${token}`,
        expiresAt,
        fileName:  evidence.file_name,
        mimeType:  evidence.mime_type,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/disputes/:jobId/evidence/:id/proxy — proxy IPFS file after verifying signed token (Issue #467)
router.get("/:jobId/evidence/:id/proxy", readRateLimiter, async (req, res, next) => {
  try {
    const { jobId, id } = req.params;
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      throw createError(ErrorCodes.SIGNED_URL_INVALID, "Missing token", 403);
    }

    // Verify token — throws SIGNED_URL_EXPIRED or SIGNED_URL_INVALID on failure
    const payload = ipfsService.verifySignedUrlToken(token);

    // Confirm the CID in the token matches the requested evidence record
    const { rows } = await pool.query(
      "SELECT ipfs_cid, file_name, mime_type FROM dispute_evidence WHERE id = $1 AND job_id = $2",
      [id, jobId]
    );
    if (!rows.length) throw createError(ErrorCodes.EVIDENCE_NOT_FOUND, "Evidence not found", 404);

    if (rows[0].ipfs_cid !== payload.cid) {
      throw createError(ErrorCodes.SIGNED_URL_INVALID, "Token does not match requested resource", 403);
    }

    // Stream file from IPFS gateway through backend
    const { stream, headers } = await ipfsService.proxyIpfsFile(rows[0].ipfs_cid);

    res.set("Content-Type", headers["content-type"] || rows[0].mime_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${rows[0].file_name}"`);
    res.set("Cache-Control", "no-store");

    stream.pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
