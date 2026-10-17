/**
 * src/routes/sponsorship.test.js
 * Unit and integration tests for Gas Fee Sponsorship System (Issue #1554)
 */
"use strict";

const request = require("supertest");
const { Keypair, TransactionBuilder, Account, Operation, Networks } = require("@stellar/stellar-sdk");
const app = require("../server");
const pool = require("../db/pool");
const sponsorshipService = require("../services/sponsorshipService");

describe("Gas Fee Sponsorship System (Issue #1554)", () => {
  const eligibleFreelancer = Keypair.random();
  const ineligibleEmailFreelancer = Keypair.random();
  const ineligibleProfileFreelancer = Keypair.random();
  const ineligibleJobsFreelancer = Keypair.random();

  const networkPassphrase = Networks.TESTNET;

  function buildSampleTx(sourceKeypair) {
    const account = new Account(sourceKeypair.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: require("@stellar/stellar-sdk").Asset.native(),
          amount: "1",
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeypair);
    return tx.toXDR();
  }

  beforeAll(async () => {
    // Mock pool.query for tests
    jest.spyOn(pool, "query").mockImplementation(async (sql, params) => {
      const sqlStr = typeof sql === "string" ? sql : sql.text;

      // Profiles query
      if (sqlStr.includes("FROM profiles WHERE public_key = $1")) {
        const pk = params[0];
        if (pk === eligibleFreelancer.publicKey()) {
          return {
            rows: [
              {
                public_key: pk,
                display_name: "Alice Developer",
                bio: "Full stack Stellar Soroban developer",
                skills: ["Rust", "TypeScript"],
                completed_jobs: 0,
                email: "alice@example.com",
                email_verified: true,
              },
            ],
          };
        }
        if (pk === ineligibleEmailFreelancer.publicKey()) {
          return {
            rows: [
              {
                public_key: pk,
                display_name: "Bob Unverified",
                bio: "Web3 developer",
                skills: ["Rust"],
                completed_jobs: 0,
                email: "bob@example.com",
                email_verified: false,
              },
            ],
          };
        }
        if (pk === ineligibleProfileFreelancer.publicKey()) {
          return {
            rows: [
              {
                public_key: pk,
                display_name: "",
                bio: "",
                skills: [],
                completed_jobs: 0,
                email: "charlie@example.com",
                email_verified: true,
              },
            ],
          };
        }
        if (pk === ineligibleJobsFreelancer.publicKey()) {
          return {
            rows: [
              {
                public_key: pk,
                display_name: "Dave Experienced",
                bio: "Senior developer",
                skills: ["Rust"],
                completed_jobs: 3,
                email: "dave@example.com",
                email_verified: true,
              },
            ],
          };
        }
        return { rows: [] };
      }

      // Check jobs count
      if (sqlStr.includes("FROM jobs WHERE freelancer_address = $1")) {
        const pk = params[0];
        if (pk === ineligibleJobsFreelancer.publicKey()) {
          return { rows: [{ count: "3" }] };
        }
        return { rows: [{ count: "0" }] };
      }

      // sponsorship_credits SELECT
      if (sqlStr.includes("SELECT freelancer_id, credits_remaining, total_sponsored FROM sponsorship_credits")) {
        return {
          rows: [
            {
              freelancer_id: params[0],
              credits_remaining: 5,
              total_sponsored: 0,
            },
          ],
        };
      }

      // sponsorship_credits INSERT
      if (sqlStr.includes("INSERT INTO sponsorship_credits")) {
        return {
          rows: [
            {
              freelancer_id: params[0],
              credits_remaining: 5,
              total_sponsored: 0,
            },
          ],
        };
      }

      // sponsorship_credits UPDATE
      if (sqlStr.includes("UPDATE sponsorship_credits")) {
        return {
          rows: [
            {
              credits_remaining: 4,
              total_sponsored: 1,
            },
          ],
        };
      }

      return { rows: [] };
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("Sponsorship Account", () => {
    it("GET /api/sponsorship/account returns public key of the platform sponsoring account", async () => {
      const res = await request(app).get("/api/sponsorship/account");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.sponsoringAccount).toBe("string");
      expect(res.body.data.sponsoringAccount.startsWith("G")).toBe(true);
    });
  });

  describe("Eligibility Checking", () => {
    it("returns eligible=true for verified email, completed profile, 0 completed jobs", async () => {
      const eligibility = await sponsorshipService.checkEligibility(eligibleFreelancer.publicKey());
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.creditsRemaining).toBe(5);
    });

    it("returns eligible=false when email is unverified", async () => {
      const eligibility = await sponsorshipService.checkEligibility(ineligibleEmailFreelancer.publicKey());
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.missing).toBe("verified_email");
    });

    it("returns eligible=false when profile is incomplete", async () => {
      const eligibility = await sponsorshipService.checkEligibility(ineligibleProfileFreelancer.publicKey());
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.missing).toBe("completed_profile");
    });

    it("returns eligible=false when user has completed jobs", async () => {
      const eligibility = await sponsorshipService.checkEligibility(ineligibleJobsFreelancer.publicKey());
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.missing).toBe("zero_completed_jobs");
    });
  });

  describe("POST /api/sponsorship/request", () => {
    it("returns sponsored transaction envelope for eligible user", async () => {
      const sampleXdr = buildSampleTx(eligibleFreelancer);

      const res = await request(app)
        .post("/api/sponsorship/request")
        .send({
          xdr: sampleXdr,
          freelancerId: eligibleFreelancer.publicKey(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sponsoredEnvelope).toBeDefined();
      expect(typeof res.body.sponsoredEnvelope).toBe("string");
      expect(res.body.creditsRemaining).toBe(4);
      expect(res.body.totalSponsored).toBe(1);
    });

    it("rejects sponsorship with 403 if user is ineligible (unverified email)", async () => {
      const sampleXdr = buildSampleTx(ineligibleEmailFreelancer);

      const res = await request(app)
        .post("/api/sponsorship/request")
        .send({
          xdr: sampleXdr,
          freelancerId: ineligibleEmailFreelancer.publicKey(),
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Email must be verified");
    });

    it("rejects sponsorship with 400 when XDR is missing", async () => {
      const res = await request(app)
        .post("/api/sponsorship/request")
        .send({
          freelancerId: eligibleFreelancer.publicKey(),
        });

      expect(res.status).toBe(400);
    });
  });
});
