/**
 * src/routes/ping.js
 *
 * Lightweight liveness probe endpoint.
 *
 * GET /ping
 *   - Returns 200 with a minimal body. Deliberately free of any dependency
 *     checks (no database, no Redis, no external services) so the liveness
 *     probe never floods the database.
 */
"use strict";

const express = require("express");

const router = express.Router();

/**
 * Respond to a liveness probe with a minimal payload.
 */
router.get("/", (req, res) => {
  res.json({ status: "ok", uptime_seconds: Math.floor(process.uptime()) });
});

module.exports = router;
