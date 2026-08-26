-- Saved searches for job alert notifications (Issue #284)
CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address TEXT NOT NULL,
  query_params JSONB NOT NULL DEFAULT '{}',
  notify_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Limit to 10 saved searches per user
CREATE INDEX idx_saved_searches_user ON saved_searches(user_address);
