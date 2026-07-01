-- Issue #540: Rollback GIN index for job skills array

DROP INDEX IF EXISTS jobs_skills_gin;
