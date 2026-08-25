-- V12__job_archiving.up.sql
--
-- Data Archiving Strategy for Old Completed Jobs
--
-- Rationale: Completed/resolved jobs older than a configurable retention window
-- accumulate in the hot tables (jobs, applications, escrows, etc.) and degrade
-- query performance and backup size over time. This migration creates:
--
--   1. archive_config          – operator-controlled retention settings
--   2. archived_jobs           – mirror of jobs for completed rows
--   3. archived_applications   – mirror of applications for archived jobs
--   4. archived_escrows        – mirror of escrows for archived jobs
--   5. archived_ratings        – mirror of ratings for archived jobs
--   6. archived_messages       – mirror of messages for archived jobs
--   7. archive_runs            – audit log of every archive execution
--   8. archive_jobs()          – stored procedure; called by a scheduled task
--
-- Archivable statuses: jobs where status IN ('completed','cancelled','expired')
-- AND updated_at < NOW() - archive_config.retention_days.
--
-- The procedure moves rows atomically (DELETE + INSERT in one transaction).
-- Read-only reporting queries should target the archived_* tables directly;
-- see docs/data-archiving.md for the full strategy.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Archive configuration table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_config (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  description  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default retention: archive completed jobs older than 365 days
INSERT INTO archive_config (key, value, description) VALUES
  ('retention_days',    '365',  'Minimum age in days before a completed job is archived'),
  ('batch_size',        '500',  'Maximum rows processed per archive_jobs() invocation'),
  ('archive_enabled',   'true', 'Set to false to pause archiving without dropping the procedure')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. archived_jobs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_jobs (
  -- Original job columns
  id                  UUID        NOT NULL,
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  budget              NUMERIC(20,7) NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'XLM',
  category            TEXT        NOT NULL,
  skills              TEXT[]      NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL,
  client_address      TEXT        NOT NULL,
  freelancer_address  TEXT,
  escrow_contract_id  TEXT,
  applicant_count     INTEGER     NOT NULL DEFAULT 0,
  deadline            TIMESTAMPTZ,
  timezone            TEXT,
  screening_questions TEXT[]      NOT NULL DEFAULT '{}',
  milestones          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  dispute_reason      TEXT,
  dispute_description TEXT,
  disputed_by         TEXT,
  disputed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ,
  extended_count      INTEGER     NOT NULL DEFAULT 0,
  extended_until      TIMESTAMPTZ,
  view_count          INTEGER     NOT NULL DEFAULT 0,
  share_count         INTEGER     NOT NULL DEFAULT 0,
  boosted             BOOLEAN     NOT NULL DEFAULT false,
  boosted_until       TIMESTAMPTZ,
  visibility          TEXT        NOT NULL DEFAULT 'public',
  bidding_closed_at   TIMESTAMPTZ,
  -- Archival metadata
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_run_id      BIGINT,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS archived_jobs_client_idx      ON archived_jobs(client_address);
CREATE INDEX IF NOT EXISTS archived_jobs_freelancer_idx  ON archived_jobs(freelancer_address);
CREATE INDEX IF NOT EXISTS archived_jobs_status_idx      ON archived_jobs(status);
CREATE INDEX IF NOT EXISTS archived_jobs_archived_at_idx ON archived_jobs(archived_at DESC);
CREATE INDEX IF NOT EXISTS archived_jobs_created_at_idx  ON archived_jobs(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. archived_applications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_applications (
  id                  UUID        NOT NULL,
  job_id              UUID        NOT NULL,
  freelancer_address  TEXT        NOT NULL,
  proposal            TEXT        NOT NULL,
  bid_amount          NUMERIC(20,7) NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'XLM',
  status              TEXT        NOT NULL DEFAULT 'pending',
  accepted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL,
  referred_by         TEXT,
  screening_answers   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  withdrawn_at        TIMESTAMPTZ,
  bid_commitment      TEXT,
  bid_nonce           TEXT,
  bid_revealed        BOOLEAN     NOT NULL DEFAULT FALSE,
  revealed_bid_amount NUMERIC(20,7),
  revealed_at         TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_run_id      BIGINT,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS archived_applications_job_id_idx        ON archived_applications(job_id);
CREATE INDEX IF NOT EXISTS archived_applications_freelancer_idx    ON archived_applications(freelancer_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. archived_escrows
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_escrows (
  id          UUID        NOT NULL,
  job_id      UUID        NOT NULL,
  contract_id TEXT        NOT NULL,
  amount_xlm  NUMERIC(20,7) NOT NULL,
  milestones  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT        NOT NULL,
  released_at TIMESTAMPTZ,
  timeout_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_run_id BIGINT,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS archived_escrows_job_id_idx ON archived_escrows(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. archived_ratings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_ratings (
  id             UUID    NOT NULL,
  job_id         UUID    NOT NULL,
  rater_address  TEXT    NOT NULL,
  rated_address  TEXT    NOT NULL,
  stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review         TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_run_id BIGINT,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS archived_ratings_job_id_idx     ON archived_ratings(job_id);
CREATE INDEX IF NOT EXISTS archived_ratings_rated_idx      ON archived_ratings(rated_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. archived_messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_messages (
  id               UUID        NOT NULL,
  job_id           UUID        NOT NULL,
  sender_address   TEXT        NOT NULL,
  receiver_address TEXT        NOT NULL,
  content          TEXT        NOT NULL,
  read             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_run_id   BIGINT,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS archived_messages_job_id_idx ON archived_messages(job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. archive_runs — audit log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_runs (
  id              BIGINT      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  jobs_archived   INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running'  -- running | completed | failed
                              CHECK (status IN ('running', 'completed', 'failed')),
  error_message   TEXT,
  retention_days  INTEGER     NOT NULL,
  batch_size      INTEGER     NOT NULL
);

CREATE INDEX IF NOT EXISTS archive_runs_started_at_idx ON archive_runs(started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. archive_jobs() stored procedure
--
-- Moves a batch of archivable jobs (and their dependent rows) from the hot
-- tables into the archived_* tables inside a single transaction.
--
-- Usage:
--   SELECT archive_jobs();
--
-- The procedure respects archive_config entries for:
--   retention_days  – minimum age of the job's updated_at
--   batch_size      – maximum jobs per call (avoids long lock windows)
--   archive_enabled – when 'false', the procedure is a no-op
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_jobs()
RETURNS TABLE (
  run_id        BIGINT,
  jobs_archived INTEGER,
  status        TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_retention_days  INTEGER;
  v_batch_size      INTEGER;
  v_enabled         BOOLEAN;
  v_run_id          BIGINT;
  v_jobs_archived   INTEGER := 0;
  v_cutoff          TIMESTAMPTZ;
  v_job_ids         UUID[];
BEGIN
  -- Read config
  SELECT value::INTEGER INTO v_retention_days
    FROM archive_config WHERE key = 'retention_days';

  SELECT value::INTEGER INTO v_batch_size
    FROM archive_config WHERE key = 'batch_size';

  SELECT value::BOOLEAN INTO v_enabled
    FROM archive_config WHERE key = 'archive_enabled';

  IF NOT v_enabled THEN
    RETURN QUERY SELECT NULL::BIGINT, 0, 'disabled'::TEXT;
    RETURN;
  END IF;

  v_cutoff := NOW() - (v_retention_days || ' days')::INTERVAL;

  -- Open an audit run record
  INSERT INTO archive_runs (retention_days, batch_size)
    VALUES (v_retention_days, v_batch_size)
    RETURNING id INTO v_run_id;

  BEGIN
    -- Identify candidates: completed/cancelled/expired jobs older than retention window
    SELECT ARRAY_AGG(id) INTO v_job_ids
      FROM (
        SELECT id
          FROM jobs
         WHERE status IN ('completed', 'cancelled', 'expired')
           AND updated_at < v_cutoff
         ORDER BY updated_at ASC
         LIMIT v_batch_size
           FOR UPDATE SKIP LOCKED
      ) candidates;

    IF v_job_ids IS NULL OR array_length(v_job_ids, 1) = 0 THEN
      UPDATE archive_runs
         SET finished_at   = NOW(),
             jobs_archived = 0,
             status        = 'completed'
       WHERE id = v_run_id;

      RETURN QUERY SELECT v_run_id, 0, 'completed'::TEXT;
      RETURN;
    END IF;

    -- ── Archive dependent rows first (FK order) ──────────────────────────────

    -- ratings
    INSERT INTO archived_ratings
      (id, job_id, rater_address, rated_address, stars, review, created_at, archive_run_id)
    SELECT id, job_id, rater_address, rated_address, stars, review, created_at, v_run_id
      FROM ratings
     WHERE job_id = ANY(v_job_ids);

    DELETE FROM ratings WHERE job_id = ANY(v_job_ids);

    -- messages
    INSERT INTO archived_messages
      (id, job_id, sender_address, receiver_address, content, read, created_at, archive_run_id)
    SELECT id, job_id, sender_address, receiver_address, content, read, created_at, v_run_id
      FROM messages
     WHERE job_id = ANY(v_job_ids);

    DELETE FROM messages WHERE job_id = ANY(v_job_ids);

    -- applications
    INSERT INTO archived_applications (
      id, job_id, freelancer_address, proposal, bid_amount, currency, status,
      accepted_at, created_at, referred_by, screening_answers, withdrawn_at,
      bid_commitment, bid_nonce, bid_revealed, revealed_bid_amount, revealed_at,
      archive_run_id
    )
    SELECT id, job_id, freelancer_address, proposal, bid_amount, currency, status,
           accepted_at, created_at, referred_by, screening_answers, withdrawn_at,
           bid_commitment, bid_nonce, bid_revealed, revealed_bid_amount, revealed_at,
           v_run_id
      FROM applications
     WHERE job_id = ANY(v_job_ids);

    DELETE FROM applications WHERE job_id = ANY(v_job_ids);

    -- escrows
    INSERT INTO archived_escrows
      (id, job_id, contract_id, amount_xlm, milestones, status, released_at,
       timeout_at, created_at, updated_at, archive_run_id)
    SELECT id, job_id, contract_id, amount_xlm, milestones, status, released_at,
           timeout_at, created_at, updated_at, v_run_id
      FROM escrows
     WHERE job_id = ANY(v_job_ids);

    DELETE FROM escrows WHERE job_id = ANY(v_job_ids);

    -- ── Archive the jobs themselves ──────────────────────────────────────────
    INSERT INTO archived_jobs (
      id, title, description, budget, currency, category, skills, status,
      client_address, freelancer_address, escrow_contract_id, applicant_count,
      deadline, timezone, screening_questions, milestones, dispute_reason,
      dispute_description, disputed_by, disputed_at, created_at, updated_at,
      expires_at, extended_count, extended_until, view_count, share_count,
      boosted, boosted_until, visibility, bidding_closed_at, archive_run_id
    )
    SELECT
      id, title, description, budget, currency, category, skills, status,
      client_address, freelancer_address, escrow_contract_id, applicant_count,
      deadline, timezone, screening_questions, milestones, dispute_reason,
      dispute_description, disputed_by, disputed_at, created_at, updated_at,
      expires_at, extended_count, extended_until, view_count, share_count,
      boosted, boosted_until, visibility, bidding_closed_at, v_run_id
      FROM jobs
     WHERE id = ANY(v_job_ids);

    GET DIAGNOSTICS v_jobs_archived = ROW_COUNT;

    DELETE FROM jobs WHERE id = ANY(v_job_ids);

    -- ── Finalize audit record ────────────────────────────────────────────────
    UPDATE archive_runs
       SET finished_at   = NOW(),
           jobs_archived = v_jobs_archived,
           status        = 'completed'
     WHERE id = v_run_id;

    RETURN QUERY SELECT v_run_id, v_jobs_archived, 'completed'::TEXT;

  EXCEPTION WHEN OTHERS THEN
    UPDATE archive_runs
       SET finished_at   = NOW(),
           status        = 'failed',
           error_message = SQLERRM
     WHERE id = v_run_id;

    RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION archive_jobs() IS
  'Moves a batch of old completed/cancelled/expired jobs (and their dependents) '
  'to the archived_* tables. Batch size and retention window are controlled by '
  'the archive_config table. See docs/data-archiving.md for the full strategy.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Convenience view: jobs eligible for archiving on the next run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW archive_candidates AS
SELECT j.id,
       j.status,
       j.updated_at,
       NOW() - j.updated_at AS age,
       (SELECT value::INTEGER FROM archive_config WHERE key = 'retention_days') AS retention_days
  FROM jobs j
 WHERE j.status IN ('completed', 'cancelled', 'expired')
   AND j.updated_at < NOW() - (
         (SELECT value FROM archive_config WHERE key = 'retention_days') || ' days'
       )::INTERVAL
 ORDER BY j.updated_at ASC;

COMMENT ON VIEW archive_candidates IS
  'Read-only view of jobs that would be archived on the next archive_jobs() invocation.';
