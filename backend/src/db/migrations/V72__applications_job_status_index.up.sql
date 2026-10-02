-- ─────────────────────────────────────────
-- V61 — Issue #1515: applications lookup indexes
--
-- The issue asks for indexes on `applications.job_id`, `freelancer_address`
-- and `status`. Those already exist and are deliberately NOT recreated here —
-- a second index over the same columns adds write cost and nothing else:
--
--   applications_job_id_idx             (job_id)                V1__initial_schema, schema.sql
--   applications_freelancer_address_idx (freelancer_address)     V1__initial_schema, schema.sql
--   applications_job_created_idx        (job_id, created_at)     V16__query_optimization_indexes
--   idx_applications_status             (status)                 V57__stats_indexes_and_mv
--
-- `GET /api/jobs/:id/applications` filters on job_id and sorts by created_at,
-- so it is already served by applications_job_created_idx — the seq scan the
-- issue reported is not reproducible against the current schema.
--
-- The remaining gap is the composite for lookups that constrain a job's
-- applications by status, e.g.
--   routes/jobs.js: WHERE job_id = $1 AND status = 'accepted' LIMIT 1
-- which could otherwise only use applications_job_id_idx and then filter.
--
-- IF NOT EXISTS keeps this safe on databases created from schema.sql, which
-- names the same columns; existing rows are untouched.
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_applications_job_id_status
  ON applications(job_id, status);
