-- Idempotent schema.  Run via migrate.js on every startup.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reputation_points INTEGER     NOT NULL DEFAULT 0,
  referral_count    INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS portfolio_items JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS availability JSONB;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS blocked_addresses TEXT[] NOT NULL DEFAULT '{}';

-- Weekly digest fields (V5)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email                   TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS digest_unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_digest_unsubscribe_token_idx
  ON profiles(digest_unsubscribe_token);

-- ─────────────────────────────────────────
-- jobs
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  budget              NUMERIC(20,7) NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'XLM',
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
  milestones          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  dispute_reason      TEXT,
  dispute_description TEXT,
  disputed_by         TEXT        REFERENCES profiles(public_key),
  disputed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  extended_count      INTEGER     NOT NULL DEFAULT 0,
  extended_until      TIMESTAMPTZ,
  view_count          INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS boosted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS boosted_until TIMESTAMPTZ;

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
  ADD COLUMN IF NOT EXISTS extended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bidding_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C')
  ) STORED;

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
  referred_by         TEXT        REFERENCES profiles(public_key),
  UNIQUE (job_id, freelancer_address)              -- prevent duplicate applications
);

CREATE INDEX IF NOT EXISTS applications_job_id_idx             ON applications(job_id);
CREATE INDEX IF NOT EXISTS applications_freelancer_address_idx ON applications(freelancer_address);
CREATE INDEX IF NOT EXISTS applications_job_created_idx        ON applications(job_id, created_at ASC);

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
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nonce)
);

CREATE INDEX IF NOT EXISTS private_messages_participants_idx
  ON private_messages(sender_address, recipient_address, created_at DESC);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'XLM',
  ADD COLUMN IF NOT EXISTS screening_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bid_commitment TEXT,
  ADD COLUMN IF NOT EXISTS bid_nonce TEXT,
  ADD COLUMN IF NOT EXISTS bid_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revealed_bid_amount NUMERIC(20,7),
  ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

-- ─────────────────────────────────────────
-- escrows  (schema only; populated by smart-contract layer)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL UNIQUE REFERENCES jobs(id),
  contract_id         TEXT        NOT NULL,
  amount_xlm          NUMERIC(20,7) NOT NULL,
  milestones          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT        NOT NULL DEFAULT 'funded',   -- funded | released | refunded | timeout_refunded
  released_at         TIMESTAMPTZ,                 -- When the escrow was released
  timeout_at          TIMESTAMPTZ,                 -- Issue #175: Ledger timeout mapped to wall-clock (approx)
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
CREATE INDEX IF NOT EXISTS ratings_rated_created_idx ON ratings(rated_address, created_at DESC);

-- ─────────────────────────────────────────
-- query optimization indexes
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS jobs_open_public_created_idx
  ON jobs(created_at DESC, id DESC)
  WHERE status = 'open' AND visibility = 'public';

