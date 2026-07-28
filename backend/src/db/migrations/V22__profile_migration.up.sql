-- V22: Add migrated_to column for Stellar account merge support (#885)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_to TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_migrated_to_idx ON profiles(migrated_to)
  WHERE migrated_to IS NOT NULL;
