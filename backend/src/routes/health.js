/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const healthCheckRateLimiter = createRateLimiter(30, 1); // 100 requests per minute

const router  = express.Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the current health status of the API service
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                   description: Health status
 *                 service:
 *                   type: string
 *                   example: stellar-marketpay-api
 *                   description: Service name
 *                 network:
 *                   type: string
 *                   example: testnet
 *                   description: Stellar network being used
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current timestamp
 *                 indexer:
 *                   type: object
 *                   nullable: true
 *                   description: Indexer service health status
 */
router.get("/", healthCheckRateLimiter ,(req, res) => res.json({
  status: "ok", service: "stellar-marketpay-api",
  network: process.env.STELLAR_NETWORK || "testnet",
  timestamp: new Date().toISOString(),
  indexer: req.app.locals.indexerService ? req.app.locals.indexerService.getHealth() : null,
}));

module.exports = router;
