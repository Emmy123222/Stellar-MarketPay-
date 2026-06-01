-- ─────────────────────────────────────────
-- indexer_state — Tracks the indexer's sync position
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indexer_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  synced              BOOLEAN NOT NULL DEFAULT false,
  last_processed_ledger INTEGER,
  last_transaction_at TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed the singleton row
INSERT INTO indexer_state (id, synced, last_processed_ledger, last_transaction_at, updated_at)
VALUES (1, false, NULL, NULL, NOW())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────
-- contract_events — Stores Soroban contract events
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  contract_id     TEXT,
  tx_hash         TEXT,
  ledger          INTEGER,
  data            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contract_events_job_id_idx     ON contract_events(job_id);
CREATE INDEX IF NOT EXISTS contract_events_event_type_idx ON contract_events(event_type);
CREATE INDEX IF NOT EXISTS contract_events_created_at_idx ON contract_events(created_at DESC);
