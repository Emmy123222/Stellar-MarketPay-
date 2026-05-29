/**
 * src/routes/certificates.js
 * Skill certificate endpoints.
 *
 * GET /api/certificates/:id         — get a certificate by ID
 * GET /api/certificates/user/:publicKey — get all certificates for a user
 */
"use strict";

const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");

// ─── GET /api/certificates/:id ──────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         sc.id,
         sc.public_key,
         sc.skill,
         sc.score,
         sc.certificate_hash,
         sc.ipfs_cid,
         sc.tx_hash,
         sc.issued_at,
         sc.created_at,
         p.display_name
       FROM skill_certificates sc
       LEFT JOIN profiles p ON p.public_key = sc.public_key
       WHERE sc.id = $1`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    const cert = rows[0];
    res.json({
      success: true,
      data: {
        id: cert.id,
        publicKey: cert.public_key,
        displayName: cert.display_name,
        skill: cert.skill,
        score: cert.score,
        certificateHash: cert.certificate_hash,
        ipfsCid: cert.ipfs_cid,
        txHash: cert.tx_hash,
        issuedAt: cert.issued_at,
        createdAt: cert.created_at,
        verifyUrl: `https://stellar.expert/explorer/testnet/search?q=${cert.certificate_hash}`,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/certificates/user/:publicKey ──────────────────────────────────
router.get("/user/:publicKey", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         sc.id,
         sc.public_key,
         sc.skill,
         sc.score,
         sc.certificate_hash,
         sc.ipfs_cid,
         sc.tx_hash,
         sc.issued_at,
         p.display_name
       FROM skill_certificates sc
       LEFT JOIN profiles p ON p.public_key = sc.public_key
       WHERE sc.public_key = $1
       ORDER BY sc.issued_at DESC`,
      [req.params.publicKey]
    );

    res.json({ success: true, data: rows.map(r => ({
      id: r.id,
      publicKey: r.public_key,
      displayName: r.display_name,
      skill: r.skill,
      score: r.score,
      certificateHash: r.certificate_hash,
      ipfsCid: r.ipfs_cid,
      txHash: r.tx_hash,
      issuedAt: r.issued_at,
      verifyUrl: `https://stellar.expert/explorer/testnet/search?q=${r.certificate_hash}`,
    })) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
