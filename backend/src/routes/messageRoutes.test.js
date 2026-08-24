"use strict";

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret";
  process.env.STELLAR_NETWORK = "testnet";
});

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/ipfsService", () => ({
  uploadMessage: jest.fn().mockResolvedValue({ cid: "ipfs://mockcid" }),
  uploadFile: jest.fn(),
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "application/pdf"],
}));

jest.mock("../services/notificationService", () => ({
  createJobNotification: jest.fn().mockResolvedValue(undefined),
  EVENT_TYPES: { MESSAGE_RECEIVED: "MESSAGE_RECEIVED" },
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../db/pool");
const { fetchCsrf, applyCsrf } = require("../testUtils/csrfTestHelpers");

const TEST_SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const TEST_RECEIVER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";
const TEST_JOB_ID = "00000000-0000-0000-0000-000000000001";

function makeToken(publicKey = TEST_SENDER) {
  return jwt.sign({ publicKey }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

describe("Message Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/messages/job/:jobId", () => {
    it("201 — successful happy path", async () => {
      // Mock verifyJobParticipant
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            client_address: TEST_SENDER,
            freelancer_address: TEST_RECEIVER,
            status: "in_progress",
          },
        ],
      });

      // Mock insert message
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            job_id: TEST_JOB_ID,
            sender_address: TEST_SENDER,
            receiver_address: TEST_RECEIVER,
            content: "hello world",
            ipfs_cid: "ipfs://mockcid",
            tx_hash: "0x123",
            read: false,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const token = makeToken();
      const csrf = await fetchCsrf(app);
      
      const req = request(app)
        .post(`/api/messages/job/${TEST_JOB_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "hello world", contractTxHash: "0x123" });
        
      const res = await applyCsrf(req, csrf);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe("hello world");
      expect(res.body.data.ipfsCid).toBe("ipfs://mockcid");
    });

    it("401 — authentication rejection (missing token)", async () => {
      const csrf = await fetchCsrf(app);
      
      const req = request(app)
        .post(`/api/messages/job/${TEST_JOB_ID}`)
        .send({ content: "hello world" });
        
      const res = await applyCsrf(req, csrf);

      expect(res.status).toBe(401);
    });

    it("400 — validation failure (malformed/missing body)", async () => {
      const token = makeToken();
      const csrf = await fetchCsrf(app);
      
      const req = request(app)
        .post(`/api/messages/job/${TEST_JOB_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ contractTxHash: "0x123" }); // Missing content
        
      const res = await applyCsrf(req, csrf);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/content is required/i);
    });

    it("404 — not-found path (jobId not found / unauthorized participant)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // Job not found

      const token = makeToken();
      const csrf = await fetchCsrf(app);
      
      const req = request(app)
        .post(`/api/messages/job/${TEST_JOB_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "hello world" });
        
      const res = await applyCsrf(req, csrf);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });
  });
});
