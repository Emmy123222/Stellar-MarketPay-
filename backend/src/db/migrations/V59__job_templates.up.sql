-- V59__job_templates.up.sql
CREATE TABLE IF NOT EXISTS job_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  budget NUMERIC(20, 7),
  currency VARCHAR(10) DEFAULT 'XLM',
  skills TEXT[] DEFAULT '{}',
  screening_questions JSONB DEFAULT '[]'::jsonb,
  milestones JSONB DEFAULT '[]'::jsonb,
  visibility VARCHAR(20) DEFAULT 'public',
  is_recurring BOOLEAN DEFAULT false,
  interval_days VARCHAR(20) DEFAULT '30',
  total_releases VARCHAR(20) DEFAULT '12',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_templates_client_address_idx ON job_templates(client_address);
