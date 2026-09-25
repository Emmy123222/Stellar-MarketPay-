"use strict";

/**
 * src/routes/ratings.test.js
 *
 * Route-level test suite for /api/ratings endpoints.
 * Covers:
 *   - POST /api/ratings (submit a rating) — guarded by verifyJWT
 *   - GET /api/ratings/:publicKey (list ratings for a user) — public
 *
 * The DB pool is replaced with the shared pgMock. The ratingService is
 * mocked at the module level so tests stay deterministic. CSRF is a
 * passthrough in jest.setup.js, so a dummy "X-CSRF-Token" header is
 * sufficient for mutating requests.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/ratingService", () => ({
  createRating: jest.fn(),
  getRatingsForUser: jest.fn(),
}));

const pool = require("../db/pool");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const { JWT_SECRET } = require("../middleware/auth");
const { defaultJobRow } = require("../testUtils/pgMock");
const { createRating, getRatingsForUser } = require("../services/ratingService");
const ratingRoutes = require("./ratings");

// ── Minimal Express test app ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/ratings", ratingRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

const RATER_ADDRESS = "G" + "A".repeat(55);
const RATED_ADDRESS = "G" + "B".repeat(55);
const OTHER_ADDRESS = "G" + "C".repeat(55);
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeToken(publicKey = RATER_ADDRESS) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

/** Seed a completed job where RATER_ADDRESS is the client and RATED_ADDRESS is the freelancer */
function seedCompletedJob() {
  const job = defaultJobRow({
    id: JOB_ID,
    status: "completed",
    client_address: RATER_ADDRESS,
    freelancer_address: RATED_ADDRESS,
  });
  pool.jobs.set(JOB_ID, job);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Ratings Route Suite (/api/ratings)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. POST /api/ratings — submit a rating (guarded by verifyJWT)
  // ===========================================================================
  describe("POST /api/ratings", () => {
    const validBody = {
      jobId: JOB_ID,
      ratedAddress: RATED_ADDRESS,
      stars: 5,
      review: "Excellent work — delivered on time",
    };

    it("201 — happy path: submits a rating for a completed job", async () => {
      seedCompletedJob();

      const mockRating = {
        id: "rating-1",
        job_id: JOB_ID,
        rater_address: RATER_ADDRESS,
        rated_address: RATED_ADDRESS,
        stars: 5,
        review: "Excellent work — delivered on time",
      };
      createRating.mockResolvedValue(mockRating);

      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRating);
      expect(createRating).toHaveBeenCalledWith({
        jobId: JOB_ID,
        raterAddress: RATER_ADDRESS,
        ratedAddress: RATED_ADDRESS,
        stars: 5,
        review: "Excellent work — delivered on time",
      });
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
      expect(pool.query).not.toHaveBeenCalled();
      expect(createRating).not.toHaveBeenCalled();
    });

    it("401 — rejects an invalid / malformed JWT", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", "Bearer not.a.valid.jwt")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
      expect(createRating).not.toHaveBeenCalled();
    });

    it("400 — rejects when jobId is missing", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ratedAddress: RATED_ADDRESS, stars: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("jobId, ratedAddress and stars are required");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when ratedAddress is missing", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ jobId: JOB_ID, stars: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("jobId, ratedAddress and stars are required");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when stars is missing", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ jobId: JOB_ID, ratedAddress: RATED_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("jobId, ratedAddress and stars are required");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when stars is above 5", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, stars: 6 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("stars must be an integer between 1 and 5");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when stars is below 1", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, stars: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("stars must be an integer between 1 and 5");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when stars is not a valid number", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, stars: "abc" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("stars must be an integer between 1 and 5");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects when review exceeds 200 characters", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, review: "a".repeat(201) });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("review must be 200 characters or fewer");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400 — rejects self-rating", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, ratedAddress: RATER_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Cannot rate yourself");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("404 — rejects when job does not exist", async () => {
      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, jobId: "nonexistent-job-id" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
      expect(createRating).not.toHaveBeenCalled();
    });

    it("400 — rejects when job is not completed", async () => {
      const job = defaultJobRow({
        id: JOB_ID,
        status: "open",
        client_address: RATER_ADDRESS,
        freelancer_address: RATED_ADDRESS,
      });
      pool.jobs.set(JOB_ID, job);

      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Job must be completed before rating");
      expect(createRating).not.toHaveBeenCalled();
    });

    it("403 — rejects when rater is not a job participant", async () => {
      const job = defaultJobRow({
        id: JOB_ID,
        status: "completed",
        client_address: OTHER_ADDRESS,
        freelancer_address: RATED_ADDRESS,
      });
      pool.jobs.set(JOB_ID, job);

      const res = await request(app)
        .post("/api/ratings")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only job participants can submit a rating");
      expect(createRating).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 2. GET /api/ratings/:publicKey — list ratings for a user (public)
  // ===========================================================================
  describe("GET /api/ratings/:publicKey", () => {
    it("200 — returns ratings for a user", async () => {
      const mockRatings = [
        { id: "rating-1", job_id: JOB_ID, rated_address: RATED_ADDRESS, stars: 5 },
        { id: "rating-2", job_id: "job-other", rated_address: RATED_ADDRESS, stars: 4 },
      ];
      getRatingsForUser.mockResolvedValue(mockRatings);

      const res = await request(app).get(`/api/ratings/${RATED_ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRatings);
      expect(getRatingsForUser).toHaveBeenCalledWith(RATED_ADDRESS);
    });

    it("200 — returns empty array when user has no ratings", async () => {
      getRatingsForUser.mockResolvedValue([]);

      const res = await request(app).get(`/api/ratings/${RATED_ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(getRatingsForUser).toHaveBeenCalledWith(RATED_ADDRESS);
    });
  });
});
