-- Issue #553, #559, #561: Full-text search vectors, cursor pagination indexes,
-- idempotency keys, health_checks, composite indexes, and platform metrics

-- ── Jobs columns: tfidf_vector, deleted_at ───────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS tfidf_vector JSONB;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jobs_deleted_at_idx ON jobs(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── Profiles columns: deleted_at, encryption_public_key, preferred_language ──
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS encryption_public_key TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx ON profiles(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── Applications: sealed_bid_data as BYTEA for encrypted sealed bids ───────
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS sealed_bid_data BYTEA;

-- ── ledger_timestamps table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_timestamps (
  ledger    INTEGER PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL
);

-- ── idempotency_keys table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idempotency_keys_cleanup_idx
  ON idempotency_keys(created_at);

-- ── health_checks table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_checks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service    TEXT NOT NULL,
  status     TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS health_checks_service_idx
  ON health_checks(service, checked_at DESC);

-- ── Issue #559: Composite indexes for common filter patterns ──────────────
CREATE INDEX IF NOT EXISTS jobs_status_category
  ON jobs (status, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS jobs_client_status
  ON jobs (client_address, status);

CREATE INDEX IF NOT EXISTS jobs_created_desc
  ON jobs (created_at DESC)
  WHERE status = 'open';

-- ── Issue #561: platform_metrics time-series table ─────────────────────────
CREATE TABLE IF NOT EXISTS platform_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  granularity TEXT NOT NULL,
  bucket      TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (metric_name, granularity, bucket)
);

CREATE INDEX IF NOT EXISTS platform_metrics_lookup_idx
  ON platform_metrics (metric_name, granularity, bucket DESC);

CREATE INDEX IF NOT EXISTS platform_metrics_cleanup_idx
  ON platform_metrics (bucket)
  WHERE bucket < NOW() - INTERVAL '1 year';
