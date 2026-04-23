jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const {
  getProfile,
  upsertProfile,
  updateAvailability,
  getProfileStats,
  getResponseTime,
  MAX_PORTFOLIO_ITEMS,
} = require("./profileService");

describe("profileService", () => {
  const publicKey = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("upsertProfile", () => {
    it("accepts valid portfolioItems", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            public_key: publicKey,
            display_name: "Jane Doe",
            bio: "Freelancer bio",
            skills: ["React", "Stellar"],
            portfolio_items: [
              { title: "Repo", url: "https://github.com/example/repo", type: "github" },
              { title: "Launch", url: "https://example.com", type: "live" },
              { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
            ],
            availability: {
              status: "available",
              availableFrom: "2026-05-01T00:00:00.000Z",
            },
            role: "freelancer",
            completed_jobs: 0,
            total_earned_xlm: "0.0000000",
            rating: null,
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        ],
      });

      const profile = await upsertProfile({
        publicKey,
        role: "freelancer",
        availability: {
          status: "available",
          availableFrom: "2026-05-01",
        },
        portfolioItems: [
          { title: "Repo", url: "https://github.com/example/repo", type: "github" },
          { title: "Launch", url: "https://example.com", type: "live" },
          { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
        ],
      });

      expect(profile.portfolioItems).toHaveLength(3);
      expect(profile.availability).toEqual({
        status: "available",
        availableFrom: "2026-05-01T00:00:00.000Z",
      });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(JSON.parse(pool.query.mock.calls[0][1][4])).toEqual(
        [
          { title: "Repo", url: "https://github.com/example/repo", type: "github" },
          { title: "Launch", url: "https://example.com", type: "live" },
          { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
        ]
      );
    });

    it("rejects invalid portfolio item type", async () => {
      await expect(
        upsertProfile({
          publicKey,
          role: "freelancer",
          portfolioItems: [
            { title: "Repo", url: "https://github.com/example/repo", type: "gitlab" },
          ],
        })
      ).rejects.toThrow("Portfolio item type must be one of: github, live, stellar_tx");

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("rejects more than ten portfolio items", async () => {
      await expect(
        upsertProfile({
          publicKey,
          role: "freelancer",
          portfolioItems: Array.from({ length: MAX_PORTFOLIO_ITEMS + 1 }, (_, index) => ({
            title: `Work ${index + 1}`,
            url: `https://example.com/${index + 1}`,
            type: "live",
          })),
        })
      ).rejects.toThrow(`portfolioItems cannot exceed ${MAX_PORTFOLIO_ITEMS} items`);

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("rejects invalid availability status", async () => {
      await expect(
        upsertProfile({
          publicKey,
          role: "freelancer",
          availability: {
            status: "soon",
            availableFrom: "2026-05-01",
          },
        })
      ).rejects.toThrow("Availability status must be one of: available, busy, unavailable");

      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe("getProfile", () => {
    it("returns portfolioItems from the profile row", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            public_key: publicKey,
            display_name: "Jane Doe",
            bio: "Freelancer bio",
            skills: ["React"],
            portfolio_items: [
              { title: "Repo", url: "https://github.com/example/repo", type: "github" },
            ],
            availability: {
              status: "busy",
              availableFrom: "2026-06-01T00:00:00.000Z",
              availableUntil: "2026-06-30T00:00:00.000Z",
            },
            role: "freelancer",
            completed_jobs: 3,
            total_earned_xlm: "150.0000000",
            avg_rating: "4.80",
            rating_count: 2,
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        ],
      });

      const profile = await getProfile(publicKey);

      expect(profile.portfolioItems).toEqual([
        { title: "Repo", url: "https://github.com/example/repo", type: "github" },
      ]);
      expect(profile.availability).toEqual({
        status: "busy",
        availableFrom: "2026-06-01T00:00:00.000Z",
        availableUntil: "2026-06-30T00:00:00.000Z",
      });
      expect(profile.rating).toBe(4.8);
      expect(profile.ratingCount).toBe(2);
    });
  });

  describe("updateAvailability", () => {
    it("persists valid availability updates", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            public_key: publicKey,
            display_name: "Jane Doe",
            bio: null,
            skills: [],
            portfolio_items: [],
            availability: {
              status: "busy",
              availableFrom: "2026-07-01T00:00:00.000Z",
              availableUntil: "2026-07-10T00:00:00.000Z",
            },
            role: "freelancer",
            completed_jobs: 0,
            total_earned_xlm: "0.0000000",
            rating: null,
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        ],
      });

      const profile = await updateAvailability(publicKey, {
        status: "busy",
        availableFrom: "2026-07-01",
        availableUntil: "2026-07-10",
      });

      expect(profile.availability).toEqual({
        status: "busy",
        availableFrom: "2026-07-01T00:00:00.000Z",
        availableUntil: "2026-07-10T00:00:00.000Z",
      });
    });
  });

  describe("getProfileStats", () => {
    it("returns zero stats when no applications exist", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_applications: 0, accepted_applications: 0 }],
      });

      const stats = await getProfileStats(publicKey);
      expect(stats).toEqual({
        totalApplications: 0,
        acceptedApplications: 0,
        successRate: 0,
      });
    });

    it("calculates success rate correctly", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_applications: 4, accepted_applications: 3 }],
      });

      const stats = await getProfileStats(publicKey);
      expect(stats.successRate).toBe(75);
    });
  });

  describe("getResponseTime", () => {
    it("returns null when no data is available", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ avg_days: null }],
      });

      const result = await getResponseTime(publicKey);
      expect(result.averageDays).toBeNull();
    });

    it("returns formatted average days", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ avg_days: "2.4567" }],
      });

      const result = await getResponseTime(publicKey);
      expect(result.averageDays).toBe(2.5);
    });
  });
});
