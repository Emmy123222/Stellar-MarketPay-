/**
 * src/routes/disputes.js
 * Dispute evidence upload/retrieval with IPFS storage (Issue #223)
 *
 * GET  /api/disputes/:jobId          — dispute detail + evidence list
 * POST /api/disputes/:jobId/evidence — upload one evidence file (multipart/form-data)
 *
 * Constraints:
 *   - Max 10 files per party (client or freelancer)
 *   - Max 5 MB per file
 *   - Allowed MIME types: images, PDF, plain text
 *   - Only job client or freelancer can upload; anyone can read (admin visibility)
 */
"use strict";

const express    = require("express");
const router     = express.Router();
const multer     = require("multer");
const pool       = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT }         = require("../middleware/auth");
const ipfsService            = require("../services/ipfsService");
const { validateIpfsCid }    = require("../services/disputeService");
const { createError, ErrorCodes } = require("../utils/errors");

const MAX_FILES_PER_PARTY = 10;
const MAX_FILE_SIZE       = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES  = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "text/plain",
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
          ipfsCid:         ev.ipfs_cid,
          gatewayUrl:      ipfsService.getGatewayUrl(ev.ipfs_cid),
          createdAt:       ev.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

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
        ipfsResult = await ipfsService.uploadFile(
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

      const ipfsCid = validateIpfsCid(ipfsResult?.cid);

      const { rows } = await pool.query(
        `INSERT INTO dispute_evidence
           (job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jobId, uploaderAddress, req.file.originalname, req.file.size, req.file.mimetype, ipfsCid]
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
          ipfsCid:         ev.ipfs_cid,
          gatewayUrl:      ipfsService.getGatewayUrl(ev.ipfs_cid),
          createdAt:       ev.created_at,
        },
      });
    } catch (e) { next(e); }
  }
);

module.exports = router;
