-- V57__stats_indexes_and_mv.down.sql
-- Drop indexes and materialized view added in V57

DROP MATERIALIZED VIEW IF EXISTS platform_stats_mv;
DROP INDEX IF EXISTS idx_escrows_status;
DROP INDEX IF EXISTS idx_applications_status;
DROP INDEX IF EXISTS idx_jobs_status;
