-- V58__idx_escrow_freelancer_date.up.sql
-- Add freelancer_id to escrow_releases and create a composite index for Issue #1450

ALTER TABLE escrow_releases ADD COLUMN IF NOT EXISTS freelancer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_escrow_freelancer_date ON escrow_releases(freelancer_id, released_at);
