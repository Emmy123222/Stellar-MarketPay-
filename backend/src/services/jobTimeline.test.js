"use strict";

// Use a mock pool specifically for timeline tests
const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

const {
  recordTimelineEvent,
  getJobTimeline,
  TIMELINE_EVENT_TYPES,
} = require("./jobService");

const JOB_ID = "job-timeline-test-1";
const TX_HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

describe("jobTimeline", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe("recordTimelineEvent", () => {
    it("records a job_posted event", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no existing event
        .mockResolvedValueOnce({
          rows: [{
            id: "evt-1",
            job_id: JOB_ID,
            event_type: "job_posted",
            tx_hash: null,
            created_at: new Date().toISOString(),
          }],
        });

      const result = await recordTimelineEvent(JOB_ID, "job_posted");
      expect(result.event_type).toBe("job_posted");
      expect(result.tx_hash).toBeNull();
    });

    it("records an escrow_funded event with tx hash", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "evt-2",
            job_id: JOB_ID,
            event_type: "escrow_funded",
            tx_hash: TX_HASH,
            created_at: new Date().toISOString(),
          }],
        });

      const result = await recordTimelineEvent(JOB_ID, "escrow_funded", TX_HASH);
      expect(result.event_type).toBe("escrow_funded");
      expect(result.tx_hash).toBe(TX_HASH);
    });

    it("records an escrow_released event with tx hash", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "evt-3",
            job_id: JOB_ID,
            event_type: "escrow_released",
            tx_hash: TX_HASH,
            created_at: new Date().toISOString(),
          }],
        });

      const result = await recordTimelineEvent(JOB_ID, "escrow_released", TX_HASH);
      expect(result.event_type).toBe("escrow_released");
      expect(result.tx_hash).toBe(TX_HASH);
    });

    it("records a bid_accepted event without tx hash", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "evt-4",
            job_id: JOB_ID,
            event_type: "bid_accepted",
            tx_hash: null,
            created_at: new Date().toISOString(),
          }],
        });

      const result = await recordTimelineEvent(JOB_ID, "bid_accepted");
      expect(result.event_type).toBe("bid_accepted");
      expect(result.tx_hash).toBeNull();
    });

    it("records a work_completed event without tx hash", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "evt-5",
            job_id: JOB_ID,
            event_type: "work_completed",
            tx_hash: null,
            created_at: new Date().toISOString(),
          }],
        });

      const result = await recordTimelineEvent(JOB_ID, "work_completed");
      expect(result.event_type).toBe("work_completed");
      expect(result.tx_hash).toBeNull();
    });

    it("is idempotent — does not duplicate events of the same type", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "existing-evt",
          job_id: JOB_ID,
          event_type: "job_posted",
          tx_hash: null,
        }],
      });

      const result = await recordTimelineEvent(JOB_ID, "job_posted");
      // Should return the existing event, not insert a new one
      expect(result.id).toBe("existing-evt");
      // The second query (INSERT) should NOT have been called
      const insertCalls = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("INSERT INTO job_timeline"),
      );
      expect(insertCalls.length).toBe(0);
    });

    it("rejects invalid event types", async () => {
      await expect(
        recordTimelineEvent(JOB_ID, "invalid_event"),
      ).rejects.toThrow("Invalid timeline event type: invalid_event");
    });
  });

  describe("getJobTimeline", () => {
    it("returns empty array for a job with no timeline events", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const timeline = await getJobTimeline(JOB_ID);
      expect(timeline).toEqual([]);
    });

    it("returns all timeline events for a job in chronological order", async () => {
      const mockRows = [
        {
          id: "evt-1",
          job_id: JOB_ID,
          event_type: "job_posted",
          tx_hash: null,
          created_at: "2024-01-01T10:00:00Z",
        },
        {
          id: "evt-2",
          job_id: JOB_ID,
          event_type: "bid_accepted",
          tx_hash: null,
          created_at: "2024-01-10T12:00:00Z",
        },
        {
          id: "evt-3",
          job_id: JOB_ID,
          event_type: "escrow_funded",
          tx_hash: TX_HASH,
          created_at: "2024-01-12T14:30:00Z",
        },
        {
          id: "evt-4",
          job_id: JOB_ID,
          event_type: "work_completed",
          tx_hash: null,
          created_at: "2024-01-15T09:00:00Z",
        },
        {
          id: "evt-5",
          job_id: JOB_ID,
          event_type: "escrow_released",
          tx_hash: "release-tx-hash-789",
          created_at: "2024-02-01T16:30:00Z",
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRows });

      const timeline = await getJobTimeline(JOB_ID);

      expect(timeline).toHaveLength(5);

      // Verify camelCase transformation
      expect(timeline[0]).toEqual({
        id: "evt-1",
        jobId: JOB_ID,
        eventType: "job_posted",
        txHash: null,
        createdAt: "2024-01-01T10:00:00Z",
      });

      // Verify on-chain events have tx hashes
      expect(timeline[2].txHash).toBe(TX_HASH);
      expect(timeline[2].eventType).toBe("escrow_funded");

      expect(timeline[4].txHash).toBe("release-tx-hash-789");
      expect(timeline[4].eventType).toBe("escrow_released");

      // Verify chronological ordering is preserved
      const eventTypes = timeline.map((e) => e.eventType);
      expect(eventTypes).toEqual([
        "job_posted",
        "bid_accepted",
        "escrow_funded",
        "work_completed",
        "escrow_released",
      ]);
    });

    it("handles null tx_hash gracefully", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "evt-1",
          job_id: JOB_ID,
          event_type: "escrow_funded",
          tx_hash: null,
          created_at: new Date().toISOString(),
        }],
      });

      const timeline = await getJobTimeline(JOB_ID);
      expect(timeline[0].txHash).toBeNull();
    });
  });

  describe("TIMELINE_EVENT_TYPES", () => {
    it("includes all expected event types", () => {
      expect(TIMELINE_EVENT_TYPES).toEqual([
        "job_posted",
        "bid_accepted",
        "escrow_funded",
        "work_completed",
        "escrow_released",
      ]);
    });
  });
});
