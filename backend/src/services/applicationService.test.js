jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("./profileService", () => ({
  calculateFreelancerTier: jest.fn(),
  isBlocked: jest.fn().mockResolvedValue(false),
}));

const pool = require("../db/pool");
const { submitApplication, acceptApplication } = require("./applicationService");
const { createJob } = require("./jobService");

describe("applicationService", () => {
  const validClientAddress =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
  const validFreelancerAddress =
    "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  let openJob;

  beforeEach(async () => {
    pool.reset();
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

  describe("submitApplication", () => {
    it("creates a pending application", async () => {
      const application = await submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
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
          proposal:
            "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
          bidAmount: "450",
        }),
      ).rejects.toThrow("You cannot apply to your own job");
    });

    it("rejects duplicate applications", async () => {
      const appData = {
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal:
          "I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.",
        bidAmount: "450",
      };

      await submitApplication(appData);
      await expect(submitApplication(appData)).rejects.toThrow(
        "You have already applied to this job",
      );
      expect(pool.applications.size).toBe(1);
    });
  });

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
      expect(pool.jobs.get(openJob.id).freelancer_address).toBe(
        validFreelancerAddress,
      );
    });

    it("rejects non-clients", async () => {
      const wrongClient =
        "GDDDDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

      await expect(
        acceptApplication(applicationId, wrongClient),
      ).rejects.toThrow("Only the job client can accept applications");
      expect(pool.applications.get(applicationId).status).toBe("pending");
    });
  });
});
