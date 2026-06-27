/**
 * src/services/progressService.js
 */
"use strict";

const pool = require("../db/pool");

async function addProgressUpdate({ jobId, authorAddress, updateText }) {
  if (!jobId || !authorAddress || !updateText) {
    const e = new Error("Missing required fields for progress update");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO progress_updates (job_id, author_address, update_text)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [jobId, authorAddress, updateText]
  );

  return rows[0];
}

async function getProgressUpdates(jobId) {
  const { rows } = await pool.query(
    `SELECT pu.*, p.display_name as author_name
     FROM progress_updates pu
     JOIN profiles p ON p.public_key = pu.author_address
     WHERE pu.job_id = $1
     ORDER BY pu.created_at DESC`,
    [jobId]
  );
  return rows;
}

module.exports = {
  addProgressUpdate,
  getProgressUpdates,
};
