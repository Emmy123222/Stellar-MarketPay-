ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS milestone_index INTEGER;

CREATE INDEX IF NOT EXISTS time_entries_milestone_idx
  ON time_entries(job_id, milestone_index);
