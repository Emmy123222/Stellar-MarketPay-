-- Talent pool: clients save favourite freelancers (Issue #1550)
CREATE TABLE IF NOT EXISTS talent_pool (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address   TEXT        NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  freelancer_address TEXT      NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_address, freelancer_address)
);

CREATE INDEX idx_talent_pool_client ON talent_pool(client_address);
