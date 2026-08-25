ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_cid   TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size  INTEGER,
  ADD COLUMN IF NOT EXISTS attachment_mime  TEXT,
  ADD COLUMN IF NOT EXISTS sender_nacl_pub  TEXT;

CREATE INDEX IF NOT EXISTS messages_attachment_cid_idx
  ON messages(attachment_cid) WHERE attachment_cid IS NOT NULL;
