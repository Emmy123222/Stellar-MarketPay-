"use strict";

/**
 * src/services/referralService.test.js
 *
 * Unit test suite for referralService.js
 * Verifies:
 *   1. Referral credit is deferred until the referred user completes their first job (escrow released).
 *   2. Registration assigns referral_credit_pending status in the referrals table.
 *   3. escrowService.releaseEscrow() / processReferralPayout() triggers referral credit settlement on first job release.
 *   4. Subsequent jobs for the referee do not trigger duplicate referral credit settlement.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const {
  registerReferral,
  getReferrerForReferee,
  processReferralPayout,
  getReferralStats,
  REFERRAL_BONUS_BPS,
} = require("./referralService");

const REFERRER_KEY = "G" + "A".repeat(55);
const REFEREE_KEY = "G" + "B".repeat(55);
const JOB_ID = "11111111-2222-3333-4444-555555555555";
const JOB_2_ID = "66666666-7777-8888-9999-000000000000";

describe("referralService Unit Tests", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  describe("registerReferral", () => {
    it("creates a referral with status 'referral_credit_pending' and does not issue immediate credit", async () => {
      const createdRow = {
        id: "ref-uuid-1",
        referrer_address: REFERRER_KEY,
        referee_address: REFEREE_KEY,
        status: "referral_credit_pending",
        created_at: new Date().toISOString(),
      };

      pool.query
        .mockResolvedValueOnce({ rows: [createdRow] }) // INSERT referrals
        .mockResolvedValueOnce({ rows: [] }); // UPDATE profiles referral_count

      const result = await registerReferral(REFERRER_KEY, REFEREE_KEY);

      expect(result).toEqual(createdRow);
      expect(result.status).toBe("referral_credit_pending");

      // Verify DB query inserted 'referral_credit_pending' status
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("VALUES ($1, $2, 'referral_credit_pending')"),
        [REFERRER_KEY, REFEREE_KEY],
      );
    });

    it("rejects self-referral", async () => {
      await expect(registerReferral(REFERRER_KEY, REFERRER_KEY)).rejects.toThrow(
        "Referrer and referee cannot be the same address",
      );
    });
  });

  describe("getReferrerForReferee", () => {
    it("finds referrer when status is 'referral_credit_pending'", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ referrer_address: REFERRER_KEY }],
      });

      const referrer = await getReferrerForReferee(REFEREE_KEY);
      expect(referrer).toBe(REFERRER_KEY);
    });

    it("returns null if no pending referral exists", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const referrer = await getReferrerForReferee(REFEREE_KEY);
      expect(referrer).toBeNull();
    });
  });

  describe("processReferralPayout (escrow release trigger)", () => {
    it("deferred settlement: issues 2% credit and updates status to 'paid' when first job is completed", async () => {
      const pendingReferralRow = {
        id: "ref-uuid-1",
        referrer_address: REFERRER_KEY,
        referee_address: REFEREE_KEY,
        status: "referral_credit_pending",
      };

      // Mock pool.query for prevJobs check (0 previous jobs)
      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] }) // prevJobs
        .mockResolvedValueOnce({ rows: [pendingReferralRow] }); // find pending referral

      // Mock client transaction
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const amountXlm = "100.0000000";
      const expectedBonus = ((100 * REFERRAL_BONUS_BPS) / 10000).toFixed(7); // "2.0000000"

      const res = await processReferralPayout(JOB_ID, REFEREE_KEY, amountXlm, "tx-hash-123");

      expect(res).toEqual({
        referrer: REFERRER_KEY,
        bonusXlm: expectedBonus,
      });

      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'paid'"),
        [expectedBonus, JOB_ID, pendingReferralRow.id],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO referral_payouts"),
        [
          pendingReferralRow.id,
          REFERRER_KEY,
          REFEREE_KEY,
          JOB_ID,
          expectedBonus,
          "tx-hash-123",
        ],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("reputation_points = reputation_points + 5"),
        [REFERRER_KEY],
      );
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("does not issue credit if it is not the referee's first job", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ cnt: "1" }] }); // 1 previous completed job

      const res = await processReferralPayout(JOB_2_ID, REFEREE_KEY, "100.0000000", null);

      expect(res).toBeNull();
      expect(pool.connect).not.toHaveBeenCalled();
    });
  });

  describe("getReferralStats", () => {
    it("shows zero earned XLM while credit is pending in referral_credit_pending status", async () => {
      const summaryRow = {
        total_referrals: "1",
        paid_referrals: "0",
        pending_referrals: "1",
        total_earned_xlm: "0",
      };

      const refereeRows = [
        {
          id: "ref-uuid-1",
          referee_address: REFEREE_KEY,
          status: "referral_credit_pending",
          payout_amount: null,
          paid_at: null,
          created_at: new Date().toISOString(),
          referee_display_name: "Referee User",
          job_title: null,
        },
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [summaryRow] })
        .mockResolvedValueOnce({ rows: refereeRows })
        .mockResolvedValueOnce({ rows: [] });

      const stats = await getReferralStats(REFERRER_KEY);

      expect(stats.totalReferrals).toBe(1);
      expect(stats.paidReferrals).toBe(0);
      expect(stats.pendingReferrals).toBe(1);
      expect(stats.totalEarnedXlm).toBe("0.0000000");
      expect(stats.referees[0].status).toBe("referral_credit_pending");
    });
  });
});
