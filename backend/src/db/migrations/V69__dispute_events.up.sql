-- Issue #1429: Dispute timeline — chronological event history for a dispute.
--
-- dispute_events records every state change in a dispute's lifecycle:
--   opened              — the dispute was raised (actor = raised_by)
--   evidence_submitted  — a party attached an evidence file (actor = uploader)
--   arbitrator_assigned — an arbitrator was assigned to the case
--   resolved            — the dispute reached a ruling (actor = resolved_by)
--
-- The table is append-only: events are never updated or deleted (ON DELETE
-- CASCADE only fires when the parent job row is removed). The frontend
-- DisputeTimeline component renders these rows in chronological order via
-- GET /api/disputes/:jobId/events.

CREATE TABLE IF NOT EXISTS dispute_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL
              CHECK (event_type IN ('opened', 'evidence_submitted', 'arbitrator_assigned', 'resolved')),
  actor_address TEXT      NOT NULL,
  evidence_id UUID REFERENCES dispute_evidence(id) ON DELETE SET NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timeline reads are always "all events for one job, oldest first".
CREATE INDEX IF NOT EXISTS idx_dispute_events_job_created
  ON dispute_events (job_id, created_at ASC);

-- Evidence lookups: which timeline events reference a given evidence file.
CREATE INDEX IF NOT EXISTS idx_dispute_events_evidence
  ON dispute_events (evidence_id)
  WHERE evidence_id IS NOT NULL;

-- ─────────────────────────────────────────
-- Backfill existing disputes so historical timelines are not empty.
-- 'opened' is derived from the disputes row (job_id, raised_by, created_at);
-- 'resolved' from a resolved disputes row (resolved_by, resolved_at).
-- arbitrator_assigned / evidence_submitted have no reliable historical actor
-- data, so only future events are recorded for them.
-- ─────────────────────────────────────────
INSERT INTO dispute_events (job_id, event_type, actor_address, created_at)
SELECT d.job_id, 'opened', d.raised_by, d.created_at
FROM disputes d
WHERE NOT EXISTS (
  SELECT 1 FROM dispute_events de
  WHERE de.job_id = d.job_id AND de.event_type = 'opened'
);

INSERT INTO dispute_events (job_id, event_type, actor_address, payload, created_at)
SELECT d.job_id, 'resolved', d.resolved_by,
       jsonb_build_object('resolution', d.resolution),
       d.resolved_at
FROM disputes d
WHERE d.status = 'resolved'
  AND d.resolved_by IS NOT NULL
  AND d.resolved_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dispute_events de
    WHERE de.job_id = d.job_id AND de.event_type = 'resolved'
  );
