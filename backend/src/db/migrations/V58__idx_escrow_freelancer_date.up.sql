-- Issue #1450: Composite index on escrow_releases(freelancer_id, released_at)
-- Eliminates full table sequential scan in insightsService.getFreelancerEarnings()
-- and enables PostgreSQL index-only scans for monthly freelancer earnings aggregation.

ALTER TABLE escrow_releases
  ADD COLUMN IF NOT EXISTS freelancer_id TEXT;

-- Backfill freelancer_id from jobs for existing records
UPDATE escrow_releases er
SET freelancer_id = j.freelancer_address
FROM jobs j
WHERE er.job_id = j.id AND er.freelancer_id IS NULL;

-- Composite B-tree index supporting GROUP BY / range filtering on freelancer_id and released_at
CREATE INDEX IF NOT EXISTS idx_escrow_freelancer_date
  ON escrow_releases(freelancer_id, released_at);
