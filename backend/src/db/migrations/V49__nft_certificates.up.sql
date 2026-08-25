CREATE TABLE IF NOT EXISTS nft_certificates (
  id                 TEXT PRIMARY KEY,
  job_id             TEXT NOT NULL UNIQUE,
  freelancer_address TEXT NOT NULL,
  client_address     TEXT NOT NULL,
  job_title          TEXT NOT NULL,
  amount_xlm         TEXT,
  completion_date    TIMESTAMPTZ,
  tx_hash            TEXT,
  contract_id        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nft_certificates_freelancer_idx
  ON nft_certificates(freelancer_address);

CREATE INDEX IF NOT EXISTS nft_certificates_created_at_idx
  ON nft_certificates(created_at DESC);
