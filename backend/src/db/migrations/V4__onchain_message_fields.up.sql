-- V4__onchain_message_fields.up.sql
-- Adds IPFS CID and Soroban tx hash columns to the messages table
-- for on-chain message notarization via IPFS + Soroban events.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ipfs_cid TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

CREATE INDEX IF NOT EXISTS messages_ipfs_cid_idx ON messages(ipfs_cid) WHERE ipfs_cid IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_tx_hash_idx ON messages(tx_hash) WHERE tx_hash IS NOT NULL;
