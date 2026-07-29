# Query Optimization Review (Issue #340)

This document captures the query-plan review scope, index changes applied, and the EXPLAIN ANALYZE commands to validate improvements in environments with realistic data volume (10k+ jobs).

## Scope

Reviewed query families:

1. `GET /api/jobs` (status/category filters, `skills &&`, search text)
2. `GET /api/jobs/recommended/:publicKey` (skills overlap + anti-join on applications)
3. `GET /api/applications/job/:jobId` (applications + profile/rating joins)
4. `GET /api/ratings/:publicKey` (ratings lookup ordered by recency)
5. Job text search/autocomplete workloads (trigram + full-text)

## Changes Applied

### Query-path updates

- `backend/src/services/jobService.js`
  - Search predicate now uses:
    - `job_search_vector @@ to_tsquery('simple', ...)`
    - fallback `LOWER(title) LIKE ...` / `LOWER(description) LIKE ...`
  - This enables use of a GIN tsvector index while retaining substring behavior.

### Database optimization changes

Added in `V11__query_optimization_indexes` and `backend/src/db/schema.sql`:

- `CREATE EXTENSION IF NOT EXISTS pg_trgm`
- Generated full-text column:
  - `jobs.job_search_vector` (title + description + skills)
- New indexes:
  - `jobs_open_public_created_idx` (partial; `status='open' AND visibility='public'`)
  - `jobs_status_category_created_idx` (`status, category, created_at DESC, id DESC`)
  - `jobs_search_vector_idx` (GIN on `job_search_vector`)
  - `jobs_title_trgm_idx` (GIN trigram on `lower(title)`)
  - `jobs_description_trgm_idx` (GIN trigram on `lower(description)`)
  - `applications_job_created_idx` (`job_id, created_at ASC`)
  - `ratings_rated_created_idx` (`rated_address, created_at DESC`)
  - `profiles_public_key_rating_idx` (`public_key, rating`)

## EXPLAIN ANALYZE Validation Queries

Run these in a staging DB with realistic cardinality:

```sql
-- 1) /api/jobs
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
```

```sql
-- 2) /api/jobs/recommended/:publicKey
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
```

```sql
-- 3) /api/applications/job/:jobId
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
```

```sql
-- 4) /api/ratings/:publicKey
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM ratings
WHERE rated_address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
ORDER BY created_at DESC;
```

```sql
-- 5) Text search
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
```

## Expected Plan Improvements

- `GET /api/jobs`: reduced broad scans for open/public feed through partial index and composite status/category index.
- Recommended jobs: lower cost path on `jobs` filtering and anti-join probe efficiency via existing `applications(job_id, freelancer_address)` uniqueness.
- Applications by job: ordered retrieval on `job_id + created_at` avoids sort-heavy scans.
- Ratings by user: `Index Scan`/`Bitmap Heap Scan` preferred over sequential scan with explicit recency ordering support.
- Text search: planner can use:
  - `jobs_search_vector_idx` for lexical search
  - trigram GIN indexes for substring-like predicates

## Notes

- Actual latency and plan node choices depend on statistics and production-like data distribution.
- After large imports, run `ANALYZE jobs; ANALYZE applications; ANALYZE ratings;`.
- For stricter SLA work, compare `EXPLAIN (ANALYZE, BUFFERS)` before/after and track p95 in APM.
