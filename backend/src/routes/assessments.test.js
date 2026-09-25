"use strict";

/**
 * src/routes/assessments.test.js
 *
 * Route-level test suite for /api/assessments endpoints (Issue #1190).
 *
 * Primary regression target: correctAnswer must be stripped from the
 * GET /project/:id response (it would leak grading data to candidates) and
 * must be used for grading in POST /project/:id/submit. If the wiring is
 * accidentally disconnected, the "correctAnswer not leaked" and "grading"
 * tests below will both fail loudly.
 *
 * Scope:
 *   - GET  /:skill               — happy path, strips answers, cooldown, 404
 *   - POST /:skill/submit        — happy path grading, cooldown 429, 404
 *   - POST /project              — happy path, 400 on missing fields, 401
 *   - GET  /project/:id          — correctAnswer NOT leaked, timer start, 404
 *   - POST /project/:id/submit   — grading wired to correctAnswer, 403, 404
 *   - GET  /project/:id/results  — authz check
 *   - GET  /results/:publicKey   — public endpoint
 *
 * NOTE: All tables used by this route (project_assessments,
 * project_assessment_submissions, skill_assessments, skill_certificates)
 * are NOT in pgMock's smart-handler table, so every test drives them via
 * mockResolvedValueOnce. We call pool.query.mockReset() in beforeEach (not
 * just mockClear) so no queued values leak between tests.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const assessmentsRoutes = require("./assessments");

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/assessments", assessmentsRoutes);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_KEY   = "G" + "A".repeat(55);
const CLIENT_KEY = "G" + "C".repeat(55);
const ASSESS_ID  = "11111111-1111-1111-1111-111111111111";
const SUB_ID     = "22222222-2222-2222-2222-222222222222";

function makeToken(publicKey = USER_KEY) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

function fakeAssessment(overrides = {}) {
  return {
    id: ASSESS_ID,
    client_address: CLIENT_KEY,
    job_id: null,
    title: "Test Assessment",
    description: "desc",
    time_limit_minutes: 30,
    questions: [
      { id: 1, type: "multiple_choice", question: "What is 1+1?",  options: ["1","2","3"],          correctAnswer: "2"        },
      { id: 2, type: "multiple_choice", question: "Sky colour?",   options: ["red","blue","green"],  correctAnswer: "blue"     },
      { id: 3, type: "open_text",       question: "Explain REST.",  correctAnswer: "REST is..."      },
    ],
    ...overrides,
  };
}

function fakeSubmission(overrides = {}) {
  return {
    id: SUB_ID,
    assessment_id: ASSESS_ID,
    freelancer_address: USER_KEY,
    status: "started",
    started_at: new Date().toISOString(),
    answers: null,
    score: null,
    submitted_at: null,
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Assessments Routes (/api/assessments)", () => {
  beforeEach(() => {
    // pool.reset() clears in-memory Maps and calls query.mockClear().
    pool.reset();
    // mockReset() must come AFTER pool.reset() so it wins: it clears the call
    // history AND any queued mockResolvedValueOnce values left from prior tests,
    // and removes the smart-handler implementation installed by createPgMock().
    pool.query.mockReset();
    // Install a safe default: every unmatched query returns empty rows.
    // Tests that need specific results use mockResolvedValueOnce on top of this.
    pool.query.mockResolvedValue({ rows: [] });
  });

  // ===========================================================================
  // GET /:skill — skill-bank assessment
  // ===========================================================================
  describe("GET /:skill", () => {
    it("200 — returns questions without answer or correctAnswer field", async () => {
      // No prior attempt
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get("/api/assessments/javascript")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.skill).toBe("javascript");
      expect(res.body.data.questions.length).toBeGreaterThan(0);

      for (const q of res.body.data.questions) {
        expect(q).not.toHaveProperty("answer");
        expect(q).not.toHaveProperty("correctAnswer");
        expect(q).toHaveProperty("id");
        expect(q).toHaveProperty("question");
        expect(q).toHaveProperty("options");
      }
    });

    it("200 — canRetake is false while cooldown is active", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ score: 80, passed: true, taken_at: new Date().toISOString() }],
      });

      const res = await request(app)
        .get("/api/assessments/javascript")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.canRetake).toBe(false);
      expect(res.body.data.retakeAvailableAt).toBeTruthy();
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app).get("/api/assessments/javascript");
      expect(res.status).toBe(401);
    });

    it("404 — returns 404 for unknown skill", async () => {
      const res = await request(app)
        .get("/api/assessments/cobol")
        .set("Authorization", `Bearer ${makeToken()}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Unknown skill");
    });
  });

  // ===========================================================================
  // POST /:skill/submit — skill assessment grading
  // ===========================================================================
  describe("POST /:skill/submit", () => {
    it("200 — grades correctly using q.answer from the skill bank", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })   // no prior attempt (cooldown check)
        .mockResolvedValueOnce({ rows: [] });  // INSERT skill_assessments

      // All 10 correct answers for the javascript bank
      const answers = { 1: 2, 2: 3, 3: 1, 4: 1, 5: 2, 6: 1, 7: 2, 8: 1, 9: 1, 10: 1 };

      const res = await request(app)
        .post("/api/assessments/javascript/submit")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.score).toBe(100);
      expect(res.body.data.passed).toBe(true);
      expect(res.body.data.total).toBe(10);
    });

    it("200 — score is 0 when all answers are wrong", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const answers = { 1: 99, 2: 99, 3: 99, 4: 99, 5: 99, 6: 99, 7: 99, 8: 99, 9: 99, 10: 99 };

      const res = await request(app)
        .post("/api/assessments/javascript/submit")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(0);
      expect(res.body.data.passed).toBe(false);
    });

    it("429 — blocks retake during cooldown period", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ taken_at: new Date().toISOString() }],
      });

      const res = await request(app)
        .post("/api/assessments/javascript/submit")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers: { 1: 2 } });

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/cooldown/i);
      expect(res.body.retakeAvailableAt).toBeTruthy();
    });

    it("400 — rejects missing answers payload", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/assessments/javascript/submit")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/answers/i);
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app)
        .post("/api/assessments/javascript/submit")
        .set("X-CSRF-Token", "dummy")
        .send({ answers: {} });
      expect(res.status).toBe(401);
    });

    it("404 — returns 404 for unknown skill", async () => {
      const res = await request(app)
        .post("/api/assessments/cobol/submit")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers: {} });
      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // POST /project — create a project assessment
  // ===========================================================================
  describe("POST /project", () => {
    const validBody = {
      title: "Backend coding challenge",
      description: "Build a REST API",
      timeLimitMinutes: 60,
      questions: [{ type: "open_text", question: "Design a system" }],
    };

    it("200 — happy path: creates an assessment", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: ASSESS_ID, ...validBody, client_address: CLIENT_KEY }],
      });

      const res = await request(app)
        .post("/api/assessments/project")
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`)
        .set("X-CSRF-Token", "dummy")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ASSESS_ID);
    });

    it("400 — rejects when title is missing", async () => {
      const res = await request(app)
        .post("/api/assessments/project")
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`)
        .set("X-CSRF-Token", "dummy")
        .send({ timeLimitMinutes: 60, questions: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required fields/);
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app)
        .post("/api/assessments/project")
        .set("X-CSRF-Token", "dummy")
        .send(validBody);
      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // GET /project/:id — fetch assessment to take it
  // CRITICAL: correctAnswer must NOT appear in the response
  // ===========================================================================
  describe("GET /project/:id", () => {
    it("200 — happy path: starts submission and returns questions", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })  // fetch assessment
        .mockResolvedValueOnce({ rows: [] })                  // no existing submission
        .mockResolvedValueOnce({ rows: [fakeSubmission()] }); // INSERT submission

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.submission.status).toBe("started");
    });

    it("REGRESSION — correctAnswer is NOT present in any returned question", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [fakeSubmission()] });

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      const returnedQuestions = res.body.data.assessment.questions;
      expect(returnedQuestions.length).toBeGreaterThan(0);

      for (const q of returnedQuestions) {
        // Fails if the correctAnswer-stripping destructure is removed
        expect(q).not.toHaveProperty("correctAnswer");
      }
    });

    it("200 — reuses an existing started submission", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission()] }); // existing submission found

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      // Only 2 queries: fetch assessment + check existing sub (no INSERT)
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it("403 — blocks access when submission is already submitted", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission({ status: "submitted" })] });

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/already submitted/i);
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app).get(`/api/assessments/project/${ASSESS_ID}`);
      expect(res.status).toBe(401);
    });

    it("404 — returns 404 when assessment does not exist", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no assessment row

      const res = await request(app)
        .get(`/api/assessments/project/non-existent-id`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Assessment not found");
    });
  });

  // ===========================================================================
  // POST /project/:id/submit — submit answers and grade
  // CRITICAL: grading must use q.correctAnswer
  // ===========================================================================
  describe("POST /project/:id/submit", () => {
    const answers = { 0: "2", 1: "blue" }; // correct for q[0] and q[1]

    it("200 — happy path: grades multiple-choice via correctAnswer", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission()] })
        .mockResolvedValueOnce({ rows: [{ ...fakeSubmission(), status: "submitted", score: 100 }] });

      const res = await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.score).toBe("number");
    });

    it("REGRESSION — score passed to DB is 100 when all MC answers match correctAnswer", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission()] })
        .mockResolvedValueOnce({ rows: [{ ...fakeSubmission(), status: "submitted", score: 100 }] });

      await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers: { 0: "2", 1: "blue" } });

      const updateCall = pool.query.mock.calls.find(
        ([sql]) => typeof sql === "string" && sql.includes("SET answers"),
      );
      expect(updateCall).toBeDefined();
      // $2 in the UPDATE is the computed score — must be 100
      expect(updateCall[1][1]).toBe(100);
    });

    it("REGRESSION — score passed to DB is 0 when no answers match correctAnswer", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission()] })
        .mockResolvedValueOnce({ rows: [{ ...fakeSubmission(), status: "submitted", score: 0 }] });

      await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers: { 0: "WRONG", 1: "WRONG" } });

      const updateCall = pool.query.mock.calls.find(
        ([sql]) => typeof sql === "string" && sql.includes("SET answers"),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1][1]).toBe(0);
    });

    it("403 — rejects when assessment is already submitted", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [fakeSubmission({ status: "submitted" })] });

      const res = await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/already submitted/i);
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });
      expect(res.status).toBe(401);
    });

    it("404 — returns 404 when assessment does not exist", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no assessment row

      const res = await request(app)
        .post(`/api/assessments/project/non-existent-id/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Assessment not found");
    });

    it("404 — returns 404 when submission not found (forgot to GET first)", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [] }); // no submission

      const res = await request(app)
        .post(`/api/assessments/project/${ASSESS_ID}/submit`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy")
        .send({ answers });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Fetch assessment first/i);
    });
  });

  // ===========================================================================
  // GET /project/:id/results — client views all submissions
  // ===========================================================================
  describe("GET /project/:id/results", () => {
    it("200 — happy path: returns submissions for the creator", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [fakeAssessment()] })
        .mockResolvedValueOnce({ rows: [{ ...fakeSubmission(), display_name: "Bob" }] });

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}/results`)
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("403 — rejects when caller is not the assessment creator", async () => {
      pool.query.mockResolvedValueOnce({ rows: [fakeAssessment()] });

      const res = await request(app)
        .get(`/api/assessments/project/${ASSESS_ID}/results`)
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`); // not CLIENT_KEY

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Only the creator/i);
    });

    it("401 — rejects without JWT", async () => {
      const res = await request(app).get(`/api/assessments/project/${ASSESS_ID}/results`);
      expect(res.status).toBe(401);
    });

    it("404 — returns 404 when assessment does not exist", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/assessments/project/non-existent-id/results`)
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`);

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /results/:publicKey — public results lookup
  // ===========================================================================
  describe("GET /results/:publicKey", () => {
    it("200 — returns assessment history for a public key", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { skill: "javascript", score: 80, passed: true,  taken_at: new Date().toISOString() },
          { skill: "react",      score: 65, passed: false, taken_at: new Date().toISOString() },
        ],
      });

      const res = await request(app).get(`/api/assessments/results/${USER_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it("200 — returns empty array for a user with no attempts", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get(`/api/assessments/results/${USER_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
