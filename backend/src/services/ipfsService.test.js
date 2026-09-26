"use strict";

/**
 * src/services/ipfsService.test.js
 *
 * Unit tests for IPFS upload + pin verification (Issue #1439).
 *
 * axios is mocked, so no network I/O happens. The logger is mocked too so we
 * can assert the on-failure alert without emitting pino output. The
 * Prometheus counter is spied on to assert the alert metric is incremented.
 */

process.env.PINATA_API_KEY = "test-api-key";
process.env.PINATA_SECRET_KEY = "test-secret-key";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("axios", () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
}));

const mockLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(),
};

jest.mock("../utils/logger", () => ({
  createServiceLogger: () => mockLogger,
}));

const metrics = require("../metrics");
const {
  uploadFile,
  uploadMessage,
  verifyPin,
  isConfigured,
  PIN_VERIFY_MAX_ATTEMPTS,
  PIN_VERIFY_RETRY_DELAY_MS,
  _setPinVerifyRetryDelay,
} = require("./ipfsService");

const VALID_CID = "QmYwAPJzv5CZsnAzt8auVZRnApMEfM4kQh6wxbN4p5M6Za";
const PINNED_RESPONSE = {
  data: { count: 1, rows: [{ ipfs_pin_hash: VALID_CID, status: "pinned" }] },
};
const UNPINNED_RESPONSE = { data: { count: 0, rows: [] } };
const UPLOAD_RESPONSE = { data: { IpfsHash: VALID_CID } };
const FILE_BUFFER = Buffer.from("fake evidence content");

describe("ipfsService", () => {
  let incSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReset();
    mockPost.mockReset();
    // Keep the 2s retry back-off out of the test suite; the default is asserted
    // against the exported constant below.
    _setPinVerifyRetryDelay(0);
    incSpy = jest.spyOn(metrics.ipfsPinVerificationFailuresTotal, "inc");
  });

  afterEach(() => {
    incSpy.mockRestore();
  });

  afterAll(() => {
    _setPinVerifyRetryDelay(PIN_VERIFY_RETRY_DELAY_MS);
  });

  // =========================================================================
  // verifyPin
  // =========================================================================
  describe("verifyPin", () => {
    it("returns true when Pinata reports the CID as pinned", async () => {
      mockGet.mockResolvedValue(PINNED_RESPONSE);

      await expect(verifyPin(VALID_CID)).resolves.toBe(true);

      expect(mockGet).toHaveBeenCalledTimes(1);
      const [url, config] = mockGet.mock.calls[0];
      expect(url).toBe("https://api.pinata.cloud/data/pinList");
      expect(config.params).toEqual({
        hash: VALID_CID,
        status: "pinned",
        pageLimit: 1,
      });
      expect(config.headers.pinata_api_key).toBe("test-api-key");
      expect(config.headers.pinata_secret_api_key).toBe("test-secret-key");
      expect(incSpy).not.toHaveBeenCalled();
    });

    it("retries after a transient API error and succeeds", async () => {
      mockGet
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(PINNED_RESPONSE);

      await expect(verifyPin(VALID_CID)).resolves.toBe(true);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(incSpy).not.toHaveBeenCalled();
    });

    it("returns false and alerts after exhausting attempts when the pin is missing", async () => {
      mockGet.mockResolvedValue(UNPINNED_RESPONSE);

      await expect(verifyPin(VALID_CID)).resolves.toBe(false);

      expect(mockGet).toHaveBeenCalledTimes(PIN_VERIFY_MAX_ATTEMPTS);
      expect(incSpy).toHaveBeenCalledWith({ reason: "not_pinned" });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("returns false and alerts when the API keeps failing", async () => {
      mockGet.mockRejectedValue(new Error("503 Service Unavailable"));

      await expect(verifyPin(VALID_CID)).resolves.toBe(false);

      expect(mockGet).toHaveBeenCalledTimes(PIN_VERIFY_MAX_ATTEMPTS);
      expect(incSpy).toHaveBeenCalledWith({ reason: "api_error" });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("short-circuits on an invalid CID without calling the API", async () => {
      await expect(verifyPin("")).resolves.toBe(false);
      await expect(verifyPin(null)).resolves.toBe(false);
      await expect(verifyPin(undefined)).resolves.toBe(false);

      expect(mockGet).not.toHaveBeenCalled();
      expect(incSpy).toHaveBeenCalledWith({ reason: "invalid_cid" });
    });

    it("does not throw when the provider is unreachable", async () => {
      mockGet.mockRejectedValue(new Error("ENOTFOUND api.pinata.cloud"));

      await expect(verifyPin(VALID_CID)).resolves.toBe(false);
    });
  });

  // =========================================================================
  // uploadFile
  // =========================================================================
  describe("uploadFile", () => {
    it("verifies the pin after upload and reports pinned: true", async () => {
      mockPost.mockResolvedValue(UPLOAD_RESPONSE);
      mockGet.mockResolvedValue(PINNED_RESPONSE);

      const result = await uploadFile(FILE_BUFFER, "evidence.pdf", "application/pdf");

      expect(result.cid).toBe(VALID_CID);
      expect(result.pinned).toBe(true);
      expect(result.size).toBe(FILE_BUFFER.length);
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("still returns the CID with pinned: false when verification fails", async () => {
      mockPost.mockResolvedValue(UPLOAD_RESPONSE);
      mockGet.mockResolvedValue(UNPINNED_RESPONSE);

      const result = await uploadFile(FILE_BUFFER, "evidence.pdf", "application/pdf");

      expect(result.cid).toBe(VALID_CID);
      expect(result.pinned).toBe(false);
      expect(incSpy).toHaveBeenCalledWith({ reason: "not_pinned" });
    });

    it("rejects oversized files before uploading", async () => {
      const big = Buffer.alloc(6 * 1024 * 1024);

      await expect(
        uploadFile(big, "big.pdf", "application/pdf"),
      ).rejects.toThrow(/exceeds 5MB/);
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // uploadMessage
  // =========================================================================
  describe("uploadMessage", () => {
    it("verifies the pin after uploading a message payload", async () => {
      mockPost.mockResolvedValue(UPLOAD_RESPONSE);
      mockGet.mockResolvedValue(PINNED_RESPONSE);

      const result = await uploadMessage({ jobId: "job-1", content: "hi" });

      expect(result.cid).toBe(VALID_CID);
      expect(result.pinned).toBe(true);
    });
  });

  // =========================================================================
  // config helpers
  // =========================================================================
  describe("configuration", () => {
    it("reports configured when both Pinata keys are present", () => {
      expect(isConfigured()).toBe(true);
    });
  });
});
