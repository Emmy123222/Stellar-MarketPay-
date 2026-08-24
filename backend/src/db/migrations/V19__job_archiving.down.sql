-- V12__job_archiving.down.sql
--
-- Reverses V12__job_archiving.up.sql.
--
-- WARNING: This rollback does NOT restore rows that have already been moved to
-- the archive tables. It only drops the archiving infrastructure. If you need
-- to restore archived data, INSERT from archived_* back into the live tables
-- before running this script.

DROP VIEW  IF EXISTS archive_candidates;
DROP FUNCTION IF EXISTS archive_jobs();

DROP TABLE IF EXISTS archive_runs;
DROP TABLE IF EXISTS archived_messages;
DROP TABLE IF EXISTS archived_ratings;
DROP TABLE IF EXISTS archived_escrows;
DROP TABLE IF EXISTS archived_applications;
DROP TABLE IF EXISTS archived_jobs;
DROP TABLE IF EXISTS archive_config;
