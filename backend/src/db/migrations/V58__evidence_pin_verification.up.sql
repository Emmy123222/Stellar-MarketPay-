-- Issue #1439: record whether the IPFS pin for an evidence upload was verified.
-- FALSE means the CID was returned by the upload service but the pin could not
-- be confirmed, so the content may be garbage-collected and needs reconciliation.
ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- Surface not-yet-confirmed pins first for reconciliation jobs.
CREATE INDEX IF NOT EXISTS dispute_evidence_unpinned_idx
  ON dispute_evidence(created_at DESC)
  WHERE pinned = FALSE;
