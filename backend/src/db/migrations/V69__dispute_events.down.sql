-- Rollback Issue #1429 dispute timeline support.
DROP INDEX IF EXISTS idx_dispute_events_evidence;
DROP INDEX IF EXISTS idx_dispute_events_job_created;
DROP TABLE IF EXISTS dispute_events;