CREATE INDEX IF NOT EXISTS jobs_status_category_created_idx
  ON jobs(status, category, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_search_vector_idx
  ON jobs USING GIN (job_search_vector);

CREATE INDEX IF NOT EXISTS jobs_title_trgm_idx
  ON jobs USING GIN (lower(title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS jobs_description_trgm_idx
  ON jobs USING GIN (lower(description) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_public_key_rating_idx
  ON profiles(public_key, rating);

-- ─────────────────────────────────────────
-- messages
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_address   TEXT        NOT NULL REFERENCES profiles(public_key),
  receiver_address TEXT        NOT NULL REFERENCES profiles(public_key),
  content          TEXT        NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),
  read             BOOLEAN    NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- referrals — tracks who referred whom and bonus payout status
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_address TEXT        NOT NULL REFERENCES profiles(public_key),
  referee_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  job_id           UUID        REFERENCES jobs(id),          -- first job that triggered payout
  status           TEXT        NOT NULL DEFAULT 'pending',   -- pending | paid | ineligible
  payout_amount    NUMERIC(20,7),                            -- XLM paid to referrer (2% of job earnings)
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referrer_address, referee_address)                 -- one referral relationship per pair
);

CREATE INDEX IF NOT EXISTS referrals_referrer_address_idx ON referrals(referrer_address);
CREATE INDEX IF NOT EXISTS referrals_referee_address_idx  ON referrals(referee_address);
CREATE INDEX IF NOT EXISTS referrals_job_id_idx           ON referrals(job_id);

-- ─────────────────────────────────────────
-- referral_payouts — audit log of every XLM bonus sent
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id      UUID        NOT NULL REFERENCES referrals(id),
  referrer_address TEXT        NOT NULL REFERENCES profiles(public_key),
  referee_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  job_id           UUID        NOT NULL REFERENCES jobs(id),
  amount_xlm       NUMERIC(20,7) NOT NULL,
  contract_tx_hash TEXT,                                     -- on-chain tx hash from release_escrow
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_payouts_referrer_idx ON referral_payouts(referrer_address);
CREATE INDEX IF NOT EXISTS referral_payouts_referee_idx  ON referral_payouts(referee_address);

-- ─────────────────────────────────────────
-- scope_sessions (real-time collaborative editor — Issue #227)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_sessions (
  session_id        TEXT PRIMARY KEY,
  content           TEXT          NOT NULL DEFAULT '',
  cursors           JSONB         NOT NULL DEFAULT '{}'::jsonb,
  finalized         BOOLEAN       NOT NULL DEFAULT false,
  finalized_payload JSONB,
  expires_at        TIMESTAMPTZ   NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scope_sessions_expires_at_idx ON scope_sessions(expires_at);

-- ─────────────────────────────────────────
-- webauthn_credentials (passkey auth — Issue #218)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key       TEXT  NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  credential_id    TEXT  NOT NULL UNIQUE,
  credential_name  TEXT  NOT NULL DEFAULT 'Passkey',
  public_key_cose  TEXT  NOT NULL,
  counter          BIGINT NOT NULL DEFAULT 0,
  transports       TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_public_key_idx ON webauthn_credentials(public_key);

-- ─────────────────────────────────────────
-- dispute_evidence (IPFS evidence upload — Issue #223)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID  NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploader_address TEXT  NOT NULL REFERENCES profiles(public_key),
  file_name        TEXT  NOT NULL,
  file_size        INTEGER NOT NULL,
  mime_type        TEXT  NOT NULL,
  ipfs_cid         TEXT  NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dispute_evidence_job_id_idx ON dispute_evidence(job_id);

-- ─────────────────────────────────────────
-- time_entries  (Issue #346 — time tracking)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  duration_minutes    INTEGER     NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  description         TEXT,
  started_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_entries_job_id_idx         ON time_entries(job_id);
CREATE INDEX IF NOT EXISTS time_entries_freelancer_idx     ON time_entries(freelancer_address);

-- ─────────────────────────────────────────
-- time_invoices  (Issue #346 — billing)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_invoices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  total_minutes       INTEGER     NOT NULL CHECK (total_minutes > 0),
  hourly_rate_xlm     NUMERIC(20,7) NOT NULL,
  total_amount_xlm    NUMERIC(20,7) NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  entry_ids           UUID[]      NOT NULL DEFAULT '{}',
  contract_tx_hash    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_invoices_job_id_idx        ON time_invoices(job_id);
CREATE INDEX IF NOT EXISTS time_invoices_freelancer_idx    ON time_invoices(freelancer_address);
CREATE INDEX IF NOT EXISTS time_invoices_client_idx        ON time_invoices(client_address);

-- ─────────────────────────────────────────
-- job_invitations  (Issue #342 — direct invitations)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_invitations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, freelancer_address)
);

CREATE INDEX IF NOT EXISTS job_invitations_freelancer_idx ON job_invitations(freelancer_address);
CREATE INDEX IF NOT EXISTS job_invitations_job_id_idx     ON job_invitations(job_id);

-- Add status column to existing job_invitations if it was created without it
ALTER TABLE job_invitations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'accepted', 'declined'));

-- ─────────────────────────────────────────
-- notification_queue additions (in_app type support)
-- ─────────────────────────────────────────
-- Allow 'in_app' as a notification_type in addition to 'email' and 'webhook'
-- The notification_queue table was created without a CHECK constraint on
-- notification_type so this is a no-op schema change (just documentation).
