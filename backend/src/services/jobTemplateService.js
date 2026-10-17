/**
 * src/services/jobTemplateService.js
 * Service for private client job templates (Issue #1556)
 */
"use strict";

const pool = require("../db/pool");
const { createError, ErrorCodes } = require("../utils/errors");

/**
 * Create a new job template for a client account.
 */
async function createJobTemplate(clientAddress, data) {
  if (!clientAddress) {
    throw createError(ErrorCodes.UNAUTHORIZED, "Client address is required", 401);
  }

  const {
    name,
    title,
    description = "",
    category = "Smart Contracts",
    budget = "50",
    currency = "XLM",
    skills = [],
    screeningQuestions = [],
    milestones = [],
    visibility = "public",
    isRecurring = false,
    intervalDays = "30",
    totalReleases = "12",
  } = data || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    throw createError(ErrorCodes.VALIDATION_ERROR, "Template name is required", 400);
  }

  if (!title || typeof title !== "string" || !title.trim()) {
    throw createError(ErrorCodes.VALIDATION_ERROR, "Job title is required", 400);
  }

  const skillsArray = Array.isArray(skills)
    ? skills
    : typeof skills === "string"
    ? skills.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const { rows } = await pool.query(
    `INSERT INTO job_templates (
      client_address,
      name,
      title,
      description,
      category,
      budget,
      currency,
      skills,
      screening_questions,
      milestones,
      visibility,
      is_recurring,
      interval_days,
      total_releases,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, NOW(), NOW())
    RETURNING
      id,
      client_address AS "clientAddress",
      name,
      title,
      description,
      category,
      budget,
      currency,
      skills,
      screening_questions AS "screeningQuestions",
      milestones,
      visibility,
      is_recurring AS "isRecurring",
      interval_days AS "intervalDays",
      total_releases AS "totalReleases",
      created_at AS "createdAt",
      updated_at AS "updatedAt"`,
    [
      clientAddress,
      name.trim(),
      title.trim(),
      description,
      category,
      budget,
      currency,
      skillsArray,
      JSON.stringify(screeningQuestions),
      JSON.stringify(milestones),
      visibility,
      Boolean(isRecurring),
      intervalDays,
      totalReleases,
    ]
  );

  return rows[0];
}

/**
 * List templates private to a specific client account.
 */
async function listJobTemplates(clientAddress) {
  if (!clientAddress) {
    throw createError(ErrorCodes.UNAUTHORIZED, "Client address is required", 401);
  }

  const { rows } = await pool.query(
    `SELECT
      id,
      client_address AS "clientAddress",
      name,
      title,
      description,
      category,
      budget,
      currency,
      skills,
      screening_questions AS "screeningQuestions",
      milestones,
      visibility,
      is_recurring AS "isRecurring",
      interval_days AS "intervalDays",
      total_releases AS "totalReleases",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM job_templates
    WHERE client_address = $1
    ORDER BY created_at DESC`,
    [clientAddress]
  );

  return rows;
}

/**
 * Get a specific template by ID, verifying client ownership.
 */
async function getJobTemplate(clientAddress, templateId) {
  if (!clientAddress) {
    throw createError(ErrorCodes.UNAUTHORIZED, "Client address is required", 401);
  }

  const { rows } = await pool.query(
    `SELECT
      id,
      client_address AS "clientAddress",
      name,
      title,
      description,
      category,
      budget,
      currency,
      skills,
      screening_questions AS "screeningQuestions",
      milestones,
      visibility,
      is_recurring AS "isRecurring",
      interval_days AS "intervalDays",
      total_releases AS "totalReleases",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM job_templates
    WHERE id = $1 AND client_address = $2`,
    [templateId, clientAddress]
  );

  if (rows.length === 0) {
    throw createError(ErrorCodes.NOT_FOUND, "Job template not found", 404);
  }

  return rows[0];
}

/**
 * Delete a template by ID, verifying client ownership.
 */
async function deleteJobTemplate(clientAddress, templateId) {
  if (!clientAddress) {
    throw createError(ErrorCodes.UNAUTHORIZED, "Client address is required", 401);
  }

  const { rowCount } = await pool.query(
    "DELETE FROM job_templates WHERE id = $1 AND client_address = $2",
    [templateId, clientAddress]
  );

  if (rowCount === 0) {
    throw createError(ErrorCodes.NOT_FOUND, "Job template not found", 404);
  }

  return { success: true };
}

module.exports = {
  createJobTemplate,
  listJobTemplates,
  getJobTemplate,
  deleteJobTemplate,
};
