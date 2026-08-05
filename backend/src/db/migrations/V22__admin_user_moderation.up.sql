-- V22: Admin user moderation & admin audit log
-- Adds tables/columns for admin user management (ban/unban/flagged/remove)

-- ── admin_audit_log — dedicated audit log for admin actions ──────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_address   TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  target_type     TEXT        NOT NULL,       -- 'user', 'job', 'dispute', etc.
  target_id       TEXT        NOT NULL,
  details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx  ON admin_audit_log(admin_address);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);

-- ── Ban columns on profiles (soft-ban from posting/applying) ─────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS banned_by TEXT REFERENCES profiles(public_key);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- ── Flagged column on profiles for moderation tracking ───────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_flagged_idx ON profiles(flagged)
  WHERE flagged = true;

CREATE INDEX IF NOT EXISTS profiles_banned_idx ON profiles(banned_at)
  WHERE banned_at IS NOT NULL;

-- ── Admin remove columns on jobs (admin soft-delete, distinct from user-initiated deleted_at) ──
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS removed_by TEXT REFERENCES profiles(public_key);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS remove_reason TEXT;

CREATE INDEX IF NOT EXISTS jobs_removed_at_idx ON jobs(removed_at)
  WHERE removed_at IS NOT NULL;
