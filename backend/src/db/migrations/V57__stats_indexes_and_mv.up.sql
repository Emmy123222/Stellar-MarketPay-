-- V57__stats_indexes_and_mv.up.sql
-- Add indexes and materialized view for platform stats (Issue #1450)

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);

CREATE MATERIALIZED VIEW IF NOT EXISTS platform_stats_mv AS
SELECT
  (SELECT COUNT(*) FROM jobs WHERE status = 'open') AS open_jobs,
  (SELECT COUNT(*) FROM applications WHERE status = 'accepted') AS accepted_applications,
  (SELECT COUNT(*) FROM escrows WHERE status = 'released') AS released_escrows,
  (SELECT COUNT(*) FROM jobs WHERE status = 'in_progress') AS in_progress_jobs;

CREATE UNIQUE INDEX IF NOT EXISTS platform_stats_mv_singleton_idx ON platform_stats_mv ((1));
