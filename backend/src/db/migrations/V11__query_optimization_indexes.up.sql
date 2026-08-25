-- Issue #340: query optimization and text-search acceleration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C')
  ) STORED;

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

CREATE INDEX IF NOT EXISTS applications_job_created_idx
  ON applications(job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ratings_rated_created_idx
  ON ratings(rated_address, created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_public_key_rating_idx
  ON profiles(public_key, rating);
