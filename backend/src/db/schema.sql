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
  ADD COLUMN IF NOT EXISTS is_kyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS github_username TEXT,
  ADD COLUMN IF NOT EXISTS github_avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS github_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS github_primary_languages TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS github_top_repos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS github_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portfolio_files JSONB NOT NULL DEFAULT '[]'::jsonb;

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

-- ─────────────────────────────────────────
-- job analytics (Issue #212)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ip_hash         TEXT        NOT NULL,
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_views_job_id_idx ON job_views(job_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS job_views_job_ip_idx ON job_views(job_id, ip_hash);

-- ─────────────────────────────────────────
-- encrypted private messages (Issue #213)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_address        TEXT        NOT NULL REFERENCES profiles(public_key),
  recipient_address     TEXT        NOT NULL REFERENCES profiles(public_key),
  sender_public_key     TEXT        NOT NULL,
  recipient_public_key  TEXT        NOT NULL,
  nonce                 TEXT        NOT NULL,
  cipher_text           TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS private_messages_participants_idx
  ON private_messages(sender_address, recipient_address, created_at DESC);

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
-- job_drafts (Issue #219)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  budget              NUMERIC(20,7) NOT NULL,
  category            TEXT        NOT NULL,
  skills              TEXT[]      NOT NULL DEFAULT '{}',
  currency            TEXT        NOT NULL DEFAULT 'XLM',
  timezone            TEXT,
  visibility          TEXT        NOT NULL DEFAULT 'public',
  screening_questions TEXT[]      NOT NULL DEFAULT '{}',
  deadline            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_drafts_client_idx ON job_drafts(client_address);
CREATE INDEX IF NOT EXISTS job_drafts_updated_at_idx ON job_drafts(updated_at DESC);

-- ─────────────────────────────────────────
-- platform_stats (Issue #232)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_stats (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_jobs_posted   INTEGER     NOT NULL DEFAULT 0,
  total_escrow_xlm    NUMERIC(20,7) NOT NULL DEFAULT 0,
  active_users_30d    INTEGER     NOT NULL DEFAULT 0,
  completion_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_job_budget      NUMERIC(20,7) NOT NULL DEFAULT 0,
  last_updated        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_stats (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────

