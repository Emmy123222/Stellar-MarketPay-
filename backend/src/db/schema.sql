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
  dispute_reason      TEXT,
  dispute_description TEXT,
  disputed_by         TEXT        REFERENCES profiles(public_key),
  disputed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  extended_count      INTEGER     NOT NULL DEFAULT 0,
  extended_until      TIMESTAMPTZ
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
  referred_by         TEXT        REFERENCES profiles(public_key),
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

-- ─────────────────────────────────────────
-- skill_assessments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_assessments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key  TEXT        NOT NULL REFERENCES profiles(public_key),
  skill       TEXT        NOT NULL,
  score       INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
  passed      BOOLEAN     NOT NULL,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
-- skill_endorsements
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_endorsements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill             TEXT NOT NULL,
  endorser_address  TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  recipient_address TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (skill, endorser_address, recipient_address)
);

CREATE INDEX IF NOT EXISTS skill_endorsements_recipient_idx ON skill_endorsements(recipient_address, skill);
CREATE INDEX IF NOT EXISTS skill_endorsements_endorser_idx ON skill_endorsements(endorser_address);

-- ─────────────────────────────

