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
  queueNotification: jest.fn().mockResolvedValue({}),
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

    it("throws 404 when application not found", async () => {
      await expect(
        acceptApplication("nonexistent-app", validClientAddress),
      ).rejects.toThrow("Application not found");
    });

    it("rejects when job is no longer open", async () => {
      pool.jobs.get(openJob.id).status = "in_progress";

      await expect(
        acceptApplication(applicationId, validClientAddress),
      ).rejects.toThrow("Job is no longer accepting applications");
    });
  });

  // ─── withdrawApplication ───────────────────────────────────────────────

  describe("withdrawApplication", () => {
    it("withdraws a pending application", async () => {
      const app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      const withdrawn = await withdrawApplication(app.id, validFreelancerAddress);
      expect(withdrawn.id).toBe(app.id);
      expect(withdrawn.withdrawnAt).toBeTruthy();
    });

    it("throws 404 when application not found", async () => {
      await expect(
        withdrawApplication("nonexistent", validFreelancerAddress),
      ).rejects.toThrow("Application not found");
    });

    it("throws 403 when wrong freelancer tries to withdraw", async () => {
      const app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      const wrongAddr =
        "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      await expect(
        withdrawApplication(app.id, wrongAddr),
      ).rejects.toThrow("Only the freelancer who submitted can withdraw this application");
    });

    it("throws 400 when application is already accepted", async () => {
      const app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      });

      await acceptApplication(app.id, validClientAddress);

      await expect(
        withdrawApplication(app.id, validFreelancerAddress),
      ).rejects.toThrow("Cannot withdraw an already-accepted application");
    });
  });

  // ─── closeBiddingForJob ────────────────────────────────────────────────

  describe("closeBiddingForJob", () => {
    it("closes bidding for an open job", async () => {
      const result = await closeBiddingForJob(openJob.id, validClientAddress);
      expect(result.jobId).toBe(openJob.id);
      expect(result.biddingClosedAt).toBeTruthy();
    });

    it("rejects non-client", async () => {
      const wrongAddr =
        "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      await expect(
        closeBiddingForJob(openJob.id, wrongAddr),
      ).rejects.toThrow("Only the client can close bidding");
    });

    it("rejects non-open job", async () => {
      pool.jobs.get(openJob.id).status = "in_progress";

      await expect(
        closeBiddingForJob(openJob.id, validClientAddress),
      ).rejects.toThrow("Bidding can only be closed while job is open");
    });

    it("rejects if bidding already closed", async () => {
      await closeBiddingForJob(openJob.id, validClientAddress);

      await expect(
        closeBiddingForJob(openJob.id, validClientAddress),
      ).rejects.toThrow("Bidding is already closed");
    });
  });

  // ─── revealApplicationBid ──────────────────────────────────────────────

  describe("revealApplicationBid", () => {
    let app;
    const nonce = "random-nonce-123";

    beforeEach(async () => {
      // Submit with sealed commitment hash
      const { createHash } = require("crypto");
      const bidCommitment = createHash("sha256")
        .update(`450.0000000:${nonce}`)
        .digest("hex");

      app = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
        bidCommitment,
      });

      // Close bidding
      await closeBiddingForJob(openJob.id, validClientAddress);
    });

    it("reveals a sealed bid successfully", async () => {
      const revealed = await revealApplicationBid(
        app.id,
        validFreelancerAddress,
        "450",
        nonce,
      );
      expect(revealed.bidRevealed).toBe(true);
      expect(revealed.revealedBidAmount).toBe("450.0000000");
    });

    it("rejects invalid freelancer key", async () => {
      await expect(
        revealApplicationBid(app.id, "bad-key", "450", nonce),
      ).rejects.toThrow("Invalid Stellar public key");
    });

    it("rejects missing nonce", async () => {
      await expect(
        revealApplicationBid(app.id, validFreelancerAddress, "450", ""),
      ).rejects.toThrow("Reveal nonce is required");
    });

    it("rejects non-positive bid amount", async () => {
      await expect(
        revealApplicationBid(app.id, validFreelancerAddress, "0", nonce),
      ).rejects.toThrow("Reveal bid amount must be positive");
    });

    it("throws 404 when application not found", async () => {
      await expect(
        revealApplicationBid("nonexistent", validFreelancerAddress, "450", nonce),
      ).rejects.toThrow("Application not found");
    });

    it("rejects reveal by wrong freelancer", async () => {
      const wrongAddr =
        "GZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      await expect(
        revealApplicationBid(app.id, wrongAddr, "450", nonce),
      ).rejects.toThrow("Only the freelancer can reveal this bid");
    });

    it("rejects commitment verification failure", async () => {
      await expect(
        revealApplicationBid(app.id, validFreelancerAddress, "999", nonce),
      ).rejects.toThrow("Commitment verification failed");
    });
  });
});
