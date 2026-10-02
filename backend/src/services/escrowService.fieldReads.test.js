"use strict";

/**
 * Issue #1507 — single-field escrow reads.
 *
 * The issue asks for `getEscrowField(jobId, field)` plus a test comparing query
 * counts before and after. The measured result is worth stating plainly: both
 * the old full-row read and the new targeted read cost exactly ONE round trip,
 * so the win is the columns Postgres transfers, not the number of queries.
 * `getEscrow()` ships `SELECT *`, which drags the `milestones` JSONB document
 * along for a caller that only wanted `status`.
 */

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

jest.mock("./jobService", () => ({
  getJob: jest.fn(),
  recordTimelineEvent: jest.fn(),
}));

jest.mock("./contractAuditService", () => ({
  logContractInteraction: jest.fn(),
  verifyOnChainTransaction: jest.fn().mockResolvedValue(null),
}));

jest.mock("./notificationService", () => ({
  notifyEscrowEvent: jest.fn(),
  EVENT_TYPES: {
    ESCROW_RELEASED: "escrow_released",
    REFUND_ISSUED: "refund_issued",
    DISPUTE_OPENED: "dispute_opened",
  },
}));

jest.mock("./referralService", () => ({
  processReferralPayout: jest.fn(),
}));

jest.mock("./stellarServiceKey", () => ({
  signWithServiceKey: jest.fn(async (_ip, fn) => fn({})),
  getServicePublicKey: jest.fn(() => "GSERVICEPUBLICKEY0000000000000000000000000000000000000000"),
}));

const { getEscrow, getEscrowField } = require("./escrowService");

const JOB_ID = "job-123";
const ESCROW_ROW = {
  id: "escrow-1",
  job_id: JOB_ID,
  amount_xlm: "500",
  status: "funded",
  milestones: [{ description: "Final delivery", amount: "500", status: "pending" }],
};

/** Every SQL string the service passed to the pool since the last reset. */
function issuedSql() {
  return mockQuery.mock.calls.map((call) => call[0]);
}

/** Only the reads that hit the escrows table. */
function escrowReads() {
  return issuedSql().filter((sql) => /FROM escrows/i.test(sql));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("getEscrowField()", () => {
  it("issues exactly one escrow read, and names the column instead of selecting everything", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ESCROW_ROW] });

    const status = await getEscrowField(JOB_ID, "status");

    expect(status).toBe("funded");
    expect(escrowReads()).toHaveLength(1);
    expect(issuedSql()[0]).toBe('SELECT "status" FROM escrows WHERE job_id = $1');
    expect(issuedSql()[0]).not.toContain("SELECT *");
  });

  it("passes the job id as a parameter rather than interpolating it", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ amount_xlm: "500" }] });

    await getEscrowField(JOB_ID, "amount_xlm");

    expect(mockQuery.mock.calls[0][1]).toEqual([JOB_ID]);
  });

  it("still costs one query after the change — the saving is payload width, not round trips", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ESCROW_ROW] });
    await getEscrow(JOB_ID);
    const fullRowQueries = escrowReads().length;
    const fullRowSql = escrowReads()[0];

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [ESCROW_ROW] });
    await getEscrowField(JOB_ID, "status");
    const targetedQueries = escrowReads().length;
    const targetedSql = escrowReads()[0];

    expect(targetedQueries).toBe(fullRowQueries);
    // The difference the issue actually cares about: the wide columns only the
    // full-row read drags along are gone.
    expect(fullRowSql).toContain("SELECT *");
    expect(targetedSql).not.toContain("*");
    for (const wideColumn of ["milestones", "deliverable_hash"]) {
      expect(targetedSql).not.toContain(wideColumn);
    }
  });

  it("reports a missing escrow as undefined instead of throwing", async () => {
    await expect(getEscrowField(JOB_ID, "status")).resolves.toBeUndefined();
    expect(escrowReads()).toHaveLength(1);
  });
});

describe("getEscrowField() field-name guard", () => {
  // `field` has to be interpolated — identifiers cannot be bind parameters — so
  // anything that is not shaped like a column name must be refused before it
  // reaches the database.
  const injections = [
    "status FROM escrows WHERE 1=1 --",
    "status; DROP TABLE escrows",
    'amount_xlm, (SELECT password_hash FROM users LIMIT 1) AS p',
    "1=1",
    "",
    undefined,
    null,
    42,
  ];

  it.each(injections)("refuses %p without touching the pool", async (field) => {
    await expect(getEscrowField(JOB_ID, field)).rejects.toThrow(TypeError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("accepts every column name the service actually reads", async () => {
    // status/amount_xlm via the converted call sites, timeout_ledger via the
    // escrow-extension reads.
    for (const field of ["status", "amount_xlm", "timeout_ledger", "released_at"]) {
      mockQuery.mockResolvedValueOnce({ rows: [{ [field]: "x" }] });
      await expect(getEscrowField(JOB_ID, field)).resolves.toBe("x");
    }
  });
});
