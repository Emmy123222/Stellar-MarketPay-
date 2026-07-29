const pool = require("../db/pool");

const GUARDIAN_TIMEOUT_HOURS = 48;

async function setGuardian(jobId, guardianAddress, highValueThreshold) {
  try {
    const result = await pool.query(
      `UPDATE escrows
       SET guardian_address = $2,
           high_value_threshold = $3,
           release_timeout_at = NOW() + INTERVAL '${GUARDIAN_TIMEOUT_HOURS} hours'
       WHERE job_id = $1
       RETURNING *`,
      [jobId, guardianAddress, highValueThreshold]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error setting guardian:", err);
    throw err;
  }
}

async function approveRelease(jobId, guardianAddress) {
  try {
    const escrow = await pool.query(
      `SELECT * FROM escrows WHERE job_id = $1`,
      [jobId]
    );

    if (escrow.rows.length === 0) {
      const err = new Error("Escrow not found");
      err.status = 404;
      throw err;
    }

    const escrowData = escrow.rows[0];

    if (escrowData.guardian_address !== guardianAddress) {
      const err = new Error("Not authorized as guardian");
      err.status = 403;
      throw err;
    }

    const result = await pool.query(
      `UPDATE escrows
       SET guardian_approved = true,
           guardian_approved_at = NOW()
       WHERE job_id = $1
       RETURNING *`,
      [jobId]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error approving release:", err);
    throw err;
  }
}

async function canReleaseEscrow(jobId, releaserAddress) {
  try {
    const escrow = await pool.query(
      `SELECT e.*, j.client_address FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE e.job_id = $1`,
      [jobId]
    );

    if (escrow.rows.length === 0) {
      const err = new Error("Escrow not found");
      err.status = 404;
      throw err;
    }

    const e = escrow.rows[0];

    // Only client can release
    if (e.client_address !== releaserAddress) {
      return {
        canRelease: false,
        reason: "Only client can release escrow",
      };
    }

    // If no guardian, can always release
    if (!e.guardian_address) {
      return { canRelease: true };
    }

    // If high value and guardian not approved yet
    if (
      e.high_value_threshold &&
      e.amount_xlm > e.high_value_threshold &&
      !e.guardian_approved
    ) {
      // Check if timeout passed
      const now = new Date();
      const timeoutTime = new Date(e.release_timeout_at);
      if (now < timeoutTime) {
        return {
          canRelease: false,
          reason: "Awaiting guardian approval",
          timeoutAt: e.release_timeout_at,
        };
      }
      // Timeout passed, can release unilaterally
      return {
        canRelease: true,
        reason: "Guardian timeout exceeded, unilateral release allowed",
      };
    }

    return { canRelease: true };
  } catch (err) {
    console.error("Error checking release eligibility:", err);
    throw err;
  }
}

module.exports = {
  GUARDIAN_TIMEOUT_HOURS,
  setGuardian,
  approveRelease,
  canReleaseEscrow,
};
