ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_phone TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_kyc_data TEXT;

CREATE INDEX IF NOT EXISTS profiles_email_hash_idx ON profiles(email_hash);
