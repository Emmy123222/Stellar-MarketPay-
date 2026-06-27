ALTER TABLE api_keys
  DROP COLUMN IF EXISTS rotating_key_hash,
  DROP COLUMN IF EXISTS rotating_at,
  DROP COLUMN IF EXISTS previous_key_hash;
