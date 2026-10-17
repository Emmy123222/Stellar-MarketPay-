-- V58 rollback: remove refresh token storage

DROP INDEX IF EXISTS idx_refresh_tokens_expires_at;
DROP INDEX IF EXISTS idx_refresh_tokens_public_key;
DROP INDEX IF EXISTS idx_refresh_tokens_family_id;

DROP TABLE IF EXISTS refresh_tokens;
