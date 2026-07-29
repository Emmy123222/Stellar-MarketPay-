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

  describe("createJob", () => {
    it("creates and stores a valid job", async () => {
      const job = await createJob({
        title: "Build a decentralized app",
        description:
          "Looking for a full-stack developer to build a dApp on Stellar.",
        budget: "500",
        category: "Smart Contracts",
        skills: ["Rust", "Soroban"],
        deadline: "2026-12-31T23:59:59Z",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      expect(job.title).toBe("Build a decentralized app");
      expect(job.budget).toBe("500.0000000");
      expect(job.status).toBe("open");
      expect(job.clientAddress).toBe(validClientAddress);
      expect(pool.jobs.has(job.id)).toBe(true);
    });

    it("rejects a short title", async () => {
      await expect(
        createJob({
          title: "Short",
          description:
            "Looking for a full-stack developer to build a dApp on Stellar.",
          budget: "500",
          category: "Smart Contracts",
          clientAddress: validClientAddress,
          currency: "XLM",
        }),
      ).rejects.toThrow("Title must be at least 10 characters");
    });

    it("rejects invalid budgets", async () => {
      const base = {
        title: "Build a decentralized app",
        description:
          "Looking for a full-stack developer to build a dApp on Stellar.",
        category: "Smart Contracts",
        clientAddress: validClientAddress,
        currency: "XLM",
      };

      await expect(createJob({ ...base, budget: "-100" })).rejects.toThrow(
        "Budget must be a positive number",
      );
      await expect(createJob({ ...base, budget: "abc" })).rejects.toThrow(
        "Budget must be a positive number",
      );
    });
  });

  describe("getJob", () => {
    it("throws when the job does not exist", async () => {
      await expect(getJob("missing-job")).rejects.toThrow("Job not found");
      try {
        await getJob("missing-job");
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });

  describe("listJobs", () => {
    beforeEach(async () => {
      await createJob({
        title: "Open Job 1 long enough",
        description:
          "This is an open job description that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const inProgressJob = await createJob({
        title: "In Progress Job long enough",
        description:
          "This is an in progress job description that is long enough to pass validation.",
        budget: "200",
        category: "Backend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });
      pool.jobs.get(inProgressJob.id).status = "in_progress";

      await createJob({
        title: "Open Job 2 long enough",
        description:
          "This is another open job description that is long enough to pass validation.",
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
      expect(
        frontendJobs.every((job) => job.category === "Frontend Development"),
      ).toBe(true);
    });

    it("returns has_more when there are more results", async () => {
      const { jobs, nextCursor, hasMore } = await listJobs({ limit: 1 });
      expect(jobs.length).toBe(1);
      expect(hasMore).toBe(true);
      expect(nextCursor).toBeTruthy();
    });

    it("paginates with cursor and maintains consistent ordering", async () => {
      const page1 = await listJobs({ limit: 2 });
      expect(page1.jobs.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await listJobs({ limit: 2, cursor: page1.nextCursor });
      expect(page2.jobs.length).toBeGreaterThanOrEqual(1);

      const ids1 = page1.jobs.map((j) => j.id);
      const ids2 = page2.jobs.map((j) => j.id);
      const overlap = ids1.filter((id) => ids2.includes(id));
      expect(overlap).toEqual([]);
    });

    it("returns has_more false on last page", async () => {
      const { hasMore } = await listJobs({ limit: 100 });
      expect(hasMore).toBe(false);
    });
  });

  describe("listJobsByClient and updateJobStatus", () => {
    it("returns jobs for a client and updates status", async () => {
      const otherClientAddress =
        "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

      await createJob({
        title: "Job from client A long enough",
        description:
          "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      await createJob({
        title: "Job from client B long enough",
        description:
          "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Backend Development",
        clientAddress: otherClientAddress,
        currency: "XLM",
      });

      const clientAJobs = await listJobsByClient(validClientAddress);
      expect(clientAJobs.length).toBe(1);
      expect(clientAJobs[0].clientAddress).toBe(validClientAddress);

      const job = await createJob({
        title: "Job to be updated",
        description:
          "Description format that is long enough to pass validation.",
        budget: "100",
        category: "Frontend Development",
        clientAddress: validClientAddress,
        currency: "XLM",
      });

      const updatedJob = await updateJobStatus(job.id, "cancelled");
      expect(updatedJob.status).toBe("cancelled");
      await expect(updateJobStatus(job.id, "invalid_status")).rejects.toThrow(
        "Invalid status",
      );
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
