ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_job_id_rater_address_rated_address_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ratings_job_id_rater_address_key'
      AND conrelid = 'ratings'::regclass
  ) THEN
    ALTER TABLE ratings
      ADD CONSTRAINT ratings_job_id_rater_address_key
      UNIQUE (job_id, rater_address);
  END IF;
END $$;
