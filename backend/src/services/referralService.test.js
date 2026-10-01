"use strict";

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock("../db/pool", () => ({
  query: mockQuery,
  connect: jest.fn().mockResolvedValue({
    query: mockClientQuery,
    release: mockRelease,
  }),
}));

const pool = require("../db/pool");
const {
  registerReferral,
  getReferrerForReferee,
  processReferralPayout,
  getReferralStats,
  REFERRAL_BONUS_BPS,
} = require("./referralService");

describe("referralService", () => {
  const REFERRER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const REFEREE = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const OTHER_REFERRER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
  const JOB_ID = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockRelease.mockReset();
  });

  describe("registerReferral", () => {
    it("should successfully register a referral and increment referrer referral_count", async () => {
      const newReferral = {
        id: "ref-uuid-1",
        referrer_address: REFERRER,
        referee_address: REFEREE,
        status: "pending",
      };
      // 1. INSERT with WHERE NOT EXISTS -> returned row
      mockQuery.mockResolvedValueOnce({ rows: [newReferral] });
      // 2. UPDATE profiles SET referral_count = referral_count + 1
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await registerReferral(REFERRER, REFEREE);

      expect(result).toEqual(newReferral);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("INSERT INTO referrals"),
        [REFERRER, REFEREE]
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("UPDATE profiles"),
        [REFERRER]
      );
    });

    it("should reject self-referrals with status 400", async () => {
      await expect(registerReferral(REFERRER, REFERRER)).rejects.toMatchObject({
        message: "Referrer and referee cannot be the same address",
        status: 400,
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("should prevent a referee from being referred more than once", async () => {
      // If referee was already referred, WHERE NOT EXISTS returns 0 rows
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await registerReferral(REFERRER, REFEREE);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("should return null if insert conflict occurs (already existed)", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await registerReferral(REFERRER, REFEREE);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("should throw 400 for invalid public keys", async () => {
      await expect(registerReferral("invalid-key", REFEREE)).rejects.toMatchObject({
        message: "Invalid Stellar public key",
        status: 400,
      });
      await expect(registerReferral(REFERRER, "invalid-key")).rejects.toMatchObject({
        message: "Invalid Stellar public key",
        status: 400,
      });
    });
  });

  describe("getReferrerForReferee", () => {
    it("should return referrer address when pending referral exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ referrer_address: REFERRER }],
      });

      const result = await getReferrerForReferee(REFEREE);
      expect(result).toBe(REFERRER);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE referee_address = $1 AND status = 'pending'"),
        [REFEREE]
      );
    });

    it("should return null when no pending referral exists", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getReferrerForReferee(REFEREE);
      expect(result).toBeNull();
    });
  });

  describe("processReferralPayout", () => {
    it("should calculate 1% bonus on escrow release and store in referral_payouts table", async () => {
      // 1. Previous jobs count -> 0 (referee's first job)
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
      // 2. Pending referral row -> found
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "referral-uuid-1",
            referrer_address: REFERRER,
            referee_address: REFEREE,
            status: "pending",
          },
        ],
      });

      // Transaction queries (client)
      mockClientQuery.mockResolvedValue({ rowCount: 1 });

      const amountXlm = "100.0000000"; // 100 XLM escrow
      // With 1% bonus (100 BPS), 1% of 100 is 1.0000000 XLM
      const expectedBonus = ((100 * REFERRAL_BONUS_BPS) / 10_000).toFixed(7);

      const result = await processReferralPayout(JOB_ID, REFEREE, amountXlm, "tx-hash-123");

      expect(result).toEqual({
        referrer: REFERRER,
        bonusXlm: expectedBonus,
      });

      // Verify transaction flow
      expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
      // Update referrals to paid
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE referrals"),
        [expectedBonus, JOB_ID, "referral-uuid-1"]
      );
      // Insert into referral_payouts
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO referral_payouts"),
        ["referral-uuid-1", REFERRER, REFEREE, JOB_ID, expectedBonus, "tx-hash-123"]
      );
      // Update referrer reputation
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE profiles"),
        [REFERRER]
      );
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
      expect(mockRelease).toHaveBeenCalled();
    });

    it("should return null if referee has already completed a previous job", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "1" }] }); // previously completed 1 job

      const result = await processReferralPayout(JOB_ID, REFEREE, "50.0000000");

      expect(result).toBeNull();
      expect(mockClientQuery).not.toHaveBeenCalled();
    });

    it("should return null if no pending referral exists for referee", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no pending referral

      const result = await processReferralPayout(JOB_ID, REFEREE, "50.0000000");

      expect(result).toBeNull();
    });

    it("should return null for invalid or non-positive escrow amounts", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "ref-1", referrer_address: REFERRER }],
      });

      const res1 = await processReferralPayout(JOB_ID, REFEREE, "0");
      expect(res1).toBeNull();

      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "ref-1", referrer_address: REFERRER }],
      });

      const res2 = await processReferralPayout(JOB_ID, REFEREE, "invalid");
      expect(res2).toBeNull();
    });

    it("should rollback transaction on error", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "ref-1", referrer_address: REFERRER }],
      });

      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      mockClientQuery.mockRejectedValueOnce(new Error("DB failure during payout")); // UPDATE referrals fails

      await expect(
        processReferralPayout(JOB_ID, REFEREE, "100.0000000")
      ).rejects.toThrow("DB failure during payout");

      expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe("getReferralStats", () => {
    it("should return summary counts, earned bonuses, and lists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_referrals: "5",
            paid_referrals: "3",
            pending_referrals: "2",
            total_earned_xlm: "15.5000000",
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "ref-1",
            referee_address: REFEREE,
            status: "paid",
            payout_amount: "5.0000000",
            paid_at: "2026-01-01T00:00:00Z",
            created_at: "2025-12-01T00:00:00Z",
            referee_display_name: "Alice",
            job_title: "Build Website",
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "payout-1",
            referee_address: REFEREE,
            job_id: JOB_ID,
            amount_xlm: "5.0000000",
            contract_tx_hash: "hash-1",
            created_at: "2026-01-01T00:00:00Z",
            job_title: "Build Website",
          },
        ],
      });

      const stats = await getReferralStats(REFERRER);

      expect(stats.totalReferrals).toBe(5);
      expect(stats.paidReferrals).toBe(3);
      expect(stats.pendingReferrals).toBe(2);
      expect(stats.totalEarnedXlm).toBe("15.5000000");
      expect(stats.referees).toHaveLength(1);
      expect(stats.payouts).toHaveLength(1);
    });

    it("should handle empty stats correctly", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_referrals: "0",
            paid_referrals: "0",
            pending_referrals: "0",
            total_earned_xlm: "0",
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const stats = await getReferralStats(REFERRER);

      expect(stats.totalReferrals).toBe(0);
      expect(stats.totalEarnedXlm).toBe("0.0000000");
      expect(stats.referees).toEqual([]);
      expect(stats.payouts).toEqual([]);
    });
  });
});
