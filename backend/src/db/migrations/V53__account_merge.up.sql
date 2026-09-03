-- V53: Stellar account merge support (identity migration) — Issue #885
-- The old address is marked migrated_to = new_address; both stay searchable
-- (the old profile row is kept, not deleted, so lookups can redirect).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_to TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

-- Fast lookup for "does this address redirect, and to where?"
CREATE INDEX IF NOT EXISTS profiles_migrated_to_idx ON profiles(migrated_to)
  WHERE migrated_to IS NOT NULL;
