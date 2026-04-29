"use strict";

const pool = require("../db/pool");

function validatePublicKey(key) {
  return Boolean(key && /^G[A-Z0-9]{55}$/.test(key));
}

async function inviteFreelancerToJob({ jobId, clientAddress, freelancerAddress }) {
  if (!validatePublicKey(clientAddress) || !validatePublicKey(freelancerAddress)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== clientAddress) {
    const e = new Error("Only the job client can invite freelancers");
    e.status = 403;
    throw e;
  }
  if (job.visibility !== "invite_only") {
    const e = new Error("Invitations are only available for invite-only jobs");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO job_invitations (job_id, client_address, freelancer_address, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (job_id, freelancer_address)
     DO UPDATE SET created_at = NOW()
     RETURNING *`,
    [jobId, clientAddress, freelancerAddress]
  );
  return rows[0];
}

module.exports = {
  inviteFreelancerToJob,
};
