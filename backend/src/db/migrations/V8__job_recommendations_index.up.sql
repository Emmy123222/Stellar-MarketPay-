-- V6__job_recommendations_index.up.sql
-- Add index to improve job recommendations query performance

-- Index for filtering applications by freelancer and job
CREATE INDEX IF NOT EXISTS idx_applications_freelancer_job 
ON applications(freelancer_address, job_id);

-- Index for job status and visibility filtering
CREATE INDEX IF NOT EXISTS idx_jobs_status_visibility 
ON jobs(status, visibility) WHERE status = 'open' AND visibility = 'public';

-- Index for job skills array (GIN index for array overlap operations)
CREATE INDEX IF NOT EXISTS idx_jobs_skills_gin 
ON jobs USING GIN(skills);
