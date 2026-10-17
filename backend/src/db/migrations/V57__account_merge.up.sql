-- V57: Stellar account merge support (identity migration) — Issue #885
-- The old address is retained and redirected to the replacement account.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_to TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_migrated_to_idx ON profiles(migrated_to)
  WHERE migrated_to IS NOT NULL;
