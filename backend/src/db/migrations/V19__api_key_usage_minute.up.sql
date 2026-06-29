-- Per-minute API key usage breakdown for the issue #452 sliding window rate
-- limiter. The daily aggregate table (`api_key_usage_daily` from V4) is kept
-- untouched so existing admin dashboard widgets continue to work. The new
-- minute-level rows let admins see granular traffic spikes and let the rate
-- limiter persist usage beyond the in-Redis TTL (so a request that happened
-- an hour ago is still queryable for analytics).

CREATE TABLE IF NOT EXISTS api_key_usage_minute (
    api_key_id      INTEGER     NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint        TEXT        NOT NULL,
    minute_bucket   TIMESTAMPTZ NOT NULL,
    request_count   INTEGER     NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (api_key_id, endpoint, minute_bucket)
);

-- Effective range scans for "last 60 minutes for key X" and
-- "last 24h totals per endpoint" admin queries.
CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_key_time
    ON api_key_usage_minute (api_key_id, minute_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_endpoint_time
    ON api_key_usage_minute (endpoint, minute_bucket DESC);

-- Lightweight housekeeping: drop minute rows older than 30 days so the table
-- stays small. This deliberately does NOT touch the daily rollup — admins
-- see yearly trends from `api_key_usage_daily`.
-- (Vacuum / purging itself is handled by the existing cron job, this index
-- makes that scan cheap.)
