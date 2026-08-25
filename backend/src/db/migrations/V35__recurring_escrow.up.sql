-- Issue #450: Add support for recurring/subscription escrow for retainer contracts

-- Add recurring escrow columns to escrows table
ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interval_ledgers INTEGER,
  ADD COLUMN IF NOT EXISTS releases_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS last_release_ledger INTEGER,
  ADD COLUMN IF NOT EXISTS amount_per_release NUMERIC(20,7);

-- Add index for querying active recurring escrows
CREATE INDEX IF NOT EXISTS idx_escrows_recurring_active 
  ON escrows (job_id) 
  WHERE is_recurring = true AND releases_remaining > 0 AND status = 'funded';
