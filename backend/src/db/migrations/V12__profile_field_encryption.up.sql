CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS encrypted_email TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_webhook_secret TEXT;

UPDATE profiles
   SET encrypted_email = pgp_sym_encrypt(COALESCE(email, ''), current_setting('app.database_encryption_key')),
       encrypted_webhook_secret = pgp_sym_encrypt(COALESCE(webhook_secret, ''), current_setting('app.database_encryption_key'))
 WHERE email IS NOT NULL OR webhook_secret IS NOT NULL;
