-- Issue #450: Rollback recurring escrow changes

DROP INDEX IF EXISTS idx_escrows_recurring_active;

ALTER TABLE escrows
  DROP COLUMN IF EXISTS amount_per_release,
  DROP COLUMN IF EXISTS last_release_ledger,
  DROP COLUMN IF EXISTS releases_remaining,
  DROP COLUMN IF EXISTS interval_ledgers,
  DROP COLUMN IF EXISTS is_recurring;
