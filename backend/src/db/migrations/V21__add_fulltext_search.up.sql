-- Add tsvector column for full-text search on job title + description
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- GIN index for fast full-text search queries
CREATE INDEX IF NOT EXISTS jobs_search_vector_idx
  ON jobs USING GIN(search_vector);

-- Trigger function to automatically keep search_vector in sync
CREATE OR REPLACE FUNCTION jobs_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger (fires on INSERT or UPDATE of title/description)
DROP TRIGGER IF EXISTS trg_jobs_search_vector ON jobs;
CREATE TRIGGER trg_jobs_search_vector
  BEFORE INSERT OR UPDATE OF title, description ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION jobs_search_vector_update();

-- Backfill search_vector for existing rows
UPDATE jobs
SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
WHERE search_vector IS NULL;
