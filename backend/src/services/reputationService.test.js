"use strict";

/**
 * src/services/reputationService.test.js — Issue #1561
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const pool = require("../db/pool");
const {
  computeScore,
  scoreLabel,
  getReputation,
  recalculateReputation,
  scheduleReputationRecalc,
  WEIGHTS,
} = require("./reputationService");

const USER = "G" + "A".repeat(55);

const emptyMetrics = {
  completedJobs: 0,
  engagedJobs: 0,
  disputedJobs: 0,
  avgResponseHours: null,
  avgRating: null,
  ratingCount: 0,
  referralTotal: 0,
  referralConverted: 0,
};

function metricsRow(overrides = {}) {
  return {
    completed_jobs: 0,
    engaged_jobs: 0,
    disputed_jobs: 0,
    msg_response_hours: null,
    app_response_hours: null,
    avg_rating: null,
    rating_count: 0,
    referral_total: 0,
    referral_converted: 0,
    ...overrides,
  };
}

function storedRow(overrides = {}) {
  return {
    user_id: USER,
    score: "72.50",
    completed_jobs: 5,
    dispute_rate: "0.1000",
    avg_response_hours: "4.00",
    avg_rating: "4.50",
    rating_count: 4,
    referral_quality: "0.5000",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("reputationService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("computeScore", () => {
    it("weights sum to 100", () => {
      expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("gives a brand-new user neutral half credit on every signal except completed jobs", () => {
      const { score, disputeRate, referralQuality } = computeScore(emptyMetrics);
      expect(score).toBe(35); // (25 + 15 + 20 + 10) / 2
      expect(disputeRate).toBe(0);
      expect(referralQuality).toBe(0);
    });

    it("scores a perfect track record at 100", () => {
      const { score } = computeScore({
        completedJobs: 25,
        engagedJobs: 25,
        disputedJobs: 0,
        avgResponseHours: 0,
        avgRating: 5,
        ratingCount: 10,
        referralTotal: 4,
        referralConverted: 4,
      });
      expect(score).toBe(100);
    });

    it("penalises disputes and slow responses", () => {
      const good = computeScore({ ...emptyMetrics, completedJobs: 5, engagedJobs: 5, avgResponseHours: 2 });
      const bad = computeScore({
        ...emptyMetrics,
        completedJobs: 5,
        engagedJobs: 5,
        disputedJobs: 3,
        avgResponseHours: 100,
      });
      expect(bad.score).toBeLessThan(good.score);
      expect(bad.disputeRate).toBeCloseTo(0.6);
    });

    it("blends a single rating toward neutral", () => {
      const one = computeScore({ ...emptyMetrics, avgRating: 1, ratingCount: 1 });
      const many = computeScore({ ...emptyMetrics, avgRating: 1, ratingCount: 10 });
      expect(one.score).toBeGreaterThan(many.score);
    });

    it("never leaves the 0–100 range", () => {
      const { score } = computeScore({ ...emptyMetrics, completedJobs: 1e6, avgResponseHours: -5, avgRating: 99, ratingCount: 99 });
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("scoreLabel", () => {
    it("labels users with no history as New", () => {
      expect(scoreLabel(90)).toBe("New");
    });

    it.each([
      [90, "Excellent"],
      [75, "Trusted"],
      [55, "Established"],
      [20, "Building"],
    ])("score %p → %p", (score, label) => {
      expect(scoreLabel(score, { completedJobs: 1 })).toBe(label);
    });
  });

  describe("recalculateReputation", () => {
    it("computes metrics and upserts the row", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [metricsRow({ completed_jobs: 4, engaged_jobs: 4, rating_count: 2, avg_rating: "5" })] })
        .mockResolvedValueOnce({ rows: [storedRow()] });

      const result = await recalculateReputation(USER);

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[1][0]).toMatch(/INSERT INTO reputation_scores/);
      expect(pool.query.mock.calls[1][1][0]).toBe(USER);
      expect(result).toMatchObject({ userId: USER, score: 72.5, scoreBps: 7250, label: "Trusted" });
    });

    it("returns null when the user has no profile (FK violation)", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [metricsRow()] })
        .mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));

      await expect(recalculateReputation(USER)).resolves.toBeNull();
    });

    it("rejects invalid keys", async () => {
      await expect(recalculateReputation("nope")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("getReputation", () => {
    it("returns the stored row without recomputing when fresh", async () => {
      pool.query.mockResolvedValueOnce({ rows: [storedRow()] });

      const result = await getReputation(USER);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(result.avgResponseHours).toBe(4);
      expect(result.disputeRate).toBe(0.1);
    });

    it("computes lazily on first access", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [metricsRow()] })
        .mockResolvedValueOnce({ rows: [storedRow({ completed_jobs: 0, rating_count: 0, score: "35.00" })] });

      const result = await getReputation(USER);

      expect(result).toMatchObject({ score: 35, label: "New" });
    });
  });

  describe("scheduleReputationRecalc", () => {
    it("ignores invalid keys and dedupes", async () => {
      pool.query.mockResolvedValue({ rows: [metricsRow()] });

      scheduleReputationRecalc(USER, USER, null, "bad");
      await new Promise((r) => setImmediate(r));

      // one metrics query + one upsert for the single valid, de-duplicated key
      expect(pool.query.mock.calls.filter(([sql]) => /WITH engaged_jobs/.test(sql))).toHaveLength(1);
    });
  });
});
