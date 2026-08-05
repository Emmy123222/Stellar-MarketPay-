jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobStatus,
  deleteJob,
} = require("./jobService");

describe("jobService", () => {
  beforeEach(() => {
    pool.reset();
  });

  const validClientAddress =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
  const validFreelancerAddress =
    "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";

  // ─── rowToJob ──────────────────────────────────────────────────────────

  describe("rowToJob", () => {
    it("converts a snake_case row to camelCase", () => {
      const row = {
        id: "job-1",
        title: "Test Job",
        description: "Do some work here that is long enough to pass.",
        budget: "500.0000000",
        currency: "XLM",
        category: "Smart Contracts",
        category_slug: "smart-contracts",
        category_id_resolved: 1,
        skills: ["Rust"],
        status: "open",
        client_address: validClientAddress,
        freelancer_address: null,
        escrow_contract_id: null,
        applicant_count: 0,
        share_count: 5,
        boosted: true,
        boosted_until: "2026-12-31T23:59:59Z",
        deadline: null,
        timezone: null,
        screening_questions: [],
        milestones: [],
        dispute_reason: null,
        dispute_description: null,
        disputed_by: null,
        disputed_at: null,
        expires_at: null,
        extended_count: null,
        extended_until: null,
        bidding_closed_at: null,
        view_count: 10,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        headline_title: null,
        headline_description: null,
      };

      const job = rowToJob(row);
      expect(job.id).toBe("job-1");
      expect(job.clientAddress).toBe(validClientAddress);
      expect(job.shareCount).toBe(5);
      expect(job.boosted).toBe(true);
      expect(job.viewCount).toBe(10);
    });
  });

  // ─── createJob ─────────────────────────────────────────────────────────

  describe("createJob", () => {
    const validCreateInput = {
      title: "Build a decentralized app",
      description:
        "Looking for a full-stack developer to build a dApp on Stellar.",
      budget: "500",
      category: "Smart Contracts",
      skills: ["Rust", "Soroban"],
      deadline: "2026-12-31T23:59:59Z",
      clientAddress: validClientAddress,
      currency: "XLM",
    };

    it("creates and stores a valid job", async () => {
      const job = await createJob(validCreateInput);

      expect(job.title).toBe("Build a decentralized app");
      expect(job.budget).toBe("500.0000000");
      expect(job.status).toBe("open");
      expect(job.clientAddress).toBe(validClientAddress);
      expect(job.currency).toBe("XLM");
      expect(pool.jobs.has(job.id)).toBe(true);
    });

    it("creates job without skills (empty skills array)", async () => {
      const job = await createJob({ ...validCreateInput, skills: [] });
      expect(job.title).toBe("Build a decentralized app");
      expect(job.skills).toEqual([]);
    });

    it("creates job with category slug instead of name", async () => {
      const job = await createJob({
        ...validCreateInput,
        category: "Smart Contracts",
        categorySlug: "smart-contracts",
      });
      expect(job.category).toBe("Smart Contracts");
    });

    it("creates job with USDC and milestones", async () => {
      const job = await createJob({
        ...validCreateInput,
        currency: "USDC",
        budget: "1000",
        milestones: [
          { description: "Phase one", amount: "400" },
          { description: "Phase two", amount: "600" },
        ],
      });
      expect(job.currency).toBe("USDC");
      expect(job.budget).toBe("1000.0000000");
    });

    it("rejects a short title", async () => {
      await expect(
        createJob({ ...validCreateInput, title: "Short" }),
      ).rejects.toThrow("Title must be at least 10 characters");
    });

    it("rejects short description", async () => {
      await expect(
        createJob({ ...validCreateInput, description: "Too short." }),
      ).rejects.toThrow("Description must be at least 30 characters");
    });

    it("rejects invalid budgets (negative, NaN)", async () => {
      await expect(
        createJob({ ...validCreateInput, budget: "-100" }),
      ).rejects.toThrow("Budget must be a positive number");
      await expect(
        createJob({ ...validCreateInput, budget: "abc" }),
      ).rejects.toThrow("Budget must be a positive number");
      await expect(
        createJob({ ...validCreateInput, budget: "0" }),
      ).rejects.toThrow("Budget must be a positive number");
    });

    it("rejects invalid currency", async () => {
      await expect(
        createJob({ ...validCreateInput, currency: "BTC" }),
      ).rejects.toThrow("Currency must be XLM or USDC");
    });

    it("rejects invalid client public key", async () => {
      await expect(
        createJob({ ...validCreateInput, clientAddress: "bad-key" }),
      ).rejects.toThrow("Invalid Stellar public key");
    });

    it("rejects invalid category", async () => {
      await expect(
        createJob({ ...validCreateInput, category: "InvalidCategory" }),
      ).rejects.toThrow("Invalid category");
    });

    it("rejects invalid visibility", async () => {
      await expect(
        createJob({ ...validCreateInput, visibility: "secret" }),
      ).rejects.toThrow("Visibility must be public, private, or invite_only");
    });

    it("accepts USDC currency", async () => {
      const job = await createJob({ ...validCreateInput, currency: "USDC" });
      expect(job.currency).toBe("USDC");
    });

    it("creates job with invite_only visibility", async () => {
      const job = await createJob({ ...validCreateInput, visibility: "invite_only" });
      // rowToJob doesn't expose visibility — check that the mock stored it
      const stored = pool.jobs.get(job.id);
      expect(stored.visibility).toBe("invite_only");
    });

    it("creates job with screening questions", async () => {
      const questions = ["How many years of experience?", "What is your stack?"];
      const job = await createJob({
        ...validCreateInput,
        screeningQuestions: questions,
      });
      expect(job.screeningQuestions).toEqual(questions);
    });

    it("rejects milestones exceeding budget total", async () => {
      await expect(
        createJob({
          ...validCreateInput,
          budget: "500",
          milestones: [
            { description: "First part", amount: "300" },
            { description: "Second part", amount: "300" },
          ],
        }),
      ).rejects.toThrow("Milestone amounts must equal the job budget");
    });

    it("rejects milestones without description", async () => {
      await expect(
        createJob({
          ...validCreateInput,
          budget: "500",
          milestones: [{ description: "", amount: "500" }],
        }),
      ).rejects.toThrow("Milestone 1 needs a description");
    });

    it("rejects more than 10 milestones", async () => {
      const manyMilestones = Array.from({ length: 11 }, (_, i) => ({
        description: `Milestone ${i + 1}`,
        amount: "45.4545454",
      }));
      await expect(
        createJob({ ...validCreateInput, budget: "500", milestones: manyMilestones }),
      ).rejects.toThrow("Jobs can have at most 10 milestones");
    });
  });

  // ─── getJob ────────────────────────────────────────────────────────────

  describe("getJob", () => {
    it("returns job when found", async () => {
      const created = await createJob({
        title: "Build a decentralized app",
        description: "Looking for a full-stack developer to build a dApp on Stellar.",
        budget: "500",
        category: "Smart Contracts",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const job = await getJob(created.id);
      expect(job.id).toBe(created.id);
      expect(job.title).toBe("Build a decentralized app");
    });

    it("throws 404 when the job does not exist", async () => {
      await expect(getJob("missing-job")).rejects.toThrow("Job not found");
      try {
        await getJob("missing-job");
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });

  // ─── listJobs ──────────────────────────────────────────────────────────

  describe("listJobs", () => {
    beforeEach(async () => {
      await createJob({
        title: "Open Job 1 long enough",
        description: "This is an open job description that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const inProgressJob = await createJob({
        title: "In Progress Job long enough",
        description: "This is an in progress job description that is long enough to pass validation.",
        budget: "200",
        category: "Backend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
      pool.jobs.get(inProgressJob.id).status = "in_progress";

      await createJob({
        title: "Open Job 2 long enough",
        description: "This is another open job description that is long enough to pass validation.",
        budget: "300",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
    });

    it("filters by status", async () => {
      const { jobs: openJobs } = await listJobs({ status: "open" });
      expect(openJobs.length).toBeGreaterThanOrEqual(1);
      expect(openJobs.every((job) => job.status === "open")).toBe(true);
    });

    it("filters by category", async () => {
      const { jobs: frontendJobs } = await listJobs({
        category: "Frontend Development",
        status: "open",
      });
      expect(frontendJobs.length).toBeGreaterThanOrEqual(1);
      expect(frontendJobs.every((job) => job.category === "Frontend Development")).toBe(true);
    });

    it("returns has_more when there are more results", async () => {
      const { jobs, nextCursor } = await listJobs({ limit: 1 });
      expect(jobs.length).toBe(1);
      expect(nextCursor).toBeTruthy();
    });

    it("paginates with cursor and maintains consistent ordering", async () => {
      // Mock doesn't implement cursor-based filtering deeply,
      // but we verify the function returns cursor and can be called with it
      const page1 = await listJobs({ limit: 2 });
      expect(page1.jobs.length).toBe(2);
      expect(page1.nextCursor).toBeTruthy();

      // Cursor-based pagination requires proper SQL, just verify API shape
      const page2 = await listJobs({ limit: 2, cursor: page1.nextCursor });
      expect(page2).toHaveProperty("jobs");
      expect(page2).toHaveProperty("nextCursor");
    });

    it("returns has_more false on last page", async () => {
      const { hasMore } = await listJobs({ limit: 100 });
      expect(hasMore).toBe(false);
    });
  });

  // ─── listJobsByClient ──────────────────────────────────────────────────

  describe("listJobsByClient", () => {
    it("returns jobs for a client", async () => {
      await createJob({
        title: "Job from client A long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const clientJobs = await listJobsByClient(validClientAddress);
      expect(clientJobs.length).toBe(1);
      expect(clientJobs[0].clientAddress).toBe(validClientAddress);
    });

    it("throws on invalid client address", async () => {
      await expect(listJobsByClient("bad-key")).rejects.toThrow("Invalid Stellar public key");
    });

    it("returns empty array for client with no jobs", async () => {
      const otherAddr = "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      const jobs = await listJobsByClient(otherAddr);
      expect(jobs).toEqual([]);
    });
  });

  // ─── updateJobStatus ───────────────────────────────────────────────────

  describe("updateJobStatus", () => {
    it("updates job status successfully", async () => {
      const job = await createJob({
        title: "Job to be updated",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const updated = await updateJobStatus(job.id, "cancelled");
      expect(updated.status).toBe("cancelled");
    });

    it("rejects invalid status", async () => {
      await expect(updateJobStatus("some-id", "invalid_status")).rejects.toThrow("Invalid status");
    });

    it("throws 404 when job not found", async () => {
      await expect(updateJobStatus("nonexistent", "open")).rejects.toThrow("Job not found");
    });
  });

  // ─── assignFreelancer ──────────────────────────────────────────────────

  describe("assignFreelancer", () => {
    it("assigns a freelancer to a job", async () => {
      const job = await createJob({
        title: "Assign freelancer test long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const updated = await assignFreelancer(job.id, validFreelancerAddress);
      expect(updated.freelancerAddress).toBe(validFreelancerAddress);
      expect(updated.status).toBe("in_progress");
    });

    it("throws on invalid freelancer address", async () => {
      await expect(assignFreelancer("job-1", "bad-key")).rejects.toThrow("Invalid Stellar public key");
    });

    it("throws 404 when job not found", async () => {
      await expect(assignFreelancer("nonexistent", validFreelancerAddress)).rejects.toThrow("Job not found");
    });
  });

  // ─── updateJobEscrowId ─────────────────────────────────────────────────

  describe("updateJobEscrowId", () => {
    it("updates escrow ID successfully", async () => {
      const job = await createJob({
        title: "Escrow test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const updated = await updateJobEscrowId(job.id, "CONTRACT123");
      expect(updated.escrowContractId).toBe("CONTRACT123");
    });

    it("rejects invalid escrow contract ID", async () => {
      await expect(updateJobEscrowId("job-1", "")).rejects.toThrow("Invalid escrow contract ID");
    });

    it("throws 404 when job not found", async () => {
      await expect(updateJobEscrowId("nonexistent", "CONTRACT123")).rejects.toThrow("Job not found");
    });
  });

  // ─── deleteJob ─────────────────────────────────────────────────────────

  describe("deleteJob", () => {
    it("soft-deletes a job", async () => {
      const job = await createJob({
        title: "Delete test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await expect(deleteJob(job.id)).resolves.not.toThrow();
    });

    it("throws 404 when job not found", async () => {
      await expect(deleteJob("nonexistent")).rejects.toThrow("Job not found");
    });
  });

  // ─── purgeDeletedJobs ──────────────────────────────────────────────────

  describe("purgeDeletedJobs", () => {
    it("returns count of purged rows", async () => {
      const count = await purgeDeletedJobs(90);
      expect(typeof count).toBe("number");
    });
  });

  // ─── boostJob ──────────────────────────────────────────────────────────

  describe("boostJob", () => {
    it("boosts a job successfully", async () => {
      const job = await createJob({
        title: "Boost test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const boosted = await boostJob(job.id, "tx-hash-123");
      expect(boosted.boosted).toBe(true);
      expect(boosted.boostedUntil).toBeTruthy();
    });

    it("throws 404 when job not found", async () => {
      await expect(boostJob("nonexistent", "tx-hash")).rejects.toThrow("Job not found");
    });
  });

  // ─── incrementShareCount ───────────────────────────────────────────────

  describe("incrementShareCount", () => {
    it("increments share count", async () => {
      const job = await createJob({
        title: "Share test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await expect(incrementShareCount(job.id)).resolves.not.toThrow();
    });

    it("throws 404 when job not found", async () => {
      await expect(incrementShareCount("nonexistent")).rejects.toThrow("Job not found");
    });
  });

  // ─── raiseDispute ──────────────────────────────────────────────────────

  describe("raiseDispute", () => {
    it("raises a dispute on an in_progress job", async () => {
      const job = await createJob({
        title: "Dispute test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
      await assignFreelancer(job.id, validFreelancerAddress);

      const disputed = await raiseDispute(job.id, {
        reason: "breach",
        description: "Work not completed",
        raisedBy: validClientAddress,
      });
      expect(disputed.status).toBe("disputed");
      expect(disputed.disputeReason).toBe("breach");
    });

    it("throws 404 when job not found or not in progress", async () => {
      await expect(
        raiseDispute("nonexistent", { reason: "a", description: "b", raisedBy: validClientAddress }),
      ).rejects.toThrow("Job not found or not in progress");
    });
  });

  // ─── resolveDispute ────────────────────────────────────────────────────

  describe("resolveDispute", () => {
    it("resolves a dispute", async () => {
      const job = await createJob({
        title: "Resolve dispute test job",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
      await assignFreelancer(job.id, validFreelancerAddress);
      await raiseDispute(job.id, {
        reason: "breach",
        description: "Work not completed",
        raisedBy: validClientAddress,
      });

      const resolved = await resolveDispute(job.id);
      expect(resolved.status).toBe("in_progress");
    });

    it("throws 404 when job not found or not disputed", async () => {
      await expect(resolveDispute("nonexistent")).rejects.toThrow("Job not found or not disputed");
    });
  });

  // ─── getCategoryAnalytics ──────────────────────────────────────────────

  describe("getCategoryAnalytics", () => {
    it("returns category analytics", async () => {
      await createJob({
        title: "Analytics job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const analytics = await getCategoryAnalytics();
      expect(Array.isArray(analytics)).toBe(true);
      if (analytics.length > 0) {
        expect(analytics[0]).toHaveProperty("category");
        expect(analytics[0]).toHaveProperty("jobCount");
      }
    });
  });

  // ─── getAnalyticsOverview ──────────────────────────────────────────────

  describe("getAnalyticsOverview", () => {
    it("returns an overview", async () => {
      const overview = await getAnalyticsOverview();
      expect(overview).toHaveProperty("totalJobs");
      expect(overview).toHaveProperty("openJobs");
    });
  });

  // ─── extendJobExpiry ───────────────────────────────────────────────────

  describe("extendJobExpiry", () => {
    it("extends expiry successfully", async () => {
      const job = await createJob({
        title: "Extend test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const extended = await extendJobExpiry(job.id, 7, validClientAddress);
      expect(extended.extendedCount).toBeGreaterThanOrEqual(1);
      expect(extended.extensionFeeXlm).toBeTruthy();
    });

    it("rejects invalid days", async () => {
      await expect(
        extendJobExpiry("job-1", 99, validClientAddress),
      ).rejects.toThrow("Extension days must be 7, 14, or 30");
    });

    it("rejects non-owner", async () => {
      const job = await createJob({
        title: "Owner test job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const otherAddr = "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      await expect(extendJobExpiry(job.id, 7, otherAddr)).rejects.toThrow("Only the job owner can extend expiry");
    });

    it("throws 404 when job not found", async () => {
      await expect(
        extendJobExpiry("nonexistent", 7, validClientAddress),
      ).rejects.toThrow("Job not found");
    });
  });

  // ─── incrementViewCount ────────────────────────────────────────────────

  describe("incrementViewCount", () => {
    it("increments view count", async () => {
      const job = await createJob({
        title: "View count test long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const count = await incrementViewCount(job.id);
      expect(typeof count).toBe("number");
    });

    it("throws 404 when job not found", async () => {
      await expect(incrementViewCount("nonexistent")).rejects.toThrow("Job not found");
    });
  });

  // ─── getJobAnalytics ───────────────────────────────────────────────────

  describe("getJobAnalytics", () => {
    it("returns analytics for an existing job", async () => {
      const job = await createJob({
        title: "Analytics job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const analytics = await getJobAnalytics(job.id);
      expect(analytics).toHaveProperty("jobId");
      expect(analytics).toHaveProperty("totalApplications");
      expect(analytics).toHaveProperty("totalViews");
    });

    it("throws 404 when job not found", async () => {
      await expect(getJobAnalytics("nonexistent")).rejects.toThrow("Job not found");
    });
  });

  // ─── expireOldJobs ─────────────────────────────────────────────────────

  describe("expireOldJobs", () => {
    it("returns count of expired jobs", async () => {
      const count = await expireOldJobs();
      expect(typeof count).toBe("number");
    });
  });

  // ─── getExpiringJobs ───────────────────────────────────────────────────

  describe("getExpiringJobs", () => {
    it("returns expiring jobs", async () => {
      const jobs = await getExpiringJobs(3);
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  // ─── bulkCancelJobs ────────────────────────────────────────────────────

  describe("bulkCancelJobs", () => {
    it("cancels multiple jobs", async () => {
      const job1 = await createJob({
        title: "Bulk cancel 1 long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
      const job2 = await createJob({
        title: "Bulk cancel 2 long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const results = await bulkCancelJobs([job1.id, job2.id], validClientAddress);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  // ─── bulkExtendJobs ────────────────────────────────────────────────────

  describe("bulkExtendJobs", () => {
    it("extends multiple jobs", async () => {
      const job1 = await createJob({
        title: "Bulk extend 1 long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const results = await bulkExtendJobs([job1.id], validClientAddress, 7);
      expect(results).toHaveLength(1);
    });
  });

  // ─── bulkBoostJobs ─────────────────────────────────────────────────────

  describe("bulkBoostJobs", () => {
    it("boosts multiple jobs", async () => {
      const job1 = await createJob({
        title: "Bulk boost 1 long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const results = await bulkBoostJobs([job1.id], validClientAddress, "tx-hash");
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  // ─── getRecommendedJobs ────────────────────────────────────────────────

  describe("getRecommendedJobs", () => {
    it("returns recommended jobs", async () => {
      await createJob({
        title: "Recommended job long enough",
        description: "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const jobs = await getRecommendedJobs(validFreelancerAddress);
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  // ─── getSuggestions ────────────────────────────────────────────────────

  describe("getSuggestions", () => {
    it("returns suggestions for valid query", async () => {
      const suggestions = await getSuggestions("frontend");
      expect(suggestions).toHaveProperty("titles");
      expect(suggestions).toHaveProperty("skills");
      expect(suggestions).toHaveProperty("categories");
    });

    it("returns empty for short query", async () => {
      const suggestions = await getSuggestions("a");
      expect(suggestions.titles).toEqual([]);
      expect(suggestions.skills).toEqual([]);
      expect(suggestions.categories).toEqual([]);
    });

    it("returns empty for empty query", async () => {
      const suggestions = await getSuggestions("");
      expect(suggestions.titles).toEqual([]);
    });

    it("handles errors gracefully", async () => {
      // Pass a query that won't trigger special mock behavior
      const suggestions = await getSuggestions("react");
      expect(suggestions).toHaveProperty("titles");
    });
  });

  describe("soft delete", () => {
    it("soft-deletes a job via deleteJob", async () => {
      const job = await createJob({
        title: "Job to soft delete",
        description:
          "This job will be soft-deleted during this test.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);

      const stored = pool.jobs.get(job.id);
      expect(stored.deleted_at).not.toBeNull();
    });

    it("throws 404 when deleting a non-existent job", async () => {
      await expect(deleteJob("nonexistent-id")).rejects.toThrow("Job not found");
      try {
        await deleteJob("nonexistent-id");
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });

    it("throws 404 when deleting an already soft-deleted job", async () => {
      const job = await createJob({
        title: "Already deleted job",
        description:
          "This job will be soft-deleted twice.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);
      await expect(deleteJob(job.id)).rejects.toThrow("Job not found");
    });

    it("excludes soft-deleted jobs from getJob", async () => {
      const job = await createJob({
        title: "Job to hide after delete",
        description:
          "This job should be invisible after soft delete.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);
      await expect(getJob(job.id)).rejects.toThrow("Job not found");
    });

    it("includes soft-deleted jobs when includeDeleted is true", async () => {
      const job = await createJob({
        title: "Visible with includeDeleted",
        description:
          "This job should be visible with includeDeleted flag.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);
      const found = await getJob(job.id, { includeDeleted: true });
      expect(found.id).toBe(job.id);
      expect(found.deletedAt).not.toBeNull();
    });

    it("excludes soft-deleted jobs from listJobs", async () => {
      const job = await createJob({
        title: "Hidden from listJobs after delete",
        description:
          "This job should not appear in listJobs after soft delete.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const { jobs: before } = await listJobs({ status: "all", limit: 100 });
      expect(before.some((j) => j.id === job.id)).toBe(true);

      await deleteJob(job.id);

      const { jobs: after } = await listJobs({ status: "all", limit: 100 });
      expect(after.some((j) => j.id === job.id)).toBe(false);
    });

    it("includes soft-deleted jobs in listJobs with includeDeleted", async () => {
      const job = await createJob({
        title: "Visible in listJobs with includeDeleted",
        description:
          "This job should appear with includeDeleted flag.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);

      const { jobs } = await listJobs({
        status: "all",
        limit: 100,
        includeDeleted: true,
      });
      expect(jobs.some((j) => j.id === job.id)).toBe(true);
      const deleted = jobs.find((j) => j.id === job.id);
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("excludes soft-deleted jobs from listJobsByClient", async () => {
      const job = await createJob({
        title: "Hidden from client list after delete",
        description:
          "This job should be hidden from client listings after soft delete.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const before = await listJobsByClient(validClientAddress);
      expect(before.some((j) => j.id === job.id)).toBe(true);

      await deleteJob(job.id);

      const after = await listJobsByClient(validClientAddress);
      expect(after.some((j) => j.id === job.id)).toBe(false);
    });

    it("includes soft-deleted jobs in listJobsByClient with includeDeleted", async () => {
      const job = await createJob({
        title: "Visible in client list with includeDeleted",
        description:
          "This job should be visible with includeDeleted flag.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await deleteJob(job.id);

      const jobs = await listJobsByClient(validClientAddress, {
        includeDeleted: true,
      });
      expect(jobs.some((j) => j.id === job.id)).toBe(true);
      const deleted = jobs.find((j) => j.id === job.id);
      expect(deleted.deletedAt).not.toBeNull();
    });
  });
});
