CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);
