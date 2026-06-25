DROP INDEX IF EXISTS messages_attachment_cid_idx;
ALTER TABLE messages
  DROP COLUMN IF EXISTS attachment_cid,
  DROP COLUMN IF EXISTS attachment_name,
  DROP COLUMN IF EXISTS attachment_size,
  DROP COLUMN IF EXISTS attachment_mime,
  DROP COLUMN IF EXISTS sender_nacl_pub;
