const request = require("supertest");
const express = require("express");
const jobRoutes = require("./jobs");
const { verifyJWT } = require("../middleware/auth");
const horizonClient = require("../utils/horizonClient");
const jobService = require("../services/jobService");

jest.mock("../middleware/auth", () => ({
  verifyJWT: jest.fn((req, res, next) => {
    req.user = { publicKey: "GDUSER1234567890123456789012345678901234567890123456789012" };
    next();
  }),
}));

jest.mock("../utils/horizonClient");
jest.mock("../services/jobService");

const app = express();
app.use(express.json());
app.use("/api/jobs", jobRoutes);

describe("POST /api/jobs/:id/boost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should successfully boost a job with a valid 5 XLM transaction", async () => {
    horizonClient.callWithLimit.mockImplementation(async (fn) => fn());

    const mockJob = { id: "job-123", boosted: true, boostedUntil: new Date().toISOString() };
    jobService.boostJob = jest.fn().mockResolvedValue(mockJob);

    // Instead of mocking the Horizon Server instance directly inside the route,
    // since the route instantiates it internally, we mock the callWithLimit behavior 
    // to return our expected result for the verifyTx function.
    horizonClient.callWithLimit.mockResolvedValue({
      type: "payment",
      asset_type: "native",
      from: "GDUSER1234567890123456789012345678901234567890123456789012",
      amount: "5.0000000"
    });

    const response = await request(app)
      .post("/api/jobs/job-123/boost")
      .send({ txHash: "valid-hash", amountXlm: 5 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(jobService.boostJob).toHaveBeenCalledWith("job-123", "valid-hash", 7);
  });

  it("should return 400 if transaction hash is missing", async () => {
    const response = await request(app)
      .post("/api/jobs/job-123/boost")
      .send({ amountXlm: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Transaction hash is required");
  });

  it("should return 400 if amount is less than 5 XLM", async () => {
    const response = await request(app)
      .post("/api/jobs/job-123/boost")
      .send({ txHash: "hash", amountXlm: 4 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Minimum boost amount is 5 XLM");
  });

  it("should return 400 if transaction verification fails", async () => {
    horizonClient.callWithLimit.mockRejectedValue(new Error("Valid payment operation not found in transaction"));

    const response = await request(app)
      .post("/api/jobs/job-123/boost")
      .send({ txHash: "invalid-hash", amountXlm: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Valid payment operation not found in transaction");
  });

  it("should apply 30 days boost for >= 15 XLM", async () => {
    horizonClient.callWithLimit.mockResolvedValue({});
    const mockJob = { id: "job-123", boosted: true, boostedUntil: new Date().toISOString() };
    jobService.boostJob = jest.fn().mockResolvedValue(mockJob);

    const response = await request(app)
      .post("/api/jobs/job-123/boost")
      .send({ txHash: "hash-15", amountXlm: 15 });

    expect(response.status).toBe(200);
    expect(jobService.boostJob).toHaveBeenCalledWith("job-123", "hash-15", 30);
  });
});
