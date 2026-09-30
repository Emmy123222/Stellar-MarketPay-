-- Rollback Issue #1450: Drop composite index and freelancer_id column from escrow_releases
DROP INDEX IF EXISTS idx_escrow_freelancer_date;
ALTER TABLE escrow_releases DROP COLUMN IF EXISTS freelancer_id;
