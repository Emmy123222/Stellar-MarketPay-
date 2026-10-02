-- Issue #1450: Benchmark and EXPLAIN ANALYZE validation for insightsService.getFreelancerEarnings()
-- 
-- Problem:
--   insightsService.getFreelancerEarnings() ran a GROUP BY freelancer_id, DATE_TRUNC('month', created_at)
--   without a supporting index. EXPLAIN ANALYZE showed a sequential scan on large tables.
--
-- Solution:
--   1. Added migration: CREATE INDEX idx_escrow_freelancer_date ON escrow_releases(freelancer_id, released_at)
--   2. Rewrote aggregation query to use escrow_releases(freelancer_id, released_at)
--   3. Added released_at to SELECT list and GROUP BY for index-only scan
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/explain_analyze_issue1450.sql

\echo '================================================================='
\echo 'Running EXPLAIN ANALYZE for Issue #1450: Freelancer Earnings Query'
\echo '================================================================='

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_escrow_freelancer_date
  ON escrow_releases(freelancer_id, released_at);

-- Update statistics for planner accuracy
ANALYZE escrow_releases;

\echo ''
\echo '1. Query plan with Index Scan / Index Only Scan enabled:'
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  freelancer_id,
  TO_CHAR(DATE_TRUNC('month', released_at), 'YYYY-MM') AS month,
  released_at,
  COUNT(*)::int AS earnings_count
FROM escrow_releases
WHERE ($1::text IS NULL OR freelancer_id = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
  AND released_at >= NOW() - INTERVAL '12 months'
GROUP BY freelancer_id, DATE_TRUNC('month', released_at), released_at
ORDER BY month ASC, released_at ASC;

\echo ''
\echo '2. Query plan specifically filtering by freelancer_id (Target hot-path):'
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  freelancer_id,
  TO_CHAR(DATE_TRUNC('month', released_at), 'YYYY-MM') AS month,
  released_at,
  COUNT(*)::int AS earnings_count
FROM escrow_releases
WHERE freelancer_id = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
  AND released_at >= NOW() - INTERVAL '12 months'
GROUP BY freelancer_id, DATE_TRUNC('month', released_at), released_at
ORDER BY month ASC, released_at ASC;

\echo ''
\echo '3. Simulated plan WITHOUT the index (Sequential Scan comparison):'
SET enable_indexscan = off;
SET enable_indexonlyscan = off;
SET enable_bitmapscan = off;

EXPLAIN (ANALYZE, BUFFERS)
SELECT
  freelancer_id,
  TO_CHAR(DATE_TRUNC('month', released_at), 'YYYY-MM') AS month,
  released_at,
  COUNT(*)::int AS earnings_count
FROM escrow_releases
WHERE freelancer_id = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
  AND released_at >= NOW() - INTERVAL '12 months'
GROUP BY freelancer_id, DATE_TRUNC('month', released_at), released_at
ORDER BY month ASC, released_at ASC;

-- Reset planner configuration
RESET enable_indexscan;
RESET enable_indexonlyscan;
RESET enable_bitmapscan;
