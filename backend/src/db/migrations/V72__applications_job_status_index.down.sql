-- V61 down — Issue #1515 rollback.
--
-- Drops only the composite this migration added. The single-column indexes it
-- references (applications_job_id_idx, applications_freelancer_address_idx,
-- idx_applications_status) belong to V1/V57 and are left alone — dropping them
-- here would take down indexes other migrations own, the mistake V48's down
-- file had to work around.

DROP INDEX IF EXISTS idx_applications_job_id_status;
