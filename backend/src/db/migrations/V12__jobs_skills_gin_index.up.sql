-- Issue #540: Add denormalized skills TEXT[] column and GIN index to jobs table
-- Enables efficient filtering using the overlap operator (&&)

-- Add the skills array column if it doesn't exist
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';

-- Back-fill from the job_skills junction table
UPDATE jobs j
SET skills = (
  SELECT COALESCE(array_agg(s.slug ORDER BY s.slug), '{}')
  FROM job_skills js
  JOIN skills s ON s.id = js.skill_id
  WHERE js.job_id = j.id
)
WHERE array_length(j.skills, 1) IS NULL OR j.skills = '{}';

-- GIN index enables the overlap operator (&&) to do an index scan instead of seq scan
CREATE INDEX IF NOT EXISTS jobs_skills_gin ON jobs USING GIN (skills);
