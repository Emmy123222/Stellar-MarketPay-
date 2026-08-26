-- Indexes for advanced job search filters (#280)

CREATE INDEX IF NOT EXISTS jobs_budget_idx ON jobs(budget);
CREATE INDEX IF NOT EXISTS jobs_skills_gin_idx ON jobs USING GIN (skills);
CREATE INDEX IF NOT EXISTS jobs_applicant_count_idx ON jobs(applicant_count);
CREATE INDEX IF NOT EXISTS jobs_deadline_idx ON jobs(deadline);
