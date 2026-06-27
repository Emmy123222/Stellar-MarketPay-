-- V5: Add email, last_login_at, and digest_unsubscribe_token to profiles
-- These fields are required by the weekly job-digest email feature.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email                   TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS digest_unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid();

-- Unique index so token lookups are O(1)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_digest_unsubscribe_token_idx
  ON profiles(digest_unsubscribe_token);
