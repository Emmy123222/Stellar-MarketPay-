-- V6__job_recommendations_index.down.sql
-- Rollback job recommendations indexes

DROP INDEX IF EXISTS idx_applications_freelancer_job;
DROP INDEX IF EXISTS idx_jobs_status_visibility;
DROP INDEX IF EXISTS idx_jobs_skills_gin;
