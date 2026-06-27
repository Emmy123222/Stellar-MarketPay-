/**
 * Job draft service for Issue #219: auto-save functionality
 */
"use strict";
const pool = require("../db/pool");

async function saveDraft(clientAddress, draftData) {
  const { id, title, description, budget, category, skills, currency, timezone, visibility, screeningQuestions, deadline } = draftData;

  if (id) {
    // Check if draft exists
    const existingResult = await pool.query(
      "SELECT * FROM job_drafts WHERE id = $1 AND client_address = $2",
      [id, clientAddress]
    );

    if (existingResult.rows.length > 0) {
      // Partial update - only set fields that are provided
      const setClauses = [];
      const values = [];
      let idx = 1;

      if (title !== undefined) { setClauses.push(`title = $${idx}`); values.push(title); idx++; }
      if (description !== undefined) { setClauses.push(`description = $${idx}`); values.push(description); idx++; }
      if (budget !== undefined) { setClauses.push(`budget = $${idx}`); values.push(budget); idx++; }
      if (category !== undefined) { setClauses.push(`category = $${idx}`); values.push(category); idx++; }
      if (skills !== undefined) { setClauses.push(`skills = $${idx}`); values.push(skills || []); idx++; }
      if (currency !== undefined) { setClauses.push(`currency = $${idx}`); values.push(currency); idx++; }
      if (timezone !== undefined) { setClauses.push(`timezone = $${idx}`); values.push(timezone); idx++; }
      if (visibility !== undefined) { setClauses.push(`visibility = $${idx}`); values.push(visibility); idx++; }
      if (screeningQuestions !== undefined) { setClauses.push(`screening_questions = $${idx}`); values.push(screeningQuestions || []); idx++; }
      if (deadline !== undefined) { setClauses.push(`deadline = $${idx}`); values.push(deadline); idx++; }

      values.push(id, clientAddress);
      const query = `
        UPDATE job_drafts
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE id = $${idx} AND client_address = $${idx + 1}
        RETURNING *
      `;
      const result = await pool.query(query, values);
      return result.rows[0];
    } else {
      // Draft doesn't exist - create with provided id (upsert behavior)
      const query = `
        INSERT INTO job_drafts
        (id, client_address, title, description, budget, category, skills, currency, timezone, visibility, screening_questions, deadline)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;
      const result = await pool.query(query, [id, clientAddress, title, description, budget, category, skills || [], currency, timezone, visibility, screeningQuestions || [], deadline]);
      return result.rows[0];
    }
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
