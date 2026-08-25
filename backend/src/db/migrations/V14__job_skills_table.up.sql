-- V14__job_skills_table.up.sql

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT
);

CREATE TABLE IF NOT EXISTS job_skills (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);

-- Seed existing skills from jobs
INSERT INTO skills (slug, display_name)
SELECT DISTINCT LOWER(TRIM(skill)), TRIM(skill)
FROM jobs, unnest(skills) as skill
WHERE skill IS NOT NULL AND skill != ''
ON CONFLICT (slug) DO NOTHING;

-- Populate job_skills
INSERT INTO job_skills (job_id, skill_id)
SELECT j.id, s.id
FROM jobs j, unnest(j.skills) as skill
JOIN skills s ON s.slug = LOWER(TRIM(skill))
ON CONFLICT DO NOTHING;

-- We can drop the old skills column from jobs eventually, but for now we keep it
-- or we can drop it. The AC says "jobs.skills TEXT[] allows free-text skills causing duplicates... POST /api/jobs normalises input skills".
-- Drop job_search_vector so we can drop skills
ALTER TABLE jobs DROP COLUMN IF EXISTS job_search_vector;

ALTER TABLE jobs DROP COLUMN IF EXISTS skills;

-- Recreate without skills
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(description, '')), 'B')
  ) STORED;

-- Recreate index
CREATE INDEX IF NOT EXISTS jobs_search_vector_idx ON jobs USING GIN (job_search_vector);

