DROP INDEX IF EXISTS contract_audit_log_tx_hash_idx;

ALTER TABLE contract_audit_log DROP COLUMN IF EXISTS ledger_sequence;
ALTER TABLE contract_audit_log DROP COLUMN IF EXISTS fee_charged;
ALTER TABLE contract_audit_log DROP COLUMN IF EXISTS event_data;
ALTER TABLE contract_audit_log DROP COLUMN IF EXISTS success;
