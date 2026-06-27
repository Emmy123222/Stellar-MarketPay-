-- Issue #340 benchmark helper
-- Usage:
--   psql "$DATABASE_URL" -f scripts/explain_analyze_issue340.sql

\echo 'Running EXPLAIN ANALYZE for Issue #340 queries'

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM jobs
WHERE status = 'open'
  AND category = 'Backend Development'
  AND skills && ARRAY['Rust','Soroban']::text[]
  AND visibility = 'public'
ORDER BY
  CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
  created_at DESC, id DESC
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
SELECT j.*
FROM jobs j
WHERE j.status = 'open'
  AND j.visibility = 'public'
  AND j.skills && ARRAY['Rust','TypeScript']::text[]
  AND NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.job_id = j.id AND a.freelancer_address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
  )
ORDER BY j.created_at DESC
LIMIT 5;

EXPLAIN (ANALYZE, BUFFERS)
SELECT a.*,
       COALESCE(p.completed_jobs, 0) AS completed_jobs,
       ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
FROM applications a
LEFT JOIN profiles p ON p.public_key = a.freelancer_address
LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
WHERE a.job_id = '00000000-0000-0000-0000-000000000001'
GROUP BY a.id, p.completed_jobs
ORDER BY a.created_at ASC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM ratings
WHERE rated_address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
ORDER BY created_at DESC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM jobs
WHERE status = 'open'
  AND visibility = 'public'
  AND (
    job_search_vector @@ to_tsquery('simple', 'rust & soroban')
    OR lower(title) LIKE '%rust soroban%'
    OR lower(description) LIKE '%rust soroban%'
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
