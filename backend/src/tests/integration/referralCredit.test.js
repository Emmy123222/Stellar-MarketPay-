/**
 * End-to-end integration test for the referral credit flow
 * Issue #1492: registration → referral code validation → first job completion
 * → credit issuance.
 *
 * Flow under test (all through the real Express app + test PostgreSQL DB):
 *   1. User A registers with User B's referral code (POST /api/referrals/register)
 *   2. User A completes their first job (escrow release → job completed)
 *   3. User B's balance reflects the 2% referral credit
 *      (GET /api/referrals/:publicKey and GET /api/referrals/my-stats)
 *
 * Uses seeded DB data (profiles + a funded escrow row, which production creates
 * via the smart-contract/indexer layer) rather than production state. Escrow
 * rows are "schema only; populated by smart-contract layer" (see schema.sql),
 * so the test seeds the funded escrow the same way the indexer would.
 */

"use strict";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const app = require("../../server");

// Test database configuration
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
const REFERRAL_BONUS_BPS = 200; // 2% — mirrors referralService
const ESCROW_AMOUNT = "100.0000000";
const BONUS_XLM = ((parseFloat(ESCROW_AMOUNT) * REFERRAL_BONUS_BPS) / 10_000).toFixed(7); // "2.0000000"

let pool;

/**
 * Build a valid Stellar G-address (G + 55 uppercase hex chars) that is unique
 * per test run. Keeping keys dynamic avoids collisions with rows left behind by
 * earlier runs of the suite on persistent databases.
 */
function uniqueTestAddress(label) {
  const nonce = Date.now().toString(16).toUpperCase() + label.toUpperCase();
  return ("G" + (nonce + "A".repeat(55))).slice(0, 56);
}

