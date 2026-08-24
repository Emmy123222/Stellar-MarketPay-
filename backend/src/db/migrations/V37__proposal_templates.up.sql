-- V21: Proposal templates for freelancers
CREATE TABLE IF NOT EXISTS proposal_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  content             TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proposal_templates_freelancer_idx ON proposal_templates(freelancer_address);
