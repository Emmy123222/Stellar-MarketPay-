DROP INDEX IF EXISTS saved_searches_active_idx;

ALTER TABLE saved_searches
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS active;
