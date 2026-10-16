-- V58__idx_escrow_freelancer_date.down.sql
-- Rollback the composite index and column added in V58

DROP INDEX IF EXISTS idx_escrow_freelancer_date;

ALTER TABLE escrow_releases DROP COLUMN IF EXISTS freelancer_id;
