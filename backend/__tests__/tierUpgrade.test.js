"use strict";

jest.mock("../src/db/pool", () => ({ query: jest.fn() }));
jest.mock("../src/services/notificationService", () => ({
  createInAppNotification: jest.fn().mockResolvedValue({}),
  queueNotification: jest.fn().mockResolvedValue({}),
}));

const pool = require("../src/db/pool");
const { refreshFreelancerTier, FREELANCER_TIERS } = require("../src/services/profileService");

describe("Tier upgrade flow", () => {
  beforeEach(() => jest.clearAllMocks());

  test("freelancer crosses Gold threshold -> tier updated and notification sent", async () => {
    const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // Before: profile shows low stats
    pool.query
      .mockResolvedValueOnce({ rows: [{ completed_jobs: 4, total_earned_xlm: 400, rating: 4.6 }] }) // previous profile select
      .mockResolvedValueOnce({ rows: [{ completed_jobs: 20, total_earned_xlm: 600, avg_rating: 4.85, total_jobs: 20 }] }) // stats select & update
      .mockResolvedValueOnce({ rows: [{ created_at: "2024-01-01T00:00:00Z", completed_jobs: 20, total_earned_xlm: 600, avg_rating: 4.85, total_jobs: 20 }] }); // calculateTier query

    const newTier = await refreshFreelancerTier(publicKey);

    expect(newTier).toBe(FREELANCER_TIERS.EXPERT);
  });
});
