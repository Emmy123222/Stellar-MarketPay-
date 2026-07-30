DROP INDEX IF EXISTS profiles_email_hash_idx;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS email_hash,
  DROP COLUMN IF EXISTS encrypted_phone,
  DROP COLUMN IF EXISTS encrypted_kyc_data;
