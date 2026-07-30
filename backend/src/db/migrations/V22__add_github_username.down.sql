-- V22 rollback: remove github_username from profiles

DROP INDEX IF EXISTS profiles_github_username_idx;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS github_username;
