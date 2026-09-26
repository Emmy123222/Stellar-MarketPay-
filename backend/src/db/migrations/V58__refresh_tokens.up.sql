-- Issue #1398: persist refresh tokens (hashed) so they can be rotated on use
-- and replay of an already-used token can be detected.
--
-- Only the SHA-256 hash of a token is stored, never the token itself.
-- Every token issued from one login shares a family_id so a detected replay
-- can revoke the whole chain.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  TEXT        NOT NULL UNIQUE,
  family_id   UUID        NOT NULL,
  public_key  TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id
  ON refresh_tokens (family_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_public_key
  ON refresh_tokens (public_key);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens (expires_at);
