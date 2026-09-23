const {
  createRecurringEscrow,
  tickRecurringEscrow,
  startRecurringEscrowTicker,
  getActiveRecurringEscrows
} = require("./recurringEscrowService");
const pool = require("../db/pool");
const { getJob } = require("./jobService");

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("./jobService", () => ({
  getJob: jest.fn().mockResolvedValue({ clientAddress: "C", freelancerAddress: "F", title: "Job", currency: "XLM" }),
}));

jest.mock("./contractAuditService", () => ({
  logContractInteraction: jest.fn(),
}));

jest.mock("./notificationService", () => ({
  notifyEscrowEvent: jest.fn(),
  EVENT_TYPES: { ESCROW_RELEASED: "escrow_released", REFUND_ISSUED: "refund_issued" },
}));

jest.mock("./stellarServiceKey", () => ({
  getServicePublicKey: jest.fn(() => "GSERVICE"),
}));

jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({ info: jest.fn(), error: jest.fn() }),
  logError: jest.fn(),
}));

describe("Monthly recurring escrow billing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("recurring escrow set for day 31 in a month with 30 days -> fires on last day of month", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-01-31T12:00:00Z"));
    
    // Test creation sets next_release_date to Feb 29 (2024 is leap year)
    pool.query.mockResolvedValueOnce({ rows: [{ job_id: "job-1", anchor_day: 31, next_release_date: "2024-02-29T12:00:00.000Z" }] });
    
    await createRecurringEscrow({
      jobId: "job-1",
      clientAddress: "C",
      amountPerRelease: 100,
      intervalDays: 30, // interpreted as monthly
      totalReleases: 12
    });
    
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE escrows"),
      expect.arrayContaining([31, expect.stringContaining("2024-02-29")])
    );
  });

  it("monthly billing fires exactly once per calendar month", async () => {
    // We mock that it is already Feb 29, so it ticks, and next date should be Mar 31
    pool.query
      .mockResolvedValueOnce({ rows: [{ job_id: "job-1", anchor_day: 31, next_release_date: "2024-02-29T12:00:00.000Z", releases_remaining: 11, amount_per_release: 100 }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ job_id: "job-1", anchor_day: 31, next_release_date: "2024-03-31T12:00:00.000Z", releases_remaining: 10 }] }); // UPDATE
      
    await tickRecurringEscrow("job-1");

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][1]).toEqual(
      expect.arrayContaining(["job-1", expect.stringContaining("2024-03-31")])
    );
  });

  it("cancelled recurring escrow does not fire on the next cycle", async () => {
    // getActiveRecurringEscrows filters by status = 'funded' and releases_remaining > 0
    pool.query.mockResolvedValueOnce({ rows: [] }); // No active escrows
    
    const active = await getActiveRecurringEscrows();
    expect(active.length).toBe(0);
    
    // If it's cancelled, it won't be returned by getActiveRecurringEscrows
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("e.status = 'funded'")
    );
  });
});
