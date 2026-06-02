-- Admin profiles for TOTP 2FA
CREATE TABLE IF NOT EXISTS admin_profiles (
  id                TEXT PRIMARY KEY,
  email             TEXT,
  totp_secret       TEXT,
  totp_enabled      BOOLEAN NOT NULL DEFAULT false,
  backup_codes      TEXT,
  totp_attempts     INTEGER NOT NULL DEFAULT 0,
  totp_locked_until TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Job posting drafts (server-side auto-save)
CREATE TABLE IF NOT EXISTS job_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address       TEXT NOT NULL,
  title                TEXT,
  description          TEXT,
  budget               NUMERIC(20,7),
  category             TEXT DEFAULT 'general',
  skills               TEXT[] NOT NULL DEFAULT '{}',
  currency             TEXT NOT NULL DEFAULT 'XLM',
  timezone             TEXT,
  visibility           TEXT NOT NULL DEFAULT 'public',
  screening_questions  TEXT[] NOT NULL DEFAULT '{}',
  deadline             TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_drafts_client_address_idx ON job_drafts(client_address);
CREATE INDEX IF NOT EXISTS job_drafts_updated_at_idx ON job_drafts(updated_at DESC);
