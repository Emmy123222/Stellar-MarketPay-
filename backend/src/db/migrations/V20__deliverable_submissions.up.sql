-- V20: Tracks freelancer deliverable hash submissions for off-chain reference
CREATE TABLE IF NOT EXISTS deliverable_submissions (
  id                 SERIAL       PRIMARY KEY,
  job_id             TEXT         NOT NULL,
  freelancer_address TEXT         NOT NULL,
  hash_hex           TEXT         NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliverable_submissions_job_id
  ON deliverable_submissions(job_id);
