-- Adds Soroban transaction verification columns to contract_audit_log

CREATE TABLE IF NOT EXISTS contract_audit_log (
  id              SERIAL PRIMARY KEY,
  function_name   TEXT        NOT NULL,
  caller_address  TEXT        NOT NULL,
  job_id          TEXT,
  tx_hash         TEXT        NOT NULL,
  ledger_sequence INTEGER,
  fee_charged     NUMERIC(20,7),
  event_data      JSONB       DEFAULT '[]'::jsonb,
  success         BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_audit_log ADD COLUMN IF NOT EXISTS ledger_sequence INTEGER;
ALTER TABLE contract_audit_log ADD COLUMN IF NOT EXISTS fee_charged     NUMERIC(20,7);
ALTER TABLE contract_audit_log ADD COLUMN IF NOT EXISTS event_data      JSONB       DEFAULT '[]'::jsonb;
ALTER TABLE contract_audit_log ADD COLUMN IF NOT EXISTS success         BOOLEAN     NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS contract_audit_log_tx_hash_idx ON contract_audit_log(tx_hash);
