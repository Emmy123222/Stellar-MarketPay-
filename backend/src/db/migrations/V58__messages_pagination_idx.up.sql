CREATE INDEX IF NOT EXISTS messages_job_id_created_at_desc_idx
  ON messages(job_id, created_at DESC, id DESC);
