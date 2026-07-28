/**
 * src/services/jobService.batch.test.js
 * Unit tests for batchJobAction — the service backing POST /api/jobs/batch (#869).
 */
"use strict";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const { defaultJobRow } = require("../testUtils/pgMock");
const { batchJobAction } = require("./jobService");

describe("batchJobAction", () => {
  const CLIENT = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
  const OTHER_CLIENT = "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";

  beforeEach(() => {
    pool.reset();
  });

  function seedJob(overrides = {}) {
    const row = defaultJobRow({ client_address: CLIENT, ...overrides });
    pool.jobs.set(row.id, row);
    return row;
  }

  it("rejects an invalid action", async () => {
    await expect(batchJobAction("nuke", ["job-1"], CLIENT)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects an empty ids array", async () => {
    await expect(batchJobAction("close", [], CLIENT)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects more than 50 ids in a single request", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `job-${i}`);
    await expect(batchJobAction("close", ids, CLIENT)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects the whole batch if the client does not own every job", async () => {
    const mine = seedJob({ id: "job-mine", status: "open" });
    const theirs = seedJob({
      id: "job-theirs",
      status: "open",
      client_address: OTHER_CLIENT,
    });

    await expect(
      batchJobAction("close", [mine.id, theirs.id], CLIENT),
    ).rejects.toMatchObject({ status: 403 });

    // Nothing should have been mutated — authorization is checked up front.
    expect(pool.jobs.get(mine.id).status).toBe("open");
  });

  it("rejects the whole batch if any id does not exist", async () => {
    const mine = seedJob({ id: "job-real", status: "open" });

    await expect(
      batchJobAction("close", [mine.id, "job-does-not-exist"], CLIENT),
    ).rejects.toMatchObject({ status: 403 });

    expect(pool.jobs.get(mine.id).status).toBe("open");
  });

  it("closes open jobs and reports non-open jobs as failed", async () => {
    const openJob = seedJob({ id: "job-open", status: "open" });
    const inProgressJob = seedJob({ id: "job-in-progress", status: "in_progress" });

    const result = await batchJobAction(
      "close",
      [openJob.id, inProgressJob.id],
      CLIENT,
    );

    expect(result.succeeded).toEqual([openJob.id]);
    expect(result.failed).toEqual([
      { id: inProgressJob.id, error: expect.stringContaining("not open") },
    ]);
    expect(pool.jobs.get(openJob.id).status).toBe("cancelled");
    expect(pool.jobs.get(inProgressJob.id).status).toBe("in_progress");
  });

  it("soft-deletes jobs and reports in-progress jobs as failed", async () => {
    const openJob = seedJob({ id: "job-open-2", status: "open" });
    const inProgressJob = seedJob({ id: "job-in-progress-2", status: "in_progress" });

    const result = await batchJobAction(
      "delete",
      [openJob.id, inProgressJob.id],
      CLIENT,
    );

    expect(result.succeeded).toEqual([openJob.id]);
    expect(result.failed).toEqual([
      { id: inProgressJob.id, error: expect.stringContaining("in progress") },
    ]);
    expect(pool.jobs.get(openJob.id).deleted_at).toBeTruthy();
    expect(pool.jobs.get(inProgressJob.id).deleted_at).toBeFalsy();
  });

  it("deduplicates repeated ids in the same request", async () => {
    const openJob = seedJob({ id: "job-dup", status: "open" });
    const result = await batchJobAction("close", [openJob.id, openJob.id], CLIENT);
    expect(result.succeeded).toEqual([openJob.id]);
    expect(result.failed).toEqual([]);
  });
});
