-- Issue #232 perf rollback
DROP MATERIALIZED VIEW IF EXISTS platform_stats_mv;
DROP INDEX IF EXISTS idx_jobs_status_cancelled;
DROP INDEX IF EXISTS idx_jobs_status_completed;
DROP INDEX IF EXISTS idx_escrows_status;
DROP INDEX IF EXISTS idx_applications_status;
DROP INDEX IF EXISTS idx_jobs_status;
