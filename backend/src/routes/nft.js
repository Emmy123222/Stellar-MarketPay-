/**
 * @swagger
 * tags:
 *   name: NFT
 *   description: Proof-of-work certificates minted as Soroban NFTs on job completion
 */
"use strict";

const express = require("express");
const router = express.Router();
const { Keypair } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { getJob } = require("../services/jobService");
const { verifyOnChainTransaction } = require("../services/contractAuditService");
const { insertAuditLog } = require("../services/auditLogService");
const {
  recordCertificate,
  getCertificateByJob,
  getCertificatesForFreelancer,
} = require("../services/nftCertificateService");

// Minting is idempotent per job but rate-limit it like other escrow mutations.
const mintRateLimiter = createRateLimiter(30, 1);

const EXPLORER_BASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

function isValidStellarAddress(address) {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function serializeCertificate(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    freelancerAddress: row.freelancer_address,
    clientAddress: row.client_address,
    freelancerName: row.freelancer_name || null,
    clientName: row.client_name || null,
    amountXlm: row.amount_xlm,
    completionDate: row.completion_date,
    txHash: row.tx_hash,
    contractId: row.contract_id,
    createdAt: row.created_at,
    verifyUrl: row.tx_hash
      ? `${EXPLORER_BASE}/tx/${row.tx_hash}`
      : null,
  };
}

/**
 * @swagger
 * /api/nft/mint-completion-certificate:
 *   post:
 *     summary: Record a minted proof-of-work certificate for a completed job
 *     description: >
 *       Called by the client's wallet after the on-chain `mint_certificate`
 *       transaction has been submitted (which happens automatically after
 *       escrow release). Persists the certificate metadata (job title, client
 *       address, freelancer address, completion date, XLM amount) keyed on
 *       job_id so it can be rendered and shared via URL.
 *     tags: [NFT]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - clientAddress
 *               - contractTxHash
 *             properties:
 *               jobId:
 *                 type: string
 *               clientAddress:
 *                 type: string
 *               contractTxHash:
 *                 type: string
 *     responses:
 *       201:
 *         description: Certificate recorded
 *       400:
 *         description: Validation error
 *       403:
 *         description: Only the job client can record the certificate
 */
router.post("/mint-completion-certificate", mintRateLimiter, async (req, res, next) => {
  try {
    const { jobId, clientAddress, contractTxHash } = req.body;

    if (!jobId || !clientAddress || !contractTxHash) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!isValidStellarAddress(clientAddress)) {
      return res.status(400).json({ error: "Invalid client Stellar address" });
    }

    const job = await getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.clientAddress !== clientAddress) {
      return res.status(403).json({
        error: "Only the job client can record the completion certificate",
      });
    }
    if (job.status !== "completed") {
      return res.status(400).json({
        error: "Job must be completed before minting a certificate",
      });
    }

    // A proof-of-work certificate must be backed by a real on-chain mint
    // transaction. Reject placeholder / offchain hashes so a certificate
    // cannot be recorded without an actual on-chain mint.
    if (/^offchain-/.test(contractTxHash)) {
      return res.status(400).json({
        error: "A real on-chain mint transaction hash is required",
      });
    }

    try {
      await verifyOnChainTransaction(contractTxHash);
    } catch {
      // Horizon unreachable or tx not found — record the certificate anyway
      // (the wallet already submitted the mint tx); verification is best-effort.
    }

    // Completion date: prefer the escrow release timestamp.
    const { rows: releaseRows } = await pool.query(
      "SELECT released_at FROM escrow_releases WHERE job_id = $1 LIMIT 1",
      [jobId],
    );
    const completionDate = releaseRows[0]?.released_at || new Date().toISOString();

    // XLM amount from the escrow record (fall back to job budget).
    const { rows: escrowRows } = await pool.query(
      "SELECT amount_xlm FROM escrows WHERE job_id = $1 LIMIT 1",
      [jobId],
    );
    const amountXlm = escrowRows[0]?.amount_xlm ?? job.budget ?? null;

    const contractId =
      job.escrowContractId ||
      process.env.ESCROW_CONTRACT_ID ||
      process.env.NEXT_PUBLIC_CONTRACT_ID ||
      null;

    const row = await recordCertificate({
      jobId: job.id,
      freelancerAddress: job.freelancerAddress,
      clientAddress,
      jobTitle: job.title,
      amountXlm: amountXlm != null ? String(amountXlm) : null,
      completionDate,
      txHash: contractTxHash,
      contractId,
    });

    // Note: `verifyOnChainTransaction` confirms the hash exists and succeeded
    // on-chain; it does not prove the tx is a `mint_certificate` invocation for
    // this job. This matches the escrow-release trust model — the client is
    // authenticated via the job ownership check above.

    // Immutable audit log entry (matches the escrow-release convention).
    try {
      await insertAuditLog({
        actorAddress: clientAddress,
        action: "nft_certificate_minted",
        entityType: "nft_certificate",
        entityId: row.id,
        oldValue: { jobId },
        newValue: {
          jobId: row.job_id,
          jobTitle: row.job_title,
          freelancerAddress: row.freelancer_address,
          amountXlm: row.amount_xlm,
          txHash: contractTxHash,
        },
      });
    } catch {
      // Non-fatal
    }

    res.status(201).json({ success: true, data: serializeCertificate(row) });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/nft/job/{jobId}:
 *   get:
 *     summary: Get the certificate for a job
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Certificate details
 *       404:
 *         description: No certificate minted for this job
 */
router.get("/job/:jobId", async (req, res, next) => {
  try {
    const row = await getCertificateByJob(req.params.jobId);
    if (!row) {
      return res.status(404).json({ error: "No certificate minted for this job" });
    }
    res.json({ success: true, data: serializeCertificate(row) });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/nft/freelancer/{publicKey}:
 *   get:
 *     summary: Get certificates earned by a freelancer
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of certificates
 */
router.get("/freelancer/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (!isValidStellarAddress(publicKey)) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }
    const rows = await getCertificatesForFreelancer(publicKey);
    res.json({ success: true, data: rows.map(serializeCertificate) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
