CREATE INDEX IF NOT EXISTS jobs_status_created_at_desc_idx ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_job_id_idx ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS escrows_job_id_idx ON escrows(job_id);
