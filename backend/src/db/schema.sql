-- Idempotent schema.  Run via migrate.js on every startup.

-- ─────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  public_key        TEXT PRIMARY KEY,            -- Stellar G... address
  display_name      TEXT,
  bio               TEXT,
  skills            TEXT[]    NOT NULL DEFAULT '{}',
  portfolio_items   JSONB     NOT NULL DEFAULT '[]'::jsonb,
  availability      JSONB,
  role              TEXT      NOT NULL DEFAULT 'both',
  completed_jobs    INTEGER   NOT NULL DEFAULT 0,
  total_earned_xlm  NUMERIC(20,7) NOT NULL DEFAULT 0,
  rating            NUMERIC(3,2),                -- NULL until first rating
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS portfolio_items JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS availability JSONB;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS did_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_kyc_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────
-- jobs
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  budget              NUMERIC(20,7) NOT NULL,
  category            TEXT        NOT NULL,
  skills              TEXT[]      NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'open',
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  freelancer_address  TEXT        REFERENCES profiles(public_key),
  escrow_contract_id  TEXT,
  applicant_count     INTEGER     NOT NULL DEFAULT 0,
  deadline            TIMESTAMPTZ,
  timezone            TEXT,
  screening_questions TEXT[]      NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  extended_count      INTEGER     NOT NULL DEFAULT 0,
  extended_until      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS jobs_status_idx          ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_category_idx        ON jobs(category);
CREATE INDEX IF NOT EXISTS jobs_client_address_idx  ON jobs(client_address);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx      ON jobs(created_at DESC);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'XLM',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boosted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS boosted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS screening_questions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extended_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extended_until TIMESTAMPTZ;

-- enforce valid visibility values for all rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_visibility_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_visibility_check
      CHECK (visibility IN ('public', 'private', 'invite_only'));
  END IF;
END $$;

-- ─────────────────────────────────────────
-- applications
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id),
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  proposal            TEXT        NOT NULL,
  bid_amount          NUMERIC(20,7) NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending',
  accepted_at         TIMESTAMPTZ,                 -- When the client accepted this application
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, freelancer_address)              -- prevent duplicate applications
);

CREATE INDEX IF NOT EXISTS applications_job_id_idx             ON applications(job_id);
CREATE INDEX IF NOT EXISTS applications_freelancer_address_idx ON applications(freelancer_address);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'XLM',
  ADD COLUMN IF NOT EXISTS screening_answers JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─────────────────────────────────────────
-- escrows  (schema only; populated by smart-contract layer)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL UNIQUE REFERENCES jobs(id),
  contract_id         TEXT        NOT NULL,
  amount_xlm          NUMERIC(20,7) NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'funded',   -- funded | released | refunded
  released_at         TIMESTAMPTZ,                 -- When the escrow was released
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- progress_updates
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        NOT NULL REFERENCES jobs(id),
  author_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  update_text     TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS progress_updates_job_id_idx ON progress_updates(job_id);

-- ─────────────────────────────────────────
-- ratings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        NOT NULL REFERENCES jobs(id),
  rater_address   TEXT        NOT NULL REFERENCES profiles(public_key),
  rated_address   TEXT        NOT NULL REFERENCES profiles(public_key),
  stars           INTEGER     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review          TEXT        CHECK (char_length(review) <= 200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, rater_address)               -- one rating per user per job
);

CREATE INDEX IF NOT EXISTS ratings_rated_address_idx ON ratings(rated_address);
CREATE INDEX IF NOT EXISTS ratings_job_id_idx        ON ratings(job_id);

-- ─────────────────────────────────────────
-- payment_records (on-chain payment mirror)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash             TEXT        NOT NULL UNIQUE,
  operation_id        TEXT        NOT NULL UNIQUE,
  ledger              BIGINT      NOT NULL,
  job_id              UUID        REFERENCES jobs(id),
  from_address        TEXT        NOT NULL,
  to_address          TEXT        NOT NULL,
  amount              NUMERIC(20,7) NOT NULL,
  asset               TEXT        NOT NULL DEFAULT 'XLM',
  memo                TEXT,
  direction           TEXT        NOT NULL DEFAULT 'outbound',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_records_job_id_idx ON payment_records(job_id);
CREATE INDEX IF NOT EXISTS payment_records_ledger_idx ON payment_records(ledger DESC);

-- ─────────────────────────────────────────
-- donor_stats (simple on-chain donor leaderboard)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donor_stats (
  address             TEXT PRIMARY KEY,
  total_donated_xlm   NUMERIC(20,7) NOT NULL DEFAULT 0,
  donation_count      INTEGER       NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- indexer_state (single-row sync cursor)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indexer_state (
  id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced                 BOOLEAN      NOT NULL DEFAULT FALSE,
  last_processed_ledger  BIGINT,
  last_transaction_at    TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (id, synced)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────
-- scope_sessions (real-time scope collaboration history)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_sessions (
  session_id          TEXT PRIMARY KEY,
  content             TEXT        NOT NULL DEFAULT '',
  cursors             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  finalized           BOOLEAN     NOT NULL DEFAULT FALSE,
  finalized_payload   JSONB,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scope_sessions_expires_at_idx ON scope_sessions(expires_at);

-- ─────────────────────────────────────────
-- contract_events (Issue #199)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          TEXT        NOT NULL,                -- May be UUID or contract String ID
  event_type      TEXT        NOT NULL,                -- escrow_created, work_started, etc.
  contract_id     TEXT        NOT NULL,
  tx_hash         TEXT        NOT NULL,
  ledger          BIGINT      NOT NULL,
  data            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contract_events_job_id_idx ON contract_events(job_id);
CREATE INDEX IF NOT EXISTS contract_events_created_at_idx ON contract_events(created_at DESC);

-- ─────────────────────────────────────────
-- contract_audit_log
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   TEXT        NOT NULL,
  caller_address  TEXT        NOT NULL,
  job_id          UUID        REFERENCES jobs(id),
  tx_hash         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contract_audit_log_job_id_idx ON contract_audit_log(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contract_audit_log_caller_idx ON contract_audit_log(caller_address, created_at DESC);

-- ─────────────────────────────────────────
-- job_invitations
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_invitations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, freelancer_address)
);

CREATE INDEX IF NOT EXISTS job_invitations_freelancer_idx ON job_invitations(freelancer_address, created_at DESC);

-- ─────────────────────────────────────────
-- proposal_templates
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  content             TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (freelancer_address, name)
);

CREATE INDEX IF NOT EXISTS proposal_templates_freelancer_idx ON proposal_templates(freelancer_address, updated_at DESC);

-- ─────────────────────────────────────────
-- price_alert_preferences
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alert_preferences (
  freelancer_address          TEXT PRIMARY KEY REFERENCES profiles(public_key) ON DELETE CASCADE,
  min_xlm_price_usd           NUMERIC(20,7),
  max_xlm_price_usd           NUMERIC(20,7),
  email_notifications_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
  email                       TEXT,
  last_min_alert_at           TIMESTAMPTZ,
  last_max_alert_at           TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

