"use strict";

/**
 * src/services/messageService.test.js
 * Comprehensive unit tests for messageService.js (Issue #1446).
 */

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("./ipfsService", () => ({
  uploadMessage: jest.fn(),
  uploadFile: jest.fn(),
}));

jest.mock("./notificationService", () => ({
  createJobNotification: jest.fn().mockResolvedValue({}),
  EVENT_TYPES: { NEW_MESSAGE: "new_message" },
}));

const pool = require("../db/pool");
const { uploadMessage } = require("./ipfsService");
const { createJobNotification } = require("./notificationService");
const {
  createMessage,
  getMessagesByJob,
  markMessagesAsRead,
  getUnreadCount,
  attachTxHash,
  verifyJobParticipant,
  createFileAttachment,
} = require("./messageService");

describe("Message Service (messageService.js)", () => {
  const CLIENT_ADDR = "G" + "A".repeat(55);
  const FREELANCER_ADDR = "G" + "B".repeat(55);
  const STRANGER_ADDR = "G" + "C".repeat(55);
  const JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyJobParticipant", () => {
    it("returns job when user is client", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      const job = await verifyJobParticipant(JOB_ID, CLIENT_ADDR);
      expect(job.status).toBe("in_progress");
    });

    it("returns job when user is freelancer", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      const job = await verifyJobParticipant(JOB_ID, FREELANCER_ADDR);
      expect(job.status).toBe("in_progress");
    });

    it("throws 404 when job not found", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(verifyJobParticipant(JOB_ID, CLIENT_ADDR)).rejects.toMatchObject({
        status: 404,
        message: "Job not found",
      });
    });

    it("throws 403 when user is neither client nor freelancer", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      await expect(verifyJobParticipant(JOB_ID, STRANGER_ADDR)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe("getMessagesByJob (Cursor Pagination)", () => {
    it("throws 403 if job status is not in_progress", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "completed" }],
      });

      await expect(getMessagesByJob(JOB_ID, CLIENT_ADDR)).rejects.toMatchObject({
        status: 403,
        message: "Messaging is only allowed for in-progress jobs",
      });
    });

    it("returns messages in chronological order and nextCursor when more messages exist", async () => {
      // 1. verifyJobParticipant
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      // 2. pool.query for messages (limit 2 -> fetches 3 rows DESC)
      const now = Date.now();
      const mockRowsDesc = [
        { id: "msg-3", job_id: JOB_ID, sender_address: CLIENT_ADDR, receiver_address: FREELANCER_ADDR, content: "m3", read: false, created_at: new Date(now).toISOString() },
        { id: "msg-2", job_id: JOB_ID, sender_address: FREELANCER_ADDR, receiver_address: CLIENT_ADDR, content: "m2", read: false, created_at: new Date(now - 1000).toISOString() },
        { id: "msg-1", job_id: JOB_ID, sender_address: CLIENT_ADDR, receiver_address: FREELANCER_ADDR, content: "m1", read: true, created_at: new Date(now - 2000).toISOString() },
      ];

      pool.query.mockResolvedValueOnce({ rows: mockRowsDesc });
      // 3. update read = true
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await getMessagesByJob(JOB_ID, CLIENT_ADDR, { limit: 2 });

      expect(result.messages).toHaveLength(2);
      // Chronological order: msg-2 then msg-3
      expect(result.messages[0].id).toBe("msg-2");
      expect(result.messages[1].id).toBe("msg-3");
      expect(result.nextCursor).toBe(mockRowsDesc[1].created_at);

      // Verify update read query ran
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE messages"),
        [JOB_ID, CLIENT_ADDR],
      );
    });

    it("returns null nextCursor when results do not exceed limit (last page)", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      const mockRowsDesc = [
        { id: "msg-1", job_id: JOB_ID, sender_address: CLIENT_ADDR, receiver_address: FREELANCER_ADDR, content: "m1", read: true, created_at: "2026-09-25T08:00:00.000Z" },
      ];

      pool.query.mockResolvedValueOnce({ rows: mockRowsDesc });
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await getMessagesByJob(JOB_ID, CLIENT_ADDR, { limit: 50 });

      expect(result.messages).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("handles 'before' ISO timestamp parameter correctly", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      const beforeIso = "2026-09-25T08:30:00.000Z";
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getMessagesByJob(JOB_ID, CLIENT_ADDR, { limit: 10, before: beforeIso });

      expect(result.messages).toEqual([]);
      expect(result.nextCursor).toBeNull();

      // Check query included cursor clause
      const queryCall = pool.query.mock.calls[1];
      expect(queryCall[0]).toContain("AND created_at < $2");
      expect(queryCall[1]).toEqual([JOB_ID, new Date(beforeIso).toISOString(), 11]);
    });

    it("handles base64 encoded 'before' cursor string", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });

      const base64Cursor = Buffer.from(JSON.stringify({ createdAt: "2026-09-25T07:00:00.000Z" })).toString("base64");
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getMessagesByJob(JOB_ID, CLIENT_ADDR, { before: base64Cursor });
      expect(result.messages).toEqual([]);

      const queryCall = pool.query.mock.calls[1];
      expect(queryCall[1][1]).toBe("2026-09-25T07:00:00.000Z");
    });
  });

  describe("createMessage", () => {
    it("creates a message and uploads to IPFS", async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      // 1. BEGIN
      mockClient.query.mockResolvedValueOnce({});
      // 2. verifyJobParticipant
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR, status: "in_progress" }],
      });
      // IPFS upload
      uploadMessage.mockResolvedValueOnce({ cid: "Qm-msg-cid" });
      // 3. INSERT message
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: "new-msg-1",
          job_id: JOB_ID,
          sender_address: CLIENT_ADDR,
          receiver_address: FREELANCER_ADDR,
          content: "Hello World",
          ipfs_cid: "Qm-msg-cid",
          tx_hash: null,
          read: false,
          created_at: new Date().toISOString(),
        }],
      });
      // 4. COMMIT
      mockClient.query.mockResolvedValueOnce({});

      const msg = await createMessage({
        jobId: JOB_ID,
        senderAddress: CLIENT_ADDR,
        content: "Hello World",
      });

      expect(msg.id).toBe("new-msg-1");
      expect(msg.ipfsCid).toBe("Qm-msg-cid");
      expect(createJobNotification).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("rejects invalid public key", async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(createMessage({
        jobId: JOB_ID,
        senderAddress: "invalid-key",
        content: "Hello",
      })).rejects.toMatchObject({ status: 400 });

      expect(mockClient.release).toHaveBeenCalled();
    });

    it("rejects empty message content", async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(createMessage({
        jobId: JOB_ID,
        senderAddress: CLIENT_ADDR,
        content: "   ",
      })).rejects.toMatchObject({ status: 400 });

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("markMessagesAsRead", () => {
    it("executes update query", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 3 });
      await markMessagesAsRead(JOB_ID, CLIENT_ADDR);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE messages"),
        [JOB_ID, CLIENT_ADDR],
      );
    });
  });

  describe("getUnreadCount", () => {
    it("returns total unread count as integer", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: "5" }] });
      const count = await getUnreadCount(CLIENT_ADDR);
      expect(count).toBe(5);
    });
  });

  describe("attachTxHash", () => {
    it("attaches tx_hash to message", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: "msg-1",
          job_id: JOB_ID,
          sender_address: CLIENT_ADDR,
          receiver_address: FREELANCER_ADDR,
          content: "test",
          tx_hash: "0x123",
          created_at: new Date().toISOString(),
        }],
      });

      const msg = await attachTxHash("msg-1", "0x123");
      expect(msg.txHash).toBe("0x123");
    });

    it("throws 404 when message not found", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(attachTxHash("non-existent", "0x123")).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("createFileAttachment", () => {
    it("creates file attachment message", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ client_address: CLIENT_ADDR, freelancer_address: FREELANCER_ADDR }],
      });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: "att-1",
          job_id: JOB_ID,
          sender_address: CLIENT_ADDR,
          receiver_address: FREELANCER_ADDR,
          content: "[encrypted file]",
          attachment_cid: "Qm-file",
          attachment_name: "test.pdf",
          attachment_size: 1024,
          attachment_mime: "application/pdf",
          sender_nacl_pub: "pubkey123",
          created_at: new Date().toISOString(),
        }],
      });

      const att = await createFileAttachment({
        jobId: JOB_ID,
        senderAddress: CLIENT_ADDR,
        cid: "Qm-file",
        fileName: "test.pdf",
        fileSize: 1024,
        fileMime: "application/pdf",
        senderNaclPub: "pubkey123",
      });

      expect(att.id).toBe("att-1");
      expect(att.attachmentCid).toBe("Qm-file");
    });
  });
});
