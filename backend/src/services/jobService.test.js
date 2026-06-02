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
});
