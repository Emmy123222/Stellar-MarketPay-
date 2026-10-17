-- V58__sponsorship_credits.up.sql
CREATE TABLE IF NOT EXISTS sponsorship_credits (
  freelancer_id VARCHAR(64) PRIMARY KEY,
  credits_remaining INTEGER NOT NULL DEFAULT 5 CHECK (credits_remaining >= 0),
  total_sponsored INTEGER NOT NULL DEFAULT 0 CHECK (total_sponsored >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS sponsorship_credits_freelancer_idx ON sponsorship_credits(freelancer_id);
