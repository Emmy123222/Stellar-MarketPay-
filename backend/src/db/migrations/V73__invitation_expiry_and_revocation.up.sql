-- V22: Add expires_at to job_invitations and support revocation (Issue #1389)
-- Invitations now expire after 7 days by default. Expired or accepted invitations
-- are purged by a periodic cleanup job.

ALTER TABLE job_invitations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS job_invitations_expires_at_idx ON job_invitations(expires_at);
