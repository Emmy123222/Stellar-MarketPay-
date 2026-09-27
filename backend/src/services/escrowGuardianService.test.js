"use strict";

const mockQuery = jest.fn();

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

const {
  GUARDIAN_TIMEOUT_HOURS,
  setGuardian,
  approveRelease,
  canReleaseEscrow,
} = require("./escrowGuardianService");

describe("escrowGuardianService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("setGuardian", () => {
    it("sets guardian address, threshold, and 48-hour timeout interval", async () => {
      const mockUpdated = {
        job_id: "job-1",
        guardian_address: "GGUARDIAN",
        high_value_threshold: 1000,
        release_timeout_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      };
      mockQuery.mockResolvedValueOnce({ rows: [mockUpdated] });

      const result = await setGuardian("job-1", "GGUARDIAN", 1000);

      expect(result).toEqual(mockUpdated);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining(`INTERVAL '${GUARDIAN_TIMEOUT_HOURS} hours'`),
        ["job-1", "GGUARDIAN", 1000]
      );
    });

    it("rethrows error when pool query fails", async () => {
      const dbErr = new Error("DB connection failure");
      mockQuery.mockRejectedValueOnce(dbErr);
      jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(setGuardian("job-1", "GGUARDIAN", 1000)).rejects.toThrow(dbErr);
    });
  });

  describe("approveRelease", () => {
    it("throws 404 if escrow is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(approveRelease("job-unknown", "GGUARDIAN")).rejects.toMatchObject({
        message: "Escrow not found",
        status: 404,
      });
    });

    it("throws 403 if caller is not the authorized guardian", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ job_id: "job-1", guardian_address: "GAUTHORIZED" }],
      });
      jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(approveRelease("job-1", "GUNAUTHORIZED")).rejects.toMatchObject({
        message: "Not authorized as guardian",
        status: 403,
      });
    });

    it("approves release when caller is authorized guardian", async () => {
      const mockApproved = {
        job_id: "job-1",
        guardian_approved: true,
        guardian_approved_at: new Date(),
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [{ job_id: "job-1", guardian_address: "GGUARDIAN" }] })
        .mockResolvedValueOnce({ rows: [mockApproved] });

      const result = await approveRelease("job-1", "GGUARDIAN");

      expect(result).toEqual(mockApproved);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("SET guardian_approved = true"),
        ["job-1"]
      );
    });
  });

  describe("canReleaseEscrow - timeout enforcement logic", () => {
    const CLIENT = "GCLIENT";
    const GUARDIAN = "GGUARDIAN";

    it("throws 404 if escrow not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(canReleaseEscrow("job-none", CLIENT)).rejects.toMatchObject({
        message: "Escrow not found",
        status: 404,
      });
    });

    it("rejects release if caller is not the client", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", "GNOTCLIENT");
      expect(res).toEqual({
        canRelease: false,
        reason: "Only client can release escrow",
      });
    });

    it("allows release if no guardian is configured", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: null,
            amount_xlm: 5000,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({ canRelease: true });
    });

    it("allows release if amount does not exceed high value threshold", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: GUARDIAN,
            high_value_threshold: 1000,
            amount_xlm: 500,
            guardian_approved: false,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({ canRelease: true });
    });

    it("allows release if guardian has already approved", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: GUARDIAN,
            high_value_threshold: 1000,
            amount_xlm: 2000,
            guardian_approved: true,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({ canRelease: true });
    });

    it("blocks release and returns reason when awaiting guardian approval (timeout not yet reached)", async () => {
      const futureTimeout = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: GUARDIAN,
            high_value_threshold: 1000,
            amount_xlm: 2000,
            guardian_approved: false,
            release_timeout_at: futureTimeout,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({
        canRelease: false,
        reason: "Awaiting guardian approval",
        timeoutAt: futureTimeout,
      });
    });

    it("allows unilateral release when guardian timeout has passed", async () => {
      const pastTimeout = new Date(Date.now() - 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: GUARDIAN,
            high_value_threshold: 1000,
            amount_xlm: 2000,
            guardian_approved: false,
            release_timeout_at: pastTimeout,
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({
        canRelease: true,
        reason: "Guardian timeout exceeded, unilateral release allowed",
      });
    });

    it("allows unilateral release when current time equals the timeout time exactly", async () => {
      const exactTime = new Date("2026-09-24T12:00:00Z");
      jest.useFakeTimers();
      jest.setSystemTime(exactTime);

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            job_id: "job-1",
            client_address: CLIENT,
            guardian_address: GUARDIAN,
            high_value_threshold: 1000,
            amount_xlm: 2000,
            guardian_approved: false,
            release_timeout_at: exactTime.toISOString(),
          },
        ],
      });

      const res = await canReleaseEscrow("job-1", CLIENT);
      expect(res).toEqual({
        canRelease: true,
        reason: "Guardian timeout exceeded, unilateral release allowed",
      });

      jest.useRealTimers();
    });
  });
});
