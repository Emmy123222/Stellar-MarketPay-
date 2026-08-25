"use strict";

/**
 * src/routes/messageRoutes.test.js
 *
 * Route-level test suite for /api/messages endpoints (Issue #1146).
 * Covers, per endpoint:
 *   - Happy path with a valid payload
 *   - Authentication rejection where the route is guarded (verifyJWT)
 *   - Validation failure (400) for a malformed body
 *   - Not-found path where the route takes an id
 *
 * The DB pool is replaced with the shared pgMock. All service calls
 * (messageService, ipfsService) are mocked at the module level so tests
 * stay fast and deterministic. CSRF is a passthrough in jest.setup.js,
 * so a dummy "X-CSRF-Token" header is sufficient for mutating requests.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/messageService", () => ({
  createMessage: jest.fn(),
  getMessagesByJob: jest.fn(),
  getUnreadCount: jest.fn(),
  attachTxHash: jest.fn(),
  createFileAttachment: jest.fn(),
}));

jest.mock("../services/ipfsService", () => ({
  uploadFile: jest.fn(),
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "application/pdf"],
}));

const pool = require("../db/pool");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const { JWT_SECRET } = require("../middleware/auth");
const messageRoutes = require("./messageRoutes");

const {
  createMessage,
  getMessagesByJob,
  getUnreadCount,
  attachTxHash,
  createFileAttachment,
} = require("../services/messageService");

const { uploadFile } = require("../services/ipfsService");

// ── Minimal Express test app ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/messages", messageRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

// Valid 56-char G... Stellar addresses (synthetic)
const USER_ADDRESS = "G" + "A".repeat(55);
const JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MESSAGE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeToken(publicKey = USER_ADDRESS) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

/** A representative message row as returned by the service layer */
function fakeMessage(overrides = {}) {
  return {
    id: overrides.id || MESSAGE_ID,
    jobId: overrides.jobId || JOB_ID,
    senderAddress: overrides.senderAddress || USER_ADDRESS,
    receiverAddress: overrides.receiverAddress || "G" + "B".repeat(55),
    content: overrides.content || "Hello, encrypted message",
    ipfsCid: overrides.ipfsCid || null,
    txHash: overrides.txHash || null,
    read: overrides.read ?? false,
    attachmentCid: overrides.attachmentCid || null,
    attachmentName: null,
    attachmentSize: null,
    attachmentMime: null,
    senderNaclPub: null,
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Message Routes Suite (/api/messages)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. POST /api/messages/job/:jobId  — send a message
  // ===========================================================================
  describe("POST /api/messages/job/:jobId", () => {
    const validBody = { content: "Hello from the client side" };

    it("201 — happy path: creates a message and returns it", async () => {
      createMessage.mockResolvedValue(fakeMessage({ content: validBody.content }));

      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe(validBody.content);
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_ID,
          senderAddress: USER_ADDRESS,
          content: validBody.content,
        }),
      );
    });

    it("201 — passes optional contractTxHash through to the service", async () => {
      const body = { content: "Payment attached", contractTxHash: "hash-abc123" };
      createMessage.mockResolvedValue(fakeMessage({ txHash: "hash-abc123" }));

      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(body);

      expect(res.status).toBe(201);
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ contractTxHash: "hash-abc123" }),
      );
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
      expect(createMessage).not.toHaveBeenCalled();
    });

    it("401 — rejects an invalid / malformed JWT", async () => {
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", "Bearer not.a.valid.jwt")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(createMessage).not.toHaveBeenCalled();
    });

    it("400 — rejects when content is missing", async () => {
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/content/i);
      expect(createMessage).not.toHaveBeenCalled();
    });

    it("400 — rejects when content is not a string", async () => {
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ content: 12345 });

      expect(res.status).toBe(400);
      expect(createMessage).not.toHaveBeenCalled();
    });

    it("403 — surfaces 403 from service when user is not a job participant", async () => {
      const err = Object.assign(
        new Error("Unauthorized: You are not a participant in this job"),
        { status: 403 },
      );
      createMessage.mockRejectedValue(err);

      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/participant/i);
    });

    it("404 — surfaces 404 from service when job does not exist", async () => {
      const err = Object.assign(new Error("Job not found"), { status: 404 });
      createMessage.mockRejectedValue(err);

      const res = await request(app)
        .post(`/api/messages/job/non-existent-job`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });
  });

  // ===========================================================================
  // 2. GET /api/messages/job/:jobId  — list messages for a job
  // ===========================================================================
  describe("GET /api/messages/job/:jobId", () => {
    it("200 — happy path: returns message list", async () => {
      const messages = [fakeMessage(), fakeMessage({ id: "msg-2" })];
      getMessagesByJob.mockResolvedValue(messages);

      const res = await request(app)
        .get(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(getMessagesByJob).toHaveBeenCalledWith(JOB_ID, USER_ADDRESS);
    });

    it("200 — returns empty array when job has no messages yet", async () => {
      getMessagesByJob.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app).get(`/api/messages/job/${JOB_ID}`);

      expect(res.status).toBe(401);
      expect(getMessagesByJob).not.toHaveBeenCalled();
    });

    it("403 — surfaces 403 from service when user is not a participant", async () => {
      const err = Object.assign(
        new Error("Unauthorized: You are not a participant in this job"),
        { status: 403 },
      );
      getMessagesByJob.mockRejectedValue(err);

      const res = await request(app)
        .get(`/api/messages/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(403);
    });

    it("404 — surfaces 404 from service when job does not exist", async () => {
      const err = Object.assign(new Error("Job not found"), { status: 404 });
      getMessagesByJob.mockRejectedValue(err);

      const res = await request(app)
        .get(`/api/messages/job/non-existent-job`)
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });
  });

  // ===========================================================================
  // 3. GET /api/messages/unread-count
  // ===========================================================================
  describe("GET /api/messages/unread-count", () => {
    it("200 — happy path: returns the unread count", async () => {
      getUnreadCount.mockResolvedValue(7);

      const res = await request(app)
        .get("/api/messages/unread-count")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unreadCount).toBe(7);
      expect(getUnreadCount).toHaveBeenCalledWith(USER_ADDRESS);
    });

    it("200 — returns 0 when user has no unread messages", async () => {
      getUnreadCount.mockResolvedValue(0);

      const res = await request(app)
        .get("/api/messages/unread-count")
        .set("Authorization", `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(0);
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app).get("/api/messages/unread-count");

      expect(res.status).toBe(401);
      expect(getUnreadCount).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. PATCH /api/messages/:messageId/tx-hash  — attach on-chain tx hash
  // ===========================================================================
  describe("PATCH /api/messages/:messageId/tx-hash", () => {
    const validBody = { txHash: "abc123txhashvalue" };

    it("200 — happy path: attaches tx hash and returns updated message", async () => {
      attachTxHash.mockResolvedValue(fakeMessage({ txHash: validBody.txHash }));

      const res = await request(app)
        .patch(`/api/messages/${MESSAGE_ID}/tx-hash`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.txHash).toBe(validBody.txHash);
      expect(attachTxHash).toHaveBeenCalledWith(MESSAGE_ID, validBody.txHash);
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .patch(`/api/messages/${MESSAGE_ID}/tx-hash`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(attachTxHash).not.toHaveBeenCalled();
    });

    it("400 — rejects when txHash is missing", async () => {
      const res = await request(app)
        .patch(`/api/messages/${MESSAGE_ID}/tx-hash`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/txHash/i);
      expect(attachTxHash).not.toHaveBeenCalled();
    });

    it("400 — rejects when txHash is not a string", async () => {
      const res = await request(app)
        .patch(`/api/messages/${MESSAGE_ID}/tx-hash`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ txHash: 99999 });

      expect(res.status).toBe(400);
      expect(attachTxHash).not.toHaveBeenCalled();
    });

    it("404 — surfaces 404 from service when message does not exist", async () => {
      const err = Object.assign(new Error("Message not found"), { status: 404 });
      attachTxHash.mockRejectedValue(err);

      const res = await request(app)
        .patch(`/api/messages/non-existent-msg/tx-hash`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Message not found");
    });
  });

  // ===========================================================================
  // 5. POST /api/messages/job/:jobId/attachments  — upload encrypted attachment
  // ===========================================================================
  describe("POST /api/messages/job/:jobId/attachments", () => {
    it("201 — happy path: uploads file to IPFS and creates attachment message", async () => {
      uploadFile.mockResolvedValue({
        cid: "Qm-test-cid",
        size: 1024,
        fileName: "document.pdf",
        mimeType: "application/pdf",
        uploadedAt: new Date().toISOString(),
      });
      createFileAttachment.mockResolvedValue(
        fakeMessage({ attachmentCid: "Qm-test-cid" }),
      );

      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}/attachments`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(uploadFile).toHaveBeenCalled();
      expect(createFileAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_ID,
          senderAddress: USER_ADDRESS,
          cid: "Qm-test-cid",
        }),
      );
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}/attachments`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("data"), {
          filename: "file.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(401);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("400 — rejects when no file field is provided in the multipart body", async () => {
      // Send a valid multipart request with only a text field (no file field).
      // Multer sets req.file = undefined and calls next(), so the route handler
      // returns the 400 "File is required" response.
      const res = await request(app)
        .post(`/api/messages/job/${JOB_ID}/attachments`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .field("senderNaclPub", "some-pub-key");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/file/i);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("404 — surfaces 404 from service when job does not exist", async () => {
      uploadFile.mockResolvedValue({ cid: "Qm-cid", size: 100 });
      const err = Object.assign(new Error("Job not found"), { status: 404 });
      createFileAttachment.mockRejectedValue(err);

      const res = await request(app)
        .post(`/api/messages/job/non-existent-job/attachments`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("data"), {
          filename: "test.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });
  });
});
