CREATE INDEX IF NOT EXISTS idx_jobs_fts
  ON jobs USING gin(to_tsvector('english', title || ' ' || description));