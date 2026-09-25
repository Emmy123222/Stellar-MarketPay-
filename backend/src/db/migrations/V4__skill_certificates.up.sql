CREATE TABLE IF NOT EXISTS skill_certificates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key        TEXT        NOT NULL REFERENCES profiles(public_key),
  skill             TEXT        NOT NULL,
  score             INTEGER     NOT NULL CHECK (score >= 0 AND score <= 100),
  certificate_hash  TEXT        NOT NULL UNIQUE,
  ipfs_cid          TEXT,
  tx_hash           TEXT,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_certificates_pkey_skill_idx ON skill_certificates(public_key, skill);
CREATE INDEX IF NOT EXISTS skill_certificates_public_key_idx ON skill_certificates(public_key);
CREATE INDEX IF NOT EXISTS skill_certificates_skill_idx ON skill_certificates(skill);
