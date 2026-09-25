-- V38: Add github_username column to profiles
-- Enables reliable matching between platform profiles and GitHub contributor data
-- for the contributor leaderboard (Issue #844)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_username TEXT;

CREATE INDEX IF NOT EXISTS profiles_github_username_idx
  ON profiles(github_username)
  WHERE github_username IS NOT NULL;
