-- V22: Append-only audit log for tracking all state-changing operations
-- Financial applications need an immutable audit trail. Every state-changing
-- operation (job status change, escrow release, dispute filing, etc.) should
-- be logged with before/after snapshots so that any change can be traced.

CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_address   TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  entity_type     TEXT        NOT NULL,
  entity_id       TEXT        NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS audit_log_entity_idx     ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx      ON audit_log(actor_address);
CREATE INDEX IF NOT EXISTS audit_log_action_idx     ON audit_log(action);
CREATE INDEX IF NOT EXISTS audit_log_created_idx    ON audit_log(created_at DESC);

-- Row-level security note: This table is append-only by convention.
-- No UPDATE or DELETE triggers are provided. Application code must never
-- issue UPDATE or DELETE against this table.
