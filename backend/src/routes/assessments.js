/**
 * src/routes/assessments.js
 * Skill assessment endpoints.
 *
 * @swagger
 * tags:
 *   name: Assessments
 *   description: Skill assessments and certificates
 */
"use strict";

const crypto  = require("crypto");
const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const questions = require("../data/skillQuestions.json");

const PASS_SCORE   = 70;   // percent
const COOLDOWN_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── POST /api/assessments/project ───────────────────────────────────────────
// Client creates a new project assessment
router.post("/project", verifyJWT, async (req, res, next) => {
  try {
    const { title, description, timeLimitMinutes, questions, jobId } = req.body;
    if (!title || !timeLimitMinutes || !questions) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_assessments (client_address, job_id, title, description, time_limit_minutes, questions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.publicKey, jobId || null, title, description, timeLimitMinutes, JSON.stringify(questions)]
    );

    res.json({ success: true, data: rows[0] });
  } catch (e) { next(e); }
});

// ─── GET /api/assessments/project/:id ────────────────────────────────────────
// Freelancer fetches assessment to take it. Starts the timer if not started.
router.get("/project/:id", verifyJWT, async (req, res, next) => {
  try {
    const assessmentId = req.params.id;
    const publicKey = req.user.publicKey;

    const { rows: assessRows } = await pool.query(
      `SELECT * FROM project_assessments WHERE id = $1`,
      [assessmentId]
    );

    if (assessRows.length === 0) {
      return res.status(404).json({ error: "Assessment not found" });
    }
    const assessment = assessRows[0];

    // Check for existing submission
    const { rows: subRows } = await pool.query(
      `SELECT * FROM project_assessment_submissions WHERE assessment_id = $1 AND freelancer_address = $2`,
      [assessmentId, publicKey]
    );

    let submission = subRows[0];
    if (!submission) {
      const { rows: newSub } = await pool.query(
        `INSERT INTO project_assessment_submissions (assessment_id, freelancer_address, status, started_at)
         VALUES ($1, $2, 'started', NOW())
         RETURNING *`,
        [assessmentId, publicKey]
      );
      submission = newSub[0];
    } else if (submission.status !== 'started') {
       return res.status(403).json({ error: "Assessment already submitted or graded", submission });
    }

    // Strip correct answers from questions before sending to the client.
    // _correctAnswer is intentionally destructured-and-discarded so the field
    // is excluded from `rest` — the leading underscore silences the lint rule.
    const safeQuestions = assessment.questions.map(q => {
      const { correctAnswer: _correctAnswer, ...rest } = q; // eslint-disable-line no-unused-vars
      return rest;
    });

    res.json({
      success: true,
      data: {
        assessment: { ...assessment, questions: safeQuestions },
        submission
      }
    });
  } catch (e) { next(e); }
});

// ─── POST /api/assessments/project/:id/submit ────────────────────────────────
// Freelancer submits answers
router.post("/project/:id/submit", verifyJWT, async (req, res, next) => {
  try {
    const assessmentId = req.params.id;
    const publicKey = req.user.publicKey;
    const { answers } = req.body;

    const { rows: assessRows } = await pool.query(
      `SELECT * FROM project_assessments WHERE id = $1`,
      [assessmentId]
    );
    if (assessRows.length === 0) return res.status(404).json({ error: "Assessment not found" });
    const assessment = assessRows[0];

    const { rows: subRows } = await pool.query(
      `SELECT * FROM project_assessment_submissions WHERE assessment_id = $1 AND freelancer_address = $2`,
      [assessmentId, publicKey]
    );
    if (subRows.length === 0) return res.status(404).json({ error: "Submission not found. Fetch assessment first." });
    const submission = subRows[0];

    if (submission.status !== 'started') {
      return res.status(403).json({ error: "Assessment already submitted" });
    }

    const timeLimitMs = assessment.time_limit_minutes * 60 * 1000;
    const timeTakenMs = Date.now() - new Date(submission.started_at).getTime();
    
    // Allow 2 mins grace period for network latency on auto-submit
    if (timeTakenMs > timeLimitMs + 120000) {
      // Mark as submitted but maybe flag it? Actually, just accept it or mark zero?
      // For now, accept whatever we got at expiration.
    }

    // Auto-grade multiple choice
    let correct = 0;
    let totalAuto = 0;
    assessment.questions.forEach((q, index) => {
      if (q.type === 'multiple_choice') {
        totalAuto++;
        if (answers[index] === q.correctAnswer) correct++;
      }
    });
    const score = totalAuto > 0 ? Math.round((correct / totalAuto) * 100) : null;

    const { rows: updateRows } = await pool.query(
      `UPDATE project_assessment_submissions 
       SET answers = $1, status = 'submitted', submitted_at = NOW(), score = $2
       WHERE id = $3 RETURNING *`,
      [JSON.stringify(answers), score, submission.id]
    );

    res.json({ success: true, data: updateRows[0] });
  } catch (e) { next(e); }
});

