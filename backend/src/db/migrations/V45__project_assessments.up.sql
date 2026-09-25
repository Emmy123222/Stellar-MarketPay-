CREATE TABLE IF NOT EXISTS project_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address TEXT NOT NULL REFERENCES profiles(public_key),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  time_limit_minutes INTEGER NOT NULL CHECK (time_limit_minutes > 0),
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_assessments_client_idx ON project_assessments(client_address);
CREATE INDEX IF NOT EXISTS project_assessments_job_idx ON project_assessments(job_id);

CREATE TABLE IF NOT EXISTS project_assessment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES project_assessments(id) ON DELETE CASCADE,
  freelancer_address TEXT NOT NULL REFERENCES profiles(public_key),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('started', 'submitted', 'graded')),
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, freelancer_address)
);

CREATE INDEX IF NOT EXISTS project_assessment_submissions_freelancer_idx ON project_assessment_submissions(freelancer_address);
CREATE INDEX IF NOT EXISTS project_assessment_submissions_assessment_idx ON project_assessment_submissions(assessment_id);
