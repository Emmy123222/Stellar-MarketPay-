/**
 * @swagger
 * tags:
 *   name: Proposal Templates
 *   description: Proposal template management for freelancers
 *
 * /api/proposal-templates:
 *   get:
 *     summary: List proposal templates for authenticated freelancer
 *     tags: [Proposal Templates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved
 *   post:
 *     summary: Create a proposal template
 *     tags: [Proposal Templates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - content
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Template created
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require("../services/proposalTemplateService");

router.get("/", verifyJWT, async (req, res, next) => {
  try {
    const templates = await listTemplates(req.user.publicKey);
    res.json({ success: true, data: templates });
  } catch (e) {
    next(e);
  }
});

router.post("/", verifyJWT, async (req, res, next) => {
  try {
    const template = await createTemplate({
      freelancerAddress: req.user.publicKey,
      name: req.body.name,
      content: req.body.content,
    });
    res.status(201).json({ success: true, data: template });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/proposal-templates/{id}:
 *   patch:
 *     summary: Update a proposal template
 *     tags: [Proposal Templates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Template updated
 *   delete:
 *     summary: Delete a proposal template
 *     tags: [Proposal Templates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template deleted
 */
router.patch("/:id", verifyJWT, async (req, res, next) => {
  try {
    const template = await updateTemplate({
      id: req.params.id,
      freelancerAddress: req.user.publicKey,
      name: req.body.name,
      content: req.body.content,
    });
    res.json({ success: true, data: template });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", verifyJWT, async (req, res, next) => {
  try {
    await deleteTemplate(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
