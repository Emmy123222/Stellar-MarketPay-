/**
 * src/routes/jobTemplates.js
 * API routes for client job templates (Issue #1556)
 *
 * @swagger
 * tags:
 *   name: JobTemplates
 *   description: Private job templates library for clients
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const jobTemplateService = require("../services/jobTemplateService");
const { createError, ErrorCodes } = require("../utils/errors");

const templateRateLimiter = createRateLimiter(30, 1);

// Helper to extract client address from token or query/body in mock/testing environments
function getClientAddress(req) {
  return req.user?.publicKey || req.headers["x-client-address"] || req.query.clientAddress || req.body?.clientAddress;
}

/**
 * @swagger
 * /api/job-templates:
 *   get:
 *     summary: List private job templates for the authenticated client
 *     tags: [JobTemplates]
 *     responses:
 *       200:
 *         description: List of job templates
 *       401:
 *         description: Unauthorized
 */
router.get("/", templateRateLimiter, async (req, res, next) => {
  try {
    const clientAddress = getClientAddress(req);
    if (!clientAddress) {
      throw createError(ErrorCodes.UNAUTHORIZED, "Authentication required to view job templates", 401);
    }

    const templates = await jobTemplateService.listJobTemplates(clientAddress);
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/job-templates:
 *   post:
 *     summary: Save a job configuration as a reusable private template
 *     tags: [JobTemplates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - title
 *             properties:
 *               name:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               budget:
 *                 type: string
 *               currency:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Created job template
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", templateRateLimiter, async (req, res, next) => {
  try {
    const clientAddress = getClientAddress(req);
    if (!clientAddress) {
      throw createError(ErrorCodes.UNAUTHORIZED, "Authentication required to save job templates", 401);
    }

    const template = await jobTemplateService.createJobTemplate(clientAddress, req.body);
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/job-templates/{id}:
 *   get:
 *     summary: Get a specific job template
 *     tags: [JobTemplates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job template
 *       404:
 *         description: Template not found
 */
router.get("/:id", templateRateLimiter, async (req, res, next) => {
  try {
    const clientAddress = getClientAddress(req);
    if (!clientAddress) {
      throw createError(ErrorCodes.UNAUTHORIZED, "Authentication required", 401);
    }

    const template = await jobTemplateService.getJobTemplate(clientAddress, req.params.id);
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/job-templates/{id}:
 *   delete:
 *     summary: Delete a private job template
 *     tags: [JobTemplates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template deleted
 *       404:
 *         description: Template not found
 */
router.delete("/:id", templateRateLimiter, async (req, res, next) => {
  try {
    const clientAddress = getClientAddress(req);
    if (!clientAddress) {
      throw createError(ErrorCodes.UNAUTHORIZED, "Authentication required", 401);
    }

    await jobTemplateService.deleteJobTemplate(clientAddress, req.params.id);
    res.json({ success: true, message: "Template deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