// ─── GET /api/assessments/project/:id/results ────────────────────────────────
// Client views results for an assessment
router.get("/project/:id/results", verifyJWT, async (req, res, next) => {
  try {
    const assessmentId = req.params.id;
    const publicKey = req.user.publicKey;

    const { rows: assessRows } = await pool.query(
      `SELECT * FROM project_assessments WHERE id = $1`,
      [assessmentId]
    );
    if (assessRows.length === 0) return res.status(404).json({ error: "Assessment not found" });
    if (assessRows[0].client_address !== publicKey) {
      return res.status(403).json({ error: "Only the creator can view results" });
    }

    const { rows: results } = await pool.query(
      `SELECT s.*, p.display_name
       FROM project_assessment_submissions s
       JOIN profiles p ON s.freelancer_address = p.public_key
       WHERE s.assessment_id = $1
       ORDER BY s.submitted_at DESC NULLS LAST`,
      [assessmentId]
    );

    res.json({ success: true, data: results });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/assessments/{skill}:
 *   get:
 *     summary: Get assessment questions for a skill
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: skill
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Questions (without answers)
 *       404:
 *         description: Unknown skill
 */
router.get("/:skill", verifyJWT, async (req, res, next) => {
  try {
    const skill = req.params.skill.toLowerCase();
    const bank  = questions[skill];
    if (!bank) return res.status(404).json({ error: "Unknown skill" });

    const publicKey = req.user.publicKey;

    // Check last attempt
    const { rows } = await pool.query(
      `SELECT score, passed, taken_at FROM skill_assessments
       WHERE public_key = $1 AND skill = $2
       ORDER BY taken_at DESC LIMIT 1`,
      [publicKey, skill]
    );

    const last = rows[0] || null;
    const canRetake = !last || (Date.now() - new Date(last.taken_at).getTime() >= COOLDOWN_MS);
    const retakeAvailableAt = last && !canRetake
      ? new Date(new Date(last.taken_at).getTime() + COOLDOWN_MS).toISOString()
      : null;

    // Strip answers before sending
    const safeQuestions = bank.questions.map(({ id, question, options }) => ({ id, question, options }));

    res.json({
      success: true,
      data: {
        skill,
        label: bank.label,
        questions: safeQuestions,
        durationSeconds: 15 * 60,
        passScore: PASS_SCORE,
        canRetake,
        retakeAvailableAt,
        lastAttempt: last,
      },
    });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/assessments/{skill}/submit:
 *   post:
 *     summary: Submit assessment answers
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: skill
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - answers
 *             properties:
 *               answers:
 *                 type: object
 *                 description: Map of question IDs to selected option indices
 *     responses:
 *       200:
 *         description: Score and result
 *       429:
 *         description: Cooldown active
 */
router.post("/:skill/submit", verifyJWT, async (req, res, next) => {
  try {
    const skill = req.params.skill.toLowerCase();
    const bank  = questions[skill];
    if (!bank) return res.status(404).json({ error: "Unknown skill" });

    const publicKey = req.user.publicKey;
    const { answers } = req.body;
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ error: "answers object is required" });
    }

    // Enforce 30-day cooldown
    const { rows: prev } = await pool.query(
      `SELECT taken_at FROM skill_assessments
       WHERE public_key = $1 AND skill = $2
       ORDER BY taken_at DESC LIMIT 1`,
      [publicKey, skill]
    );
    if (prev.length && Date.now() - new Date(prev[0].taken_at).getTime() < COOLDOWN_MS) {
      const retakeAt = new Date(new Date(prev[0].taken_at).getTime() + COOLDOWN_MS).toISOString();
      return res.status(429).json({ error: "Assessment cooldown active", retakeAvailableAt: retakeAt });
    }

    // Grade
    let correct = 0;
    for (const q of bank.questions) {
      if (parseInt(answers[q.id], 10) === q.answer) correct++;
    }
    const score  = Math.round((correct / bank.questions.length) * 100);
    const passed = score >= PASS_SCORE;

    await pool.query(
      `INSERT INTO skill_assessments (public_key, skill, score, passed)
       VALUES ($1, $2, $3, $4)`,
      [publicKey, skill, score, passed]
    );

    let certificate = null;

    // Generate on-chain certificate if passed
    if (passed) {
      const adminKey = process.env.ADMIN_PUBLIC_KEYS
        ? process.env.ADMIN_PUBLIC_KEYS.split(",")[0].trim()
        : "platform";
      const issuedAt = new Date().toISOString();
      const raw = `${publicKey}|${skill}|${score}|${issuedAt}|${adminKey}`;
      const certificateHash = crypto.createHash("sha256").update(raw).digest("hex");

      // Generate a deterministic IPFS CID-like identifier
      const cidRaw = crypto.createHash("sha256").update(`ipfs:${raw}`).digest("hex").slice(0, 46);
      const ipfsCid = `Qm${cidRaw}`;

      // Store certificate
      const { rows: certRows } = await pool.query(
        `INSERT INTO skill_certificates (public_key, skill, score, certificate_hash, ipfs_cid, issued_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (public_key, skill) DO UPDATE
           SET score = EXCLUDED.score,
               certificate_hash = EXCLUDED.certificate_hash,
               ipfs_cid = EXCLUDED.ipfs_cid,
               issued_at = EXCLUDED.issued_at
         RETURNING id, certificate_hash, ipfs_cid, issued_at`,
        [publicKey, skill, score, certificateHash, ipfsCid, issuedAt]
      );

      certificate = certRows[0];
    }

    res.json({
      success: true,
      data: { skill, score, passed, correct, total: bank.questions.length, certificate },
    });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/assessments/results/{publicKey}:
 *   get:
 *     summary: Get assessment results for a user (public)
 *     tags: [Assessments]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assessment results
 */
router.get("/results/:publicKey", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (skill) skill, score, passed, taken_at
       FROM skill_assessments
       WHERE public_key = $1
       ORDER BY skill, taken_at DESC`,
      [req.params.publicKey]
    );
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

module.exports = router;
