-- Saved search lifecycle fields for alert deactivation and soft deletion.
ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS saved_searches_active_idx
  ON saved_searches(active, deleted_at)
  WHERE active = TRUE AND deleted_at IS NULL;
