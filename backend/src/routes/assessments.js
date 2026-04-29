/**
 * src/routes/assessments.js
 * Skill assessment endpoints.
 *
 * GET  /api/assessments/:skill          — get questions (options only, no answers)
 * POST /api/assessments/:skill/submit   — submit answers, record result
 * GET  /api/assessments/results/:publicKey — get all results for a user
 */
"use strict";

const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const questions = require("../data/skillQuestions.json");

const PASS_SCORE   = 70;   // percent
const COOLDOWN_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── GET /api/assessments/:skill ─────────────────────────────────────────────
// Returns questions without answers. Also returns last attempt info if authed.
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

// ─── POST /api/assessments/:skill/submit ─────────────────────────────────────
// Body: { answers: { [questionId]: selectedOptionIndex } }
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

    res.json({ success: true, data: { skill, score, passed, correct, total: bank.questions.length } });
  } catch (e) { next(e); }
});

// ─── GET /api/assessments/results/:publicKey ─────────────────────────────────
// Public — returns verified (passed) badges for a profile
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
