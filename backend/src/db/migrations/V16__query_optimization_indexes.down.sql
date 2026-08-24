-- Issue #340 rollback
DROP INDEX IF EXISTS profiles_public_key_rating_idx;
DROP INDEX IF EXISTS ratings_rated_created_idx;
DROP INDEX IF EXISTS applications_job_created_idx;
DROP INDEX IF EXISTS jobs_description_trgm_idx;
DROP INDEX IF EXISTS jobs_title_trgm_idx;
DROP INDEX IF EXISTS jobs_search_vector_idx;
DROP INDEX IF EXISTS jobs_status_category_created_idx;
DROP INDEX IF EXISTS jobs_open_public_created_idx;

ALTER TABLE jobs
  DROP COLUMN IF EXISTS job_search_vector;

DROP FUNCTION IF EXISTS array_to_string_immutable(TEXT[], TEXT);
