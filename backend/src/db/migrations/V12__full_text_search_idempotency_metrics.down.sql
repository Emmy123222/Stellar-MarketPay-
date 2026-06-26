-- Rollback V12: #553, #559, #561

-- Issue #561: platform_metrics
DROP TABLE IF EXISTS platform_metrics CASCADE;

-- Issue #559: composite indexes
DROP INDEX IF EXISTS jobs_status_category;
DROP INDEX IF EXISTS jobs_client_status;
DROP INDEX IF EXISTS jobs_created_desc;

-- Issue #553: health_checks
DROP TABLE IF EXISTS health_checks CASCADE;

-- Issue #553: idempotency_keys
DROP TABLE IF EXISTS idempotency_keys CASCADE;

-- Issue #553: ledger_timestamps
DROP TABLE IF EXISTS ledger_timestamps CASCADE;

-- Issue #553: applications.sealed_bid_data
ALTER TABLE applications
  DROP COLUMN IF EXISTS sealed_bid_data;

-- Issue #553: profiles columns
ALTER TABLE profiles
  DROP COLUMN IF EXISTS preferred_language;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS encryption_public_key;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS deleted_at;

-- Issue #553: jobs columns
ALTER TABLE jobs
  DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE jobs
  DROP COLUMN IF EXISTS tfidf_vector;
