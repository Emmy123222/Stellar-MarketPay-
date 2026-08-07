DROP INDEX IF EXISTS idx_jobs_deleted_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS deleted_at;
