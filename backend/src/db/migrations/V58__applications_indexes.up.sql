-- Issue #1515 perf: add missing indexes on applications table for frequent filters
-- The applications table has foreign key indexes but lacks composite and
-- filter-specific indexes needed for high-traffic query patterns.

CREATE INDEX IF NOT EXISTS idx_applications_freelancer_id
  ON applications(freelancer_address);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications(status);

CREATE INDEX IF NOT EXISTS idx_applications_job_id_status
  ON applications(job_id, status);

CREATE INDEX IF NOT EXISTS idx_applications_job_id_freelancer_id
  ON applications(job_id, freelancer_address);
