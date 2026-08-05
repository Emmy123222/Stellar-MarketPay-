/**
 * src/routes/ratings.js
 *
 * @swagger
 * tags:
 *   name: Ratings
 *   description: User rating and review system
 */
"use strict";

const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { createRating, getRatingsForUser } = require("../services/ratingService");
const { verifyJWT } = require("../middleware/auth");

/**
 * @swagger
 * /api/ratings:
 *   post:
 *     summary: Submit a rating for a completed job
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - ratedAddress
 *               - stars
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *               ratedAddress:
 *                 type: string
 *                 description: Stellar address of the user being rated
 *               stars:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               review:
 *                 type: string
 *                 maxLength: 200
 *     responses:
 *       201:
 *         description: Rating submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Rating'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Not a job participant or job not completed
 */
// POST /api/ratings — submit a rating (must be authenticated)
router.post("/", verifyJWT, async (req, res, next) => {
  try {
    const { jobId, ratedAddress, stars, review } = req.body;
    const raterAddress = req.user.publicKey;

    if (!jobId || !ratedAddress || stars == null) {
      return res.status(400).json({ error: "jobId, ratedAddress and stars are required" });
    }

    const parsedStars = parseInt(stars, 10);
    if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
      return res.status(400).json({ error: "stars must be an integer between 1 and 5" });
    }

    if (review && review.length > 200) {
      return res.status(400).json({ error: "review must be 200 characters or fewer" });
    }

    if (raterAddress === ratedAddress) {
      return res.status(400).json({ error: "Cannot rate yourself" });
    }

    // Verify the job is completed and rater is a party to it
    const { rows: jobRows } = await pool.query(
      "SELECT status, client_address, freelancer_address FROM jobs WHERE id = $1",
      [jobId]
    );
    if (!jobRows.length) return res.status(404).json({ error: "Job not found" });
    const job = jobRows[0];

    if (job.status !== "completed") {
      return res.status(400).json({ error: "Job must be completed before rating" });
    }

    const isParty =
      raterAddress === job.client_address ||
      raterAddress === job.freelancer_address;
    if (!isParty) {
      return res.status(403).json({ error: "Only job participants can submit a rating" });
    }

    const rating = await createRating({ jobId, raterAddress, ratedAddress, stars: parsedStars, review });
    res.status(201).json({ success: true, data: rating });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/ratings/{publicKey}:
 *   get:
 *     summary: List ratings for a user
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key of the user
 *     responses:
 *       200:
 *         description: Ratings retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Rating'
 */
// GET /api/ratings/:publicKey — list all ratings for a user
router.get("/:publicKey", async (req, res, next) => {
  try {
    const ratings = await getRatingsForUser(req.params.publicKey);
    res.json({ success: true, data: ratings });
  } catch (e) { next(e); }
});

module.exports = router;
