/**
 * Job draft service for Issue #219: auto-save functionality
 */
"use strict";
const pool = require("../db/pool");

async function saveDraft(clientAddress, draftData) {
  const { id, title, description, budget, category, skills, currency, timezone, visibility, screeningQuestions, deadline } = draftData;

  if (id) {
    // One statement handles both the first autosave and subsequent updates.
    // The ownership predicate prevents a client from updating another user's
    // draft when a UUID collision is supplied.
    const query = `
      INSERT INTO job_drafts
      (id, client_address, title, description, budget, category, skills, currency, timezone, visibility, screening_questions, deadline)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, job_drafts.title),
        description = COALESCE(EXCLUDED.description, job_drafts.description),
        budget = COALESCE(EXCLUDED.budget, job_drafts.budget),
        category = COALESCE(EXCLUDED.category, job_drafts.category),
        skills = COALESCE(EXCLUDED.skills, job_drafts.skills),
        currency = COALESCE(EXCLUDED.currency, job_drafts.currency),
        timezone = COALESCE(EXCLUDED.timezone, job_drafts.timezone),
        visibility = COALESCE(EXCLUDED.visibility, job_drafts.visibility),
        screening_questions = COALESCE(EXCLUDED.screening_questions, job_drafts.screening_questions),
        deadline = COALESCE(EXCLUDED.deadline, job_drafts.deadline),
        updated_at = NOW()
      WHERE job_drafts.client_address = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, clientAddress, title, description, budget, category, skills || [], currency, timezone, visibility, screeningQuestions || [], deadline]);
    return result.rows[0];
  } else {
    // Create new draft without id
    const query = `
      INSERT INTO job_drafts
      (client_address, title, description, budget, category, skills, currency, timezone, visibility, screening_questions, deadline)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [clientAddress, title, description, budget, category, skills || [], currency, timezone, visibility, screeningQuestions || [], deadline];
    const result = await pool.query(query, values);
    return result.rows[0];
  }
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
