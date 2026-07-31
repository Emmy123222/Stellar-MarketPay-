DROP INDEX IF EXISTS jobs_status_created_at_desc_idx;
-- Notice: applications_job_id_idx and idx_notifications_user_created_at might have been created by previous migrations
-- Dropping them here is conditionally safe if we only want to drop what this migration strictly needed.
-- But since IF NOT EXISTS was used, dropping them here might drop indexes created by V1 and V10.
-- We will only drop jobs_status_created_at_desc_idx and escrows_job_id_idx for safety.
DROP INDEX IF EXISTS escrows_job_id_idx;
