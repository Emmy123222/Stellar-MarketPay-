/**
 * Job draft service for Issue #219: auto-save functionality
 */
"use strict";
const pool = require("../db/pool");

async function saveDraft(clientAddress, draftData) {
  const { id, title, description, budget, category, skills, currency, timezone, visibility, screeningQuestions, deadline } = draftData;

  let query, values;

  if (id) {
    // Update existing draft
    query = `
      UPDATE job_drafts
      SET title = $1, description = $2, budget = $3, category = $4, skills = $5,
          currency = $6, timezone = $7, visibility = $8, screening_questions = $9,
          deadline = $10, updated_at = NOW()
      WHERE id = $11 AND client_address = $12
      RETURNING *
    `;
    values = [title, description, budget, category, skills || [], currency, timezone, visibility, screeningQuestions || [], deadline, id, clientAddress];
  } else {
    // Create new draft
    query = `
      INSERT INTO job_drafts
      (client_address, title, description, budget, category, skills, currency, timezone, visibility, screening_questions, deadline)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    values = [clientAddress, title, description, budget, category, skills || [], currency, timezone, visibility, screeningQuestions || [], deadline];
  }

  const result = await pool.query(query, values);
  return result.rows[0];
}

async function getDrafts(clientAddress, limit = 5) {
  const query = `
    SELECT * FROM job_drafts
    WHERE client_address = $1
    ORDER BY updated_at DESC
    LIMIT $2
  `;
  const result = await pool.query(query, [clientAddress, limit]);
  return result.rows;
}

async function getDraft(draftId, clientAddress) {
  const query = `
    SELECT * FROM job_drafts
    WHERE id = $1 AND client_address = $2
  `;
  const result = await pool.query(query, [draftId, clientAddress]);
  return result.rows[0];
}

async function deleteDraft(draftId, clientAddress) {
  const query = `
    DELETE FROM job_drafts
    WHERE id = $1 AND client_address = $2
  `;
  await pool.query(query, [draftId, clientAddress]);
}

async function deleteExpiredDrafts() {
  const query = `
    DELETE FROM job_drafts
    WHERE updated_at < NOW() - INTERVAL '30 days'
  `;
  await pool.query(query);
}

module.exports = {
  saveDraft,
  getDrafts,
  getDraft,
  deleteDraft,
  deleteExpiredDrafts
};
