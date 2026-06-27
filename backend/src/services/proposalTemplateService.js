"use strict";

const pool = require("../db/pool");

const MAX_TEMPLATES_PER_FREELANCER = 10;

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function rowToTemplate(row) {
  return {
    id: row.id,
    freelancerAddress: row.freelancer_address,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listTemplates(freelancerAddress) {
  validatePublicKey(freelancerAddress);
  const { rows } = await pool.query(
    `SELECT * FROM proposal_templates
     WHERE freelancer_address = $1
     ORDER BY updated_at DESC`,
    [freelancerAddress]
  );
  return rows.map(rowToTemplate);
}

async function createTemplate({ freelancerAddress, name, content }) {
  validatePublicKey(freelancerAddress);
  if (!name || !name.trim() || !content || !content.trim()) {
    const e = new Error("Template name and content are required");
    e.status = 400;
    throw e;
  }

  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM proposal_templates WHERE freelancer_address = $1",
    [freelancerAddress]
  );
  if (countRows[0].count >= MAX_TEMPLATES_PER_FREELANCER) {
    const e = new Error("Maximum 10 templates allowed per freelancer");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO proposal_templates (freelancer_address, name, content, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [freelancerAddress, name.trim(), content.trim()]
  );
  return rowToTemplate(rows[0]);
}

async function updateTemplate({ id, freelancerAddress, name, content }) {
  validatePublicKey(freelancerAddress);
  const fields = [];
  const params = [id, freelancerAddress];
  if (typeof name === "string") {
    fields.push(`name = $${params.push(name.trim())}`);
  }
  if (typeof content === "string") {
    fields.push(`content = $${params.push(content.trim())}`);
  }
  if (!fields.length) {
    const e = new Error("At least one field is required to update template");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `UPDATE proposal_templates
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE id = $1 AND freelancer_address = $2
     RETURNING *`,
    params
  );
  if (!rows.length) {
    const e = new Error("Template not found");
    e.status = 404;
    throw e;
  }
  return rowToTemplate(rows[0]);
}

async function deleteTemplate(id, freelancerAddress) {
  validatePublicKey(freelancerAddress);
  const { rowCount } = await pool.query(
    "DELETE FROM proposal_templates WHERE id = $1 AND freelancer_address = $2",
    [id, freelancerAddress]
  );
  if (!rowCount) {
    const e = new Error("Template not found");
    e.status = 404;
    throw e;
  }
}

module.exports = {
  MAX_TEMPLATES_PER_FREELANCER,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
