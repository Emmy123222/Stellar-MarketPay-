/**
 * Test suite for job recommendations filtering
 * Verifies that applied jobs are excluded from recommendations
 */
/* eslint-env jest */
"use strict";

const pool = require("../db/pool");
const { getRecommendedJobs } = require("./jobService");

// Mock pool.query
jest.mock("../db/pool");

describe("Job Recommendations", () => {
  const freelancerAddress = "GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC";
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should exclude jobs the freelancer has already applied to", async () => {
    // Mock profile with skills
    pool.query
      .mockResolvedValueOnce({
        rows: [{ skills: ["JavaScript", "React"] }],
      })
      // Mock jobs query - should exclude applied jobs
      .mockResolvedValueOnce({
        rows: [
          {
            id: "job-1",
            title: "React Developer",
            status: "open",
            skills: ["React", "JavaScript"],
            created_at: new Date(),
          },
          {
            id: "job-2",
            title: "Frontend Engineer",
            status: "open",
            skills: ["React", "TypeScript"],
            created_at: new Date(),
          },
        ],
      });

    const recommendations = await getRecommendedJobs(freelancerAddress);

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].id).toBe("job-1");
    expect(recommendations[1].id).toBe("job-2");

    // Verify the query includes NOT EXISTS clause
    const lastCall = pool.query.mock.calls[1];
    expect(lastCall[0]).toContain("NOT EXISTS");
    expect(lastCall[0]).toContain("applications");
    expect(lastCall[1]).toContain(freelancerAddress);
  });

  test("should return jobs when freelancer has no skills", async () => {
    // Mock profile with no skills
    pool.query
      .mockResolvedValueOnce({
        rows: [{ skills: [] }],
      })
      // Mock jobs query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "job-1",
            title: "Any Job",
            status: "open",
            created_at: new Date(),
          },
        ],
      });

    const recommendations = await getRecommendedJobs(freelancerAddress);

    expect(recommendations).toHaveLength(1);
    
    // Verify the query still excludes applied jobs
    const lastCall = pool.query.mock.calls[1];
    expect(lastCall[0]).toContain("NOT EXISTS");
    expect(lastCall[0]).toContain("applications");
  });

  test("should return empty array when all matching jobs have been applied to", async () => {
    // Mock profile with skills
    pool.query
      .mockResolvedValueOnce({
        rows: [{ skills: ["Python"] }],
      })
      // Mock jobs query - no results because all were filtered out
      .mockResolvedValueOnce({
        rows: [],
      });

    const recommendations = await getRecommendedJobs(freelancerAddress);

    expect(recommendations).toHaveLength(0);
  });

  test("should limit results to 5 jobs", async () => {
    // Mock profile with skills
    pool.query
      .mockResolvedValueOnce({
        rows: [{ skills: ["Node.js"] }],
      })
      // Mock jobs query with exactly 5 results
      .mockResolvedValueOnce({
        rows: Array(5).fill(null).map((_, i) => ({
          id: `job-${i}`,
          title: `Job ${i}`,
          status: "open",
          skills: ["Node.js"],
          created_at: new Date(),
        })),
      });

    const recommendations = await getRecommendedJobs(freelancerAddress);

    expect(recommendations).toHaveLength(5);
    
    // Verify LIMIT 5 in query
    const lastCall = pool.query.mock.calls[1];
    expect(lastCall[0]).toContain("LIMIT 5");
  });
});
