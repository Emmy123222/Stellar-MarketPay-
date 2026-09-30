-- Issue #876: Rollback job_timeline table

DROP INDEX IF EXISTS idx_job_timeline_tx_hash;
DROP INDEX IF EXISTS idx_job_timeline_job_id_created;
DROP TABLE IF EXISTS job_timeline;
