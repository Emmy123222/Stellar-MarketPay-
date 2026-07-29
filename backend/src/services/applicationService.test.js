jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("./profileService", () => ({
  calculateFreelancerTier: jest.fn(() => "Newcomer"),
  isBlocked: jest.fn().mockResolvedValue(false),
}));

jest.mock("./notificationService", () => ({
  createJobNotification: jest.fn().mockResolvedValue({}),
  EVENT_TYPES: {
    APPLICATION_RECEIVED: "application_received",
    APPLICATION_ACCEPTED: "application_accepted",
    APPLICATION_REJECTED: "application_rejected",
  },
}));

const pool = require("../db/pool");
const { isBlocked } = require("./profileService");
const {
  submitApplication,
  getApplicationsForJob,
  getApplicationsForFreelancer,
  acceptApplication,
  withdrawApplication,
  closeBiddingForJob,
  revealApplicationBid,
} = require("./applicationService");
const { createJob } = require("./jobService");

describe("applicationService", () => {
  const validClientAddress =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
  const validFreelancerAddress =
    "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  let openJob;

  beforeEach(async () => {
    pool.reset();
    jest.clearAllMocks();
    isBlocked.mockResolvedValue(false);

    openJob = await createJob({
      title: "Build a decentralized app",
      description:
        "Looking for a full-stack developer to build a dApp on Stellar.",
      budget: "500",
      category: "Smart Contracts",
      clientAddress: validClientAddress,
      currency: "XLM",
    });
  });

  // ─── submitApplication ─────────────────────────────────────────────────

  describe("submitApplication", () => {
    const validProposal =
      "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.";

    it("creates a pending application", async () => {
      const application = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: validProposal,
        bidAmount: "450",
      });

      expect(application.jobId).toBe(openJob.id);
      expect(application.freelancerAddress).toBe(validFreelancerAddress);
      expect(application.bidAmount).toBe("450.0000000");
      expect(application.status).toBe("pending");
      expect(pool.applications.has(application.id)).toBe(true);
    });

    it("rejects applications to own jobs", async () => {
      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validClientAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("You cannot apply to your own job");
    });

    it("rejects duplicate applications", async () => {
      const appData = {
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: validProposal,
        bidAmount: "450",
      };

      await submitApplication(appData);
      await expect(submitApplication(appData)).rejects.toThrow(
        "You have already applied to this job",
      );
      expect(pool.applications.size).toBe(1);
    });

    it("rejects short proposals", async () => {
      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: "Too short",
          bidAmount: "450",
        }),
      ).rejects.toThrow("Proposal must be at least 50 characters");
    });

    it("rejects invalid bid amounts", async () => {
      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "0",
        }),
      ).rejects.toThrow("Bid must be a positive number");

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "-100",
        }),
      ).rejects.toThrow("Bid must be a positive number");
    });

    it("rejects invalid freelancer public key", async () => {
      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: "bad-key",
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("Invalid Stellar public key");
    });

    it("rejects applications to non-open jobs", async () => {
      // Set job to in_progress
      pool.jobs.get(openJob.id).status = "in_progress";

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("Job is not open for applications");
    });

    it("rejects applications to private jobs", async () => {
      pool.jobs.get(openJob.id).visibility = "private";

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("This job is private and cannot receive applications");
    });

    it("rejects applications to invite_only jobs without invitation", async () => {
      pool.jobs.get(openJob.id).visibility = "invite_only";

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("You are not invited to this job");
    });

    it("accepts invite_only applications with valid invitation", async () => {
      pool.jobs.get(openJob.id).visibility = "invite_only";
      // Add the freelancer to invited set
      pool.invitations.add(`${openJob.id}:${validFreelancerAddress}`);

      const app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: validProposal,
        bidAmount: "450",
      });
      expect(app.status).toBe("pending");
    });

    it("rejects applicants blocked by client", async () => {
      isBlocked.mockResolvedValue(true);

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("This job is not available for applications");
    });

    it("requires screening answers when job has screening questions", async () => {
      pool.jobs.get(openJob.id).screening_questions = [
        "How many years of experience?",
      ];

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
        }),
      ).rejects.toThrow("Screening answers are required for this job");
    });

    it("requires all screening questions to be answered", async () => {
      pool.jobs.get(openJob.id).screening_questions = [
        "How many years of experience?",
      ];

      await expect(
        submitApplication({
          jobId: openJob.id,
          freelancerAddress: validFreelancerAddress,
          proposal: validProposal,
          bidAmount: "450",
          screeningAnswers: { "How many years of experience?": "" },
        }),
      ).rejects.toThrow("All screening questions must be answered");
    });

    it("accepts applications with all screening answers", async () => {
      pool.jobs.get(openJob.id).screening_questions = [
        "How many years of experience?",
      ];

      const app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: validProposal,
        bidAmount: "450",
        screeningAnswers: { "How many years of experience?": "5 years" },
      });
      expect(app.status).toBe("pending");
    });
  });

  // ─── getApplicationsForJob ─────────────────────────────────────────────

  describe("getApplicationsForJob", () => {
    it("returns applications for a job", async () => {
      await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      const apps = await getApplicationsForJob(openJob.id);
      expect(apps).toHaveLength(1);
      expect(apps[0].jobId).toBe(openJob.id);
    });

    it("returns empty array for job with no applications", async () => {
      const apps = await getApplicationsForJob(openJob.id);
      expect(apps).toEqual([]);
    });

    it("filters by tier when provided", async () => {
      await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      const apps = await getApplicationsForJob(openJob.id, { tier: "Newcomer" });
      expect(apps).toHaveLength(1);
    });
  });

  // ─── getApplicationsForFreelancer ──────────────────────────────────────

  describe("getApplicationsForFreelancer", () => {
    it("returns applications for a freelancer", async () => {
      await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      const apps = await getApplicationsForFreelancer(validFreelancerAddress);
      expect(apps).toHaveLength(1);
    });

    it("rejects invalid public key", async () => {
      await expect(getApplicationsForFreelancer("bad-key")).rejects.toThrow(
        "Invalid Stellar public key",
      );
    });
  });

  // ─── acceptApplication ─────────────────────────────────────────────────

  describe("acceptApplication", () => {
    let applicationId;
    let otherApplicationId;

    beforeEach(async () => {
      const app1 = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });
      applicationId = app1.id;

      const app2 = await submitApplication({
        jobId: openJob.id,
        freelancerAddress:
          "GCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
        proposal:
          "Another great proposal from another freelancer that is long enough to pass validation checks for fifty chars.",
        bidAmount: "500",
      });
      otherApplicationId = app2.id;
    });

    it("accepts one application and rejects the rest", async () => {
      const acceptedApp = await acceptApplication(
        applicationId,
        validClientAddress,
      );

      expect(acceptedApp.status).toBe("accepted");
      expect(pool.applications.get(otherApplicationId).status).toBe("rejected");
      expect(pool.jobs.get(openJob.id).status).toBe("in_progress");
    });

    it("rejects non-clients", async () => {
      const wrongClient =
        "GDDDDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

      await expect(
        acceptApplication(applicationId, wrongClient),
      ).rejects.toThrow("Only the job client can accept applications");
      expect(pool.applications.get(applicationId).status).toBe("pending");
    });

    // Bug #850: Regression test — escrow amount must match accepted bid, not job budget
    it("updates escrow amount to match accepted bid amount (bug #850)", async () => {
      const acceptedApp = await acceptApplication(
        applicationId,
        validClientAddress,
      );

      // The accepted application has bid_amount = "450.0000000"
      expect(pool.applications.get(applicationId).bid_amount).toBe("450.0000000");

      // Verify the escrow amount was updated to the bid amount
      const escrowUpdateCalls = pool.query.mock.calls.filter(
        ([sql]) =>
          typeof sql === "string" &&
          sql.replace(/\s+/g, " ").trim().startsWith("UPDATE escrows SET amount_xlm"),
      );
      expect(escrowUpdateCalls.length).toBe(1);
      expect(escrowUpdateCalls[0][1][0]).toBe("450.0000000"); // bid_amount passed as first param
      expect(escrowUpdateCalls[0][1][1]).toBe(openJob.id);    // job_id passed as second param
    });
  });
});
