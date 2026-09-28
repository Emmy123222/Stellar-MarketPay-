DROP INDEX IF EXISTS dispute_evidence_unpinned_idx;

ALTER TABLE dispute_evidence
  DROP COLUMN IF EXISTS pinned;
