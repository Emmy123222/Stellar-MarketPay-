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
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx          ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_category_idx        ON jobs(category);
CREATE INDEX IF NOT EXISTS jobs_client_address_idx  ON jobs(client_address);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx      ON jobs(created_at DESC);

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
