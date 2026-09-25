ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at ON jobs(deleted_at)
  WHERE deleted_at IS NOT NULL;
