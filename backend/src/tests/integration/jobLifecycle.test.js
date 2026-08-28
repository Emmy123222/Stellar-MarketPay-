/**
 * Integration tests for complete job lifecycle
 * Issue #503: Tests covering post → apply → accept → escrow → release → rating
 *
 * Uses Supertest against real Express app + test PostgreSQL DB
 * Transactions rolled back between tests for isolation
 */

"use strict";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const app = require("../../server");

// Test database configuration
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

let pool;
let testClient;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  testClient = await pool.connect();
});

afterAll(async () => {
  if (testClient) await testClient.release();
  if (pool) await pool.end();
});

beforeEach(async () => {
  // Start transaction for test isolation
  await testClient.query("BEGIN");
});

afterEach(async () => {
  // Rollback transaction to clean up test data
  await testClient.query("ROLLBACK");
});

describe("Job Lifecycle Integration Tests", () => {
  let clientPublicKey;
  let freelancerPublicKey;
  let authToken;
  let freelancerAuthToken;
  let jobId;
  let applicationId;

  beforeAll(async () => {
    // Create test users
    clientPublicKey = "G" + "A".repeat(55);
    freelancerPublicKey = "G" + "B".repeat(55);

    // Insert test profiles
    await pool.query(
      `INSERT INTO profiles (public_key, display_name, role) 
       VALUES ($1, $2, $3), ($4, $5, $6)
       ON CONFLICT (public_key) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [clientPublicKey, "Test Client", "client", freelancerPublicKey, "Test Freelancer", "freelancer"]
    );

    // Generate auth tokens the real verifyJWT middleware accepts. Requests
    // hit the actual app, so bearer strings must be valid signed JWTs whose
    // publicKey claim matches the acting wallet address.
    const signingSecret =
      process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
    authToken = jwt.sign({ publicKey: clientPublicKey }, signingSecret, {
      expiresIn: "1h",
    });
    freelancerAuthToken = jwt.sign(
      { publicKey: freelancerPublicKey },
      signingSecret,
      { expiresIn: "1h" }
    );
  });

  test("Complete job lifecycle: post → apply → accept → escrow → release → rating", async () => {
    // Step 1: Create a job
    const jobResponse = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Integration Test Job",
        description: "This is a test job for integration testing",
        budget: 100,
        currency: "XLM",
        category: "Backend Development",
        skills: ["Rust", "TypeScript"],
        clientAddress: clientPublicKey,
      });

    expect(jobResponse.status).toBe(201);
    expect(jobResponse.body.success).toBe(true);
    expect(jobResponse.body.data).toHaveProperty("id");
    jobId = jobResponse.body.data.id;

    // Verify job in database
    const jobResult = await testClient.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
    expect(jobResult.rows.length).toBe(1);
    expect(jobResult.rows[0].status).toBe("open");
    expect(jobResult.rows[0].client_address).toBe(clientPublicKey);

    // Step 2: Apply to the job
    const applicationResponse = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${freelancerAuthToken}`)
      .send({
        jobId,
        freelancerAddress: freelancerPublicKey,
        proposal:
          "I would like to apply for this job. I have extensive experience with the required skills and can deliver high-quality work on time.",
        bidAmount: 95,
      });

    expect(applicationResponse.status).toBe(201);
    expect(applicationResponse.body.success).toBe(true);
    expect(applicationResponse.body.data).toHaveProperty("id");
    applicationId = applicationResponse.body.data.id;

    // Verify application in database
    const appResult = await testClient.query(
      "SELECT * FROM applications WHERE id = $1",
      [applicationId]
    );
    expect(appResult.rows.length).toBe(1);
    expect(appResult.rows[0].status).toBe("pending");
    expect(appResult.rows[0].freelancer_address).toBe(freelancerPublicKey);

    // Step 3: Accept the application (POST /api/applications/:id/accept)
    const acceptResponse = await request(app)
      .post(`/api/applications/${applicationId}/accept`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ clientAddress: clientPublicKey });

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.success).toBe(true);

    // Verify job status changed to in_progress
    const updatedJobResult = await testClient.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
    expect(updatedJobResult.rows[0].status).toBe("in_progress");
    expect(updatedJobResult.rows[0].freelancer_address).toBe(freelancerPublicKey);

    // Step 4: Fund escrow by attaching the Soroban contract to the job.
    // Escrow rows are keyed by job_id; the API records the funded escrow.
    const escrowResponse = await request(app)
      .patch(`/api/jobs/${jobId}/escrow`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ escrowContractId: "C" + "X".repeat(55) });

    expect(escrowResponse.status).toBe(200);
    expect(escrowResponse.body.success).toBe(true);

    // Verify escrow in database. Escrow is funded at the accepted application's
    // bid amount (95), not the job's listing budget (100) — see #850 fix
    // "pass accepted bid amount to escrow update".
    const escrowResult = await testClient.query("SELECT * FROM escrows WHERE job_id = $1", [jobId]);
    expect(escrowResult.rows.length).toBe(1);
    expect(escrowResult.rows[0].status).toBe("funded");
    expect(parseFloat(escrowResult.rows[0].amount_xlm)).toBe(95);

    // Step 5: Release escrow (POST /api/escrow/:jobId/release)
    const releaseResponse = await request(app)
      .post(`/api/escrow/${jobId}/release`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ clientAddress: clientPublicKey });

    expect(releaseResponse.status).toBe(200);
    expect(releaseResponse.body.success).toBe(true);

    // The API marks the job completed immediately. The escrow row's own
    // status flips to 'released' asynchronously when the indexer observes
    // the on-chain release_escrow() event, so assert on the completed job.
    const completedJobResult = await testClient.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
    expect(completedJobResult.rows[0].status).toBe("completed");

    // Step 6: Submit rating
    const ratingResponse = await request(app)
      .post("/api/ratings")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        jobId,
        raterAddress: clientPublicKey,
        ratedAddress: freelancerPublicKey,
        stars: 5,
        review: "Great work!",
      });

    expect(ratingResponse.status).toBe(201);
    expect(ratingResponse.body.success).toBe(true);

    // Verify rating in database
    const ratingResult = await testClient.query(
      "SELECT * FROM ratings WHERE job_id = $1 AND rater_address = $2",
      [jobId, clientPublicKey]
    );
    expect(ratingResult.rows.length).toBe(1);
    expect(ratingResult.rows[0].stars).toBe(5);
    expect(ratingResult.rows[0].review).toBe("Great work!");
  });

  test("Job lifecycle fails with invalid auth token", async () => {
    const response = await request(app)
      .post("/api/jobs")
      .set("Authorization", "Bearer invalid-token")
      .send({
        title: "Test Job",
        description: "Test description",
        budget: 100,
        category: "Backend Development",
        clientAddress: clientPublicKey,
      });

    expect(response.status).toBe(401);
  });

  test("Job lifecycle fails with invalid job data", async () => {
    const response = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Short", // Too short (< 10 chars)
        description: "Test",
        budget: -100, // Invalid budget
        category: "Invalid Category",
        clientAddress: clientPublicKey,
      });

    expect(response.status).toBe(400);
  });
});
