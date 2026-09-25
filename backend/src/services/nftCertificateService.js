"use strict";

/**
 * backend/src/services/nftCertificateService.js
 *
 * Off-chain persistence for proof-of-work certificates (Issue: NFT
 * proof-of-work certificates). The on-chain Soroban contract stores the
 * `Certificate` (job_id, title, client, freelancer, amount, created_at) under
 * `DataKey::Certificate(job_id)`; this service keeps a relational mirror so
 * the platform can render certificates, list a freelancer's earned
 * certificates, and verify a certificate's mint transaction hash without
 * querying the chain for every page view.
 *
 * One certificate per job: `job_id` is UNIQUE.
 */

const crypto = require("crypto");
const pool = require("../db/pool");

const SELECT_BASE = `
  SELECT
    nc.id,
    nc.job_id,
    nc.freelancer_address,
    nc.client_address,
    nc.job_title,
    nc.amount_xlm,
    nc.completion_date,
    nc.tx_hash,
    nc.contract_id,
    nc.created_at,
    fp.display_name AS freelancer_name,
    cp.display_name AS client_name
  FROM nft_certificates nc
  LEFT JOIN profiles fp ON fp.public_key = nc.freelancer_address
  LEFT JOIN profiles cp ON cp.public_key = nc.client_address
`;

/**
 * Insert (or upsert, keyed on job_id) a certificate record.
 *
 * @param {object} params
 * @param {string} params.jobId             Backend job id
 * @param {string} params.freelancerAddress Stellar public key of the freelancer
 * @param {string} params.clientAddress     Stellar public key of the client
 * @param {string} params.jobTitle          Job title shown on the certificate
 * @param {string} [params.amountXlm]       Escrow amount in XLM
 * @param {string} [params.completionDate]  ISO timestamp of completion
 * @param {string} [params.txHash]          On-chain mint transaction hash
 * @param {string} [params.contractId]      Soroban contract id
 * @returns {Promise<object>}               The stored certificate row
 */
async function recordCertificate({
  jobId,
  freelancerAddress,
  clientAddress,
  jobTitle,
  amountXlm = null,
  completionDate = null,
  txHash = null,
  contractId = null,
}) {
  const id = `nft_${crypto.randomUUID()}`;
  const { rows } = await pool.query(
    `INSERT INTO nft_certificates
       (id, job_id, freelancer_address, client_address, job_title,
        amount_xlm, completion_date, tx_hash, contract_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (job_id) DO UPDATE SET
       freelancer_address = EXCLUDED.freelancer_address,
       client_address     = EXCLUDED.client_address,
       job_title          = EXCLUDED.job_title,
       amount_xlm         = EXCLUDED.amount_xlm,
       completion_date    = EXCLUDED.completion_date,
       tx_hash            = EXCLUDED.tx_hash,
       contract_id        = EXCLUDED.contract_id
     RETURNING *`,
    [
      id,
      jobId,
      freelancerAddress,
      clientAddress,
      jobTitle,
      amountXlm,
      completionDate,
      txHash,
      contractId,
    ],
  );
  return rows[0];
}

/**
 * Fetch the certificate for a job (with profile display names).
 * Returns `null` when the job has no certificate yet.
 */
async function getCertificateByJob(jobId) {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE nc.job_id = $1 LIMIT 1`,
    [jobId],
  );
  return rows[0] || null;
}

/**
 * List all certificates earned by a freelancer, newest first.
 */
async function getCertificatesForFreelancer(freelancerAddress) {
  const { rows } = await pool.query(
    `${SELECT_BASE}
     WHERE nc.freelancer_address = $1
     ORDER BY nc.created_at DESC`,
    [freelancerAddress],
  );
  return rows;
}

module.exports = {
  recordCertificate,
  getCertificateByJob,
  getCertificatesForFreelancer,
};
