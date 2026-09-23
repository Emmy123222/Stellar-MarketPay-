"use strict";

/**
 * src/services/autoConvertService.test.js — Issue #1560
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("./notificationService", () => ({
  createInAppNotification: jest.fn().mockResolvedValue({}),
  queueNotification: jest.fn().mockResolvedValue({}),
  generateInAppContent: jest.fn(() => ({ title: "t", body: "b" })),
  EVENT_TYPES: { USDC_AUTO_CONVERTED: "usdc_auto_converted" },
}));

const mockStrictSendCall = jest.fn();
const mockTxCall = jest.fn();
const mockOpsCall = jest.fn();
jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        strictSendPaths: () => ({ call: mockStrictSendCall }),
        transactions: () => ({ transaction: () => ({ call: mockTxCall }) }),
        operations: () => ({ forTransaction: () => ({ limit: () => ({ call: mockOpsCall }) }) }),
      })),
    },
  };
});

const pool = require("../db/pool");
const notifications = require("./notificationService");
const svc = require("./autoConvertService");

const USER = "G" + "A".repeat(55);
const JOB = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const TX = "a".repeat(64);

describe("autoConvertService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("applySlippage subtracts basis points", () => {
    expect(svc.applySlippage("100", 100)).toBe("99.0000000");
  });

  describe("updateAutoConvertSettings", () => {
    it("rejects non-boolean enabled", async () => {
      await expect(svc.updateAutoConvertSettings(USER, { enabled: "yes" })).rejects.toMatchObject({ status: 400 });
    });

    it("rejects out-of-range slippage", async () => {
      await expect(svc.updateAutoConvertSettings(USER, { slippageBps: 5000 })).rejects.toMatchObject({ status: 400 });
    });

    it("persists the toggle", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ auto_convert_usdc: true, auto_convert_slippage_bps: 100 }] });
      const res = await svc.updateAutoConvertSettings(USER, { enabled: true });
      expect(res).toMatchObject({ enabled: true, slippageBps: 100 });
      expect(pool.query.mock.calls[0][1]).toEqual([USER, true, null]);
    });
  });

  describe("queueAutoConversion", () => {
    it("does nothing when the freelancer has not opted in", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ freelancer_address: USER, currency: "XLM", auto_convert_usdc: false, auto_convert_slippage_bps: 100 }],
      });
      await expect(svc.queueAutoConversion({ jobId: JOB, amountXlm: "50" })).resolves.toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it("skips USDC-denominated jobs", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ freelancer_address: USER, currency: "USDC", auto_convert_usdc: true, auto_convert_slippage_bps: 100 }],
      });
      await expect(svc.queueAutoConversion({ jobId: JOB, amountXlm: "50" })).resolves.toBeNull();
    });

    it("queues a pending conversion with a quote and min-received", async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ freelancer_address: USER, currency: "XLM", auto_convert_usdc: true, auto_convert_slippage_bps: 200 }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: CONV, user_address: USER, job_id: JOB, source_amount_xlm: "50", quoted_usdc: "6", dest_min_usdc: "5.88", status: "pending" }],
        });
      mockStrictSendCall.mockResolvedValueOnce({
        records: [
          { destination_amount: "5.5", path: [] },
          { destination_amount: "6.0", path: [] },
        ],
      });

      const res = await svc.queueAutoConversion({ jobId: JOB, amountXlm: "50" });

      expect(res).toMatchObject({ id: CONV, status: "pending" });
      const params = pool.query.mock.calls[1][1];
      expect(params.slice(3)).toEqual(["50.0000000", "6.0000000", "5.8800000"]);
    });

    it("never throws, even if the database fails", async () => {
      pool.query.mockRejectedValueOnce(new Error("db down"));
      await expect(svc.queueAutoConversion({ jobId: JOB, amountXlm: "50" })).resolves.toBeNull();
    });
  });

  describe("completeAutoConversion", () => {
    const pendingRow = { id: CONV, user_address: USER, job_id: JOB, job_title: "Logo", source_amount_xlm: "50.0000000", status: "pending" };

    it("verifies the swap on Horizon, stores the rate and notifies the user", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [pendingRow] })
        .mockResolvedValueOnce({
          rows: [{ ...pendingRow, status: "completed", tx_hash: TX, received_usdc: "6", exchange_rate: "0.12" }],
        });
      mockTxCall.mockResolvedValueOnce({ successful: true });
      mockOpsCall.mockResolvedValueOnce({
        records: [{
          type: "path_payment_strict_send",
          from: USER,
          to: USER,
          source_asset_type: "native",
          source_amount: "50.0000000",
          asset_code: "USDC",
          asset_issuer: svc.USDC_ISSUER,
          amount: "6.0000000",
        }],
      });

      const res = await svc.completeAutoConversion(USER, CONV, { txHash: TX });

      expect(res).toMatchObject({ status: "completed", receivedUsdc: "6.0000000", exchangeRate: "0.1200000" });
      expect(pool.query.mock.calls[1][1]).toEqual([CONV, TX, "6.0000000", "0.1200000"]);
      expect(notifications.createInAppNotification).toHaveBeenCalled();
      expect(notifications.queueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ notificationType: "email", eventType: "usdc_auto_converted" }),
      );
    });

    it("rejects a transaction without a matching strict-send op", async () => {
      pool.query.mockResolvedValueOnce({ rows: [pendingRow] });
      mockTxCall.mockResolvedValueOnce({ successful: true });
      mockOpsCall.mockResolvedValueOnce({ records: [{ type: "payment" }] });

      await expect(svc.completeAutoConversion(USER, CONV, { txHash: TX })).rejects.toMatchObject({ status: 400 });
    });

    it("forbids completing someone else's conversion", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ...pendingRow, user_address: "G" + "B".repeat(55) }] });
      await expect(svc.completeAutoConversion(USER, CONV, { txHash: TX })).rejects.toMatchObject({ status: 403 });
    });

    it("requires a valid tx hash", async () => {
      await expect(svc.completeAutoConversion(USER, CONV, { txHash: "xyz" })).rejects.toMatchObject({ status: 400 });
    });
  });
});
