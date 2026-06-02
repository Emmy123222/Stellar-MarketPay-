-- V6__onchain_message_fields.down.sql
DROP INDEX IF EXISTS messages_ipfs_cid_idx;
DROP INDEX IF EXISTS messages_tx_hash_idx;

ALTER TABLE messages
  DROP COLUMN IF EXISTS ipfs_cid,
  DROP COLUMN IF EXISTS tx_hash;
