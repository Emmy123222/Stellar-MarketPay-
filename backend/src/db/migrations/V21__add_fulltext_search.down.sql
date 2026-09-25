DROP TRIGGER IF EXISTS trg_jobs_search_vector ON jobs;
DROP FUNCTION IF EXISTS jobs_search_vector_update();
DROP INDEX IF EXISTS jobs_search_vector_idx;
ALTER TABLE jobs DROP COLUMN IF EXISTS search_vector;
