-- Issue #1561: On-chain reputation score visible before a job starts.
-- One row per user, recalculated asynchronously after each escrow release,
-- dispute resolution and rating.

CREATE TABLE IF NOT EXISTS reputation_scores (
  user_id             TEXT          PRIMARY KEY REFERENCES profiles(public_key) ON DELETE CASCADE,
  score               NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  completed_jobs      INTEGER       NOT NULL DEFAULT 0,
  dispute_rate        NUMERIC(5,4)  NOT NULL DEFAULT 0 CHECK (dispute_rate BETWEEN 0 AND 1),
  avg_response_hours  NUMERIC(10,2),                -- NULL until the user has replied to at least one message/application
  avg_rating          NUMERIC(3,2),                 -- NULL until first rating
  rating_count        INTEGER       NOT NULL DEFAULT 0,
  referral_quality    NUMERIC(5,4)  NOT NULL DEFAULT 0 CHECK (referral_quality BETWEEN 0 AND 1),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reputation_scores_score_idx ON reputation_scores (score DESC);
