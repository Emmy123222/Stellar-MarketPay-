-- V22 down: Remove migrated_to column
DROP INDEX IF EXISTS profiles_migrated_to_idx;
ALTER TABLE profiles DROP COLUMN IF EXISTS migrated_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS migrated_to;
