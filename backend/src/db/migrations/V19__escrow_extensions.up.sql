-- V19: Escrow timeout extension by mutual consent
-- Tracks pending and approved on-chain extension requests
-- so the DB stays consistent with the Soroban contract state.

CREATE TABLE IF NOT EXISTS escrow_extensions (
  id                 SERIAL       PRIMARY KEY,
  job_id             TEXT         NOT NULL,
  requested_by       TEXT         NOT NULL,
  new_timeout_ledger INTEGER      NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending',
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_extensions_job_id
  ON escrow_extensions(job_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_extensions_pending_job
  ON escrow_extensions(job_id) WHERE status = 'pending';
