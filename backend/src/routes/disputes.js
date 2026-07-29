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
const sorobanEvidence       = require("../services/sorobanEvidence");
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

// GET /api/disputes/:jobId/onchain-cids  — read the chain-attested CID list
//
// Issue #448 — AC #5: frontend dispute page reads CIDs from chain. This
// endpoint delegates to `sorobanEvidence.getOnchainEvidenceCids` which reads
// the Vec<Bytes> at DataKey::EvidenceCids via the contract's
// get_evidence_cids view function.
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

// GET /api/disputes/:jobId/evidence/:id/url — generate signed URL (Issue #467)
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
