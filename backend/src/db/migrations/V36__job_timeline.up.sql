-- Issue #876: JobStatusTimeline with on-chain event anchoring
-- Stores timeline events for each job lifecycle stage, with optional tx_hash for on-chain events

CREATE TABLE IF NOT EXISTS job_timeline (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,  -- 'job_posted', 'bid_accepted', 'escrow_funded', 'work_completed', 'escrow_released'
  tx_hash       TEXT,                  -- on-chain transaction hash (NULL for off-chain events)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying timeline by job ordered by creation time
CREATE INDEX IF NOT EXISTS idx_job_timeline_job_id_created
  ON job_timeline (job_id, created_at ASC);

-- Index for looking up events by tx_hash
CREATE INDEX IF NOT EXISTS idx_job_timeline_tx_hash
  ON job_timeline (tx_hash) WHERE tx_hash IS NOT NULL;

-- Backfill existing jobs: insert 'job_posted' events from jobs.created_at
INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at)
SELECT id, 'job_posted', NULL, created_at
FROM jobs
WHERE NOT EXISTS (
  SELECT 1 FROM job_timeline WHERE job_timeline.job_id = jobs.id AND job_timeline.event_type = 'job_posted'
);

-- Backfill 'bid_accepted' events for jobs that have a freelancer assigned
INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at)
SELECT id, 'bid_accepted', NULL, updated_at
FROM jobs
WHERE freelancer_address IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM job_timeline WHERE job_timeline.job_id = jobs.id AND job_timeline.event_type = 'bid_accepted'
  );

-- Backfill 'escrow_funded' events for jobs with an escrow contract ID (tx_hash is NULL since we don't have historical tx hashes)
INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at)
SELECT e.job_id, 'escrow_funded', NULL, e.created_at
FROM escrows e
WHERE NOT EXISTS (
  SELECT 1 FROM job_timeline jt WHERE jt.job_id = e.job_id AND jt.event_type = 'escrow_funded'
);

-- Backfill 'work_completed' events for completed jobs (not yet released — uses job.updated_at)
INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at)
SELECT id, 'work_completed', NULL, updated_at
FROM jobs
WHERE status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM job_timeline jt WHERE jt.job_id = jobs.id AND jt.event_type = 'work_completed'
  );

-- Backfill 'escrow_released' events from escrow_releases table
INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at)
SELECT er.job_id, 'escrow_released', er.tx_hash, er.released_at
FROM escrow_releases er
WHERE NOT EXISTS (
  SELECT 1 FROM job_timeline jt WHERE jt.job_id = er.job_id AND jt.event_type = 'escrow_released'
);
