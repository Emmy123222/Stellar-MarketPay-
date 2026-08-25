/**
 * src/routes/rateLimit.js
 */
"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

// Generous rate limit for checking the rate limit status
const statusRateLimiter = createRateLimiter(200, 1);

/**
 * @swagger
 * /api/rate-limit:
 *   get:
 *     summary: Check current API rate limit status
 *     description: Returns the current rate limit usage for the caller's IP
 *     tags: [Utility]
 *     responses:
 *       200:
 *         description: Rate limit status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                     remaining:
 *                       type: integer
 *                     reset:
 *                       type: string
 *                       format: date-time
 */
router.get("/", statusRateLimiter, (req, res) => {
  // express-rate-limit attaches rate limit info to req.rateLimit
  const { limit, remaining, resetTime } = req.rateLimit || {};
  
  res.json({
    success: true,
    data: {
      limit: limit || 200,
      remaining: remaining || 199,
      reset: resetTime ? resetTime.toISOString() : new Date(Date.now() + 60000).toISOString()
    }
  });
});

module.exports = router;
