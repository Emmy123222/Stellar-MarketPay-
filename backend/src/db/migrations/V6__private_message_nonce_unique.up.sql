DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'private_messages_nonce_key'
  ) THEN
    ALTER TABLE private_messages
      ADD CONSTRAINT private_messages_nonce_key UNIQUE (nonce);
  END IF;
END $$;
