-- V53 down: remove account-merge columns and index.

DROP INDEX IF EXISTS profiles_migrated_to_idx;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS migrated_to;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS migrated_at;
