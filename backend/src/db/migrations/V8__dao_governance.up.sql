-- DAO governance tables (#278)

CREATE TABLE IF NOT EXISTS dao_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('treasury', 'platform', 'parameter', 'arbitration')),
  proposer        TEXT NOT NULL,
  amount          NUMERIC(20,7),
  recipient       TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'passed', 'rejected', 'executed')),
  voting_ends_at  TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dao_votes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES dao_proposals(id) ON DELETE CASCADE,
  voter           TEXT NOT NULL,
  support         BOOLEAN NOT NULL,
  weight          NUMERIC(20,7) NOT NULL DEFAULT 1,
  tx_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, voter)
);

CREATE TABLE IF NOT EXISTS dao_arbitrators (
  public_key      TEXT PRIMARY KEY,
  display_name    TEXT,
  bio             TEXT,
  votes_received  INTEGER NOT NULL DEFAULT 0,
  disputes_resolved INTEGER NOT NULL DEFAULT 0,
  elected_at      TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dao_proposals_status_idx ON dao_proposals(status);
CREATE INDEX IF NOT EXISTS dao_votes_proposal_idx ON dao_votes(proposal_id);
