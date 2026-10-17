-- Rollback V22: Remove expires_at from job_invitations
DROP INDEX IF EXISTS job_invitations_expires_at_idx;
ALTER TABLE job_invitations DROP COLUMN IF EXISTS expires_at;
