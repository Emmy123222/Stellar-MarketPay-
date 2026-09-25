ALTER TABLE profiles
  DROP COLUMN IF EXISTS encrypted_email,
  DROP COLUMN IF EXISTS encrypted_webhook_secret;
