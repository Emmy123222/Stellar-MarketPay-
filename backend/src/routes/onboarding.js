"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

router.patch("/", async (req, res, next) => {
  try {
    const { publicKey, currentStep = 0, completedSteps = [], dismissed = false, completed = false } = req.body || {};
    if (!publicKey || typeof publicKey !== "string") {
      return res.status(400).json({ success: false, error: "publicKey is required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO onboarding_progress (public_key, current_step, completed_steps, dismissed, completed, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
       ON CONFLICT (public_key) DO UPDATE SET
         current_step = EXCLUDED.current_step,
         completed_steps = EXCLUDED.completed_steps,
         dismissed = EXCLUDED.dismissed,
         completed = EXCLUDED.completed,
         updated_at = NOW()
       RETURNING public_key, current_step, completed_steps, dismissed, completed, updated_at`,
      [publicKey, Number(currentStep) || 0, JSON.stringify(completedSteps), Boolean(dismissed), Boolean(completed)],
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:publicKey", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT public_key, current_step, completed_steps, dismissed, completed, updated_at
       FROM onboarding_progress WHERE public_key = $1`,
      [req.params.publicKey],
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (e) { next(e); }
});

module.exports = router;
