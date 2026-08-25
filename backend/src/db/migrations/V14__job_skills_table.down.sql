-- V14__job_skills_table.down.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';

-- Best effort restore
UPDATE jobs j
SET skills = (
    SELECT array_agg(s.display_name)
    FROM job_skills js
    JOIN skills s ON js.skill_id = s.id
    WHERE js.job_id = j.id
);

-- Recreate search vector with skills
ALTER TABLE jobs DROP COLUMN IF EXISTS job_search_vector;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS jobs_search_vector_idx ON jobs USING GIN (job_search_vector);

DROP TABLE IF EXISTS job_skills;
DROP TABLE IF EXISTS skills;
