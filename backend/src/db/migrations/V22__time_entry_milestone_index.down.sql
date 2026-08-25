DROP INDEX IF EXISTS time_entries_milestone_idx;
ALTER TABLE time_entries DROP COLUMN IF EXISTS milestone_index;