function makeAuthToken(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

async function seedProfile(publicKey, displayName, role) {
  await pool.query(
    `INSERT INTO profiles (public_key, display_name, role, referral_count, reputation_points)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (public_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           role = EXCLUDED.role`,
    [publicKey, displayName, role],
  );
}

/**
 * Create a job as the client, have the freelancer apply and get accepted so the
 * job moves to `in_progress`, then seed the funded escrow row (in production the
 * smart-contract/indexer layer writes this after the on-chain `create_escrow`).
 * Returns `{ jobId, applicationId }`.
 */
async function reachInProgressJob(clientKey, freelancerKey, clientToken, freelancerToken) {
  const jobResponse = await request(app)
    .post("/api/jobs")
    .set("Authorization", `Bearer ${clientToken}`)
    .send({
      title: "Referral Credit E2E Job",
      description:
        "Integration test covering the complete referral credit flow end to end.",
      budget: parseFloat(ESCROW_AMOUNT),
      currency: "XLM",
      category: "Backend Development",
      skills: ["TypeScript"],
      clientAddress: clientKey,
    });
  expect(jobResponse.status).toBe(201);
  expect(jobResponse.body.success).toBe(true);
  const jobId = jobResponse.body.data.id;

  const applicationResponse = await request(app)
    .post("/api/applications")
    .set("Authorization", `Bearer ${freelancerToken}`)
    .send({
      jobId,
      freelancerAddress: freelancerKey,
      proposal:
        "I would like to take on this job and complete it to a high standard.",
      bidAmount: parseFloat(ESCROW_AMOUNT),
    });
  expect(applicationResponse.status).toBe(201);
  expect(applicationResponse.body.success).toBe(true);
  const applicationId = applicationResponse.body.data.id;

  const acceptResponse = await request(app)
    .post(`/api/applications/${applicationId}/accept`)
    .set("Authorization", `Bearer ${clientToken}`)
    .send({ clientAddress: clientKey });
  expect(acceptResponse.status).toBe(200);
  expect(acceptResponse.body.success).toBe(true);

  const { rows: jobRows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  expect(jobRows.length).toBe(1);
  expect(jobRows[0].status).toBe("in_progress");
  expect(jobRows[0].freelancer_address).toBe(freelancerKey);

  // Seed the funded escrow the indexer would have created on-chain.
  await pool.query(
    `INSERT INTO escrows (job_id, contract_id, amount_xlm, status)
     VALUES ($1, $2, $3, 'funded')`,
    [jobId, "C" + "X".repeat(55), ESCROW_AMOUNT],
  );

  return { jobId, applicationId };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe("Referral credit end-to-end flow (#1492)", () => {
  test("User A registers with User B's code, completes first job, B earns the credit", async () => {
    // User B is the existing client + referrer; User A is the new referee/freelancer.
    const referrerKey = uniqueTestAddress("B");
    const refereeKey = uniqueTestAddress("A");
    const referrerToken = makeAuthToken(referrerKey);
    const refereeToken = makeAuthToken(refereeKey);

    await seedProfile(referrerKey, "Referrer B", "client");
    await seedProfile(refereeKey, "Referee A", "freelancer");

    // Step 1: User A registers with User B's referral code.
    const registerResponse = await request(app)
      .post("/api/referrals/register")
      .send({ referrerAddress: referrerKey, refereeAddress: refereeKey });

    expect(registerResponse.status).toBe(200);
    expect(registerResponse.body.success).toBe(true);
    expect(registerResponse.body.data.status).toBe("pending");

    // Referral is recorded and B's referral_count is incremented (seeded data).
    const { rows: refRows } = await pool.query(
      "SELECT * FROM referrals WHERE referrer_address = $1 AND referee_address = $2",
      [referrerKey, refereeKey],
    );
    expect(refRows.length).toBe(1);
    expect(refRows[0].status).toBe("pending");

    const { rows: referrerProfileBefore } = await pool.query(
      "SELECT referral_count, reputation_points FROM profiles WHERE public_key = $1",
      [referrerKey],
    );
    expect(parseInt(referrerProfileBefore[0].referral_count, 10)).toBe(1);
    const baseReputation = parseInt(referrerProfileBefore[0].reputation_points, 10);

    // No credit yet — the referee has not completed a first job.
    const pendingStats = await request(app)
      .get(`/api/referrals/${referrerKey}`)
      .set("Authorization", `Bearer ${referrerToken}`);
    expect(pendingStats.status).toBe(200);
    expect(pendingStats.body.data.totalEarnedXlm).toBe("0.0000000");
    expect(pendingStats.body.data.paidReferrals).toBe(0);
    expect(pendingStats.body.data.pendingReferrals).toBe(1);

    // Step 2: User A works on their first job for User B and the escrow is released.
    const { jobId } = await reachInProgressJob(
      referrerKey,
      refereeKey,
      referrerToken,
      refereeToken,
    );

    const releaseResponse = await request(app)
      .post(`/api/escrow/${jobId}/release`)
      .send({
        clientAddress: referrerKey,
        contractTxHash: `offchain-e2e-${Date.now()}`,
      });

    expect(releaseResponse.status).toBe(200);
    expect(releaseResponse.body.success).toBe(true);
    expect(releaseResponse.body).toHaveProperty("referralBonus");
    expect(releaseResponse.body.referralBonus.referrer).toBe(referrerKey);
    expect(releaseResponse.body.referralBonus.bonusXlm).toBe(BONUS_XLM);

    // The job is marked completed.
    const { rows: jobRows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
    expect(jobRows[0].status).toBe("completed");

    // Step 3: Assert User B's balance includes the referral credit.
    const statsResponse = await request(app)
      .get(`/api/referrals/${referrerKey}`)
      .set("Authorization", `Bearer ${referrerToken}`);

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.data.totalReferrals).toBe(1);
    expect(statsResponse.body.data.paidReferrals).toBe(1);
    expect(statsResponse.body.data.pendingReferrals).toBe(0);
    expect(statsResponse.body.data.totalEarnedXlm).toBe(BONUS_XLM);
    expect(statsResponse.body.data.referees[0]).toMatchObject({
      refereeAddress: refereeKey,
      status: "paid",
      payoutAmount: BONUS_XLM,
    });
    expect(statsResponse.body.data.payouts[0]).toMatchObject({
      refereeAddress: refereeKey,
      jobId,
      amountXlm: BONUS_XLM,
    });

    // Dashboard pipeline likewise reflects the paid credit.
    const myStatsResponse = await request(app)
      .get("/api/referrals/my-stats")
      .set("Authorization", `Bearer ${referrerToken}`);
    expect(myStatsResponse.status).toBe(200);
    expect(myStatsResponse.body.data.totalReferred).toBe(1);
    expect(myStatsResponse.body.data.paidCreditsXlm).toBe(BONUS_XLM);
    expect(myStatsResponse.body.data.pendingCreditsXlm).toBe("0.0000000");
    expect(myStatsResponse.body.data.pipeline.creditPaid).toBe(1);
    expect(myStatsResponse.body.data.referees[0]).toMatchObject({
      refereeAddress: refereeKey,
      status: "credit_paid",
      creditXlm: BONUS_XLM,
    });

    // DB audit trail: referral is paid and the payout row exists.
    const { rows: paidRows } = await pool.query(
      "SELECT * FROM referrals WHERE referrer_address = $1 AND referee_address = $2",
      [referrerKey, refereeKey],
    );
    expect(paidRows[0].status).toBe("paid");
    expect(paidRows[0].job_id).toBe(jobId);
    expect(paidRows[0].payout_amount).toBe(BONUS_XLM);
    expect(paidRows[0].paid_at).not.toBeNull();

    const { rows: payoutRows } = await pool.query(
      "SELECT * FROM referral_payouts WHERE referrer_address = $1 AND referee_address = $2",
      [referrerKey, refereeKey],
    );
    expect(payoutRows.length).toBe(1);
    expect(payoutRows[0].amount_xlm).toBe(BONUS_XLM);
    expect(payoutRows[0].job_id).toBe(jobId);

    // Referrer also earns the +5 reputation points, and referral_count is unchanged.
    const { rows: referrerProfileAfter } = await pool.query(
      "SELECT referral_count, reputation_points FROM profiles WHERE public_key = $1",
      [referrerKey],
    );
    expect(parseInt(referrerProfileAfter[0].referral_count, 10)).toBe(1);
    expect(parseInt(referrerProfileAfter[0].reputation_points, 10)).toBe(baseReputation + 5);
  });

  test("no credit is issued before the referee's first job is completed", async () => {
    const referrerKey = uniqueTestAddress("D");
    const refereeKey = uniqueTestAddress("E");
    const referrerToken = makeAuthToken(referrerKey);

    await seedProfile(referrerKey, "Referrer D", "client");
    await seedProfile(refereeKey, "Referee E", "freelancer");

    const registerResponse = await request(app)
      .post("/api/referrals/register")
      .send({ referrerAddress: referrerKey, refereeAddress: refereeKey });

    expect(registerResponse.status).toBe(200);
    expect(registerResponse.body.data.status).toBe("pending");

    // Referee registered but never completed a job → relationship stays pending
    // and no credit shows up anywhere.
    const myStatsResponse = await request(app)
      .get("/api/referrals/my-stats")
      .set("Authorization", `Bearer ${referrerToken}`);
    expect(myStatsResponse.status).toBe(200);
    expect(myStatsResponse.body.data.totalReferred).toBe(1);
    expect(myStatsResponse.body.data.paidCreditsXlm).toBe("0.0000000");
    expect(myStatsResponse.body.data.pipeline.creditPaid).toBe(0);
    expect(myStatsResponse.body.data.referees[0]).toMatchObject({
      refereeAddress: refereeKey,
      status: "registered",
    });

    const statsResponse = await request(app)
      .get(`/api/referrals/${referrerKey}`)
      .set("Authorization", `Bearer ${referrerToken}`);
    expect(statsResponse.body.data.totalEarnedXlm).toBe("0.0000000");
    expect(statsResponse.body.data.pendingReferrals).toBe(1);
    expect(statsResponse.body.data.payouts).toHaveLength(0);
  });
});