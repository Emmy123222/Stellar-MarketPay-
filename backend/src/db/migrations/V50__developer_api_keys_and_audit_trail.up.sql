CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_address   TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  target          TEXT,
  reason          TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx    ON audit_logs(actor_address);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx   ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx  ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS frozen_wallets (
  address         TEXT PRIMARY KEY,
  reason          TEXT,
  frozen_by       TEXT        NOT NULL REFERENCES profiles(public_key),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_public_key  TEXT        NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  label             TEXT        NOT NULL DEFAULT 'Developer key',
  key_prefix        TEXT        NOT NULL,
  key_hash          TEXT        NOT NULL UNIQUE,
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_owner_idx      ON api_keys(owner_public_key);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx     ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS api_keys_revoked_idx    ON api_keys(revoked_at);

CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id       UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  usage_date       DATE        NOT NULL,
  request_count    INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (api_key_id, usage_date)
);
