DELETE FROM ratings a
USING ratings b
WHERE a.job_id = b.job_id
  AND a.rater_address = b.rater_address
  AND a.rated_address = b.rated_address
  AND (
    a.created_at > b.created_at
    OR (a.created_at = b.created_at AND a.id::text > b.id::text)
  );

ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_job_id_rater_address_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ratings_job_id_rater_address_rated_address_key'
      AND conrelid = 'ratings'::regclass
  ) THEN
    ALTER TABLE ratings
      ADD CONSTRAINT ratings_job_id_rater_address_rated_address_key
      UNIQUE (job_id, rater_address, rated_address);
  END IF;
END $$;
