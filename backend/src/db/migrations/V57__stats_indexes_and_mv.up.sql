-- Issue #232 perf: dedicated B-tree indexes for COUNT(*) filters in statsService
-- Eliminates full sequential scans that degrade linearly with table size.

-- ── Covering index: every query that filters jobs by status ──────────────────
-- Used by: computeStats (CTE), aggregatePlatformMetrics, getTopCategories
CREATE INDEX IF NOT EXISTS idx_jobs_status
  ON jobs (status)
  WHERE deleted_at IS NULL;

-- Partial indexes for the two discrete values compared in the completion-rate
-- branch: avoids re-checking the WHERE predicate at runtime on large tables.
CREATE INDEX IF NOT EXISTS idx_jobs_status_completed
  ON jobs (status)
  WHERE status = 'completed' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_status_cancelled
  ON jobs (status)
  WHERE status = 'cancelled' AND deleted_at IS NULL;

-- ── applications.status ──────────────────────────────────────────────────────
-- Used by: aggregatePlatformMetrics and any future COUNT(*) on applications
CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (status);

-- ── escrows.status ───────────────────────────────────────────────────────────
-- Used by: computeStats (SUM(amount_xlm) WHERE status = 'funded'),
--          aggregatePlatformMetrics (total_escrow_volume_xlm)
CREATE INDEX IF NOT EXISTS idx_escrows_status
  ON escrows (status);

-- ── Materialized view: pre-computed platform stats ───────────────────────────
-- Wraps the expensive multi-table CTE from computeStats() so that read paths
-- never touch base tables.  Refreshed every 5 minutes via scheduleStatsRefresh
-- in statsService.js using REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE MATERIALIZED VIEW IF NOT EXISTS platform_stats_mv AS
  SELECT
    COUNT(*)                                                    AS total_jobs,
    COUNT(DISTINCT client_address)                              AS total_clients,
    COUNT(DISTINCT freelancer_address)
      FILTER (WHERE freelancer_address IS NOT NULL)             AS total_freelancers,
    (
      SELECT COUNT(DISTINCT public_key)
      FROM   profiles
      WHERE  completed_jobs > 0 OR role = 'client'
    )                                                           AS active_users,
    COALESCE(
      (SELECT SUM(amount_xlm) FROM escrows WHERE status = 'funded'),
      0
    )                                                           AS total_escrow_xlm,
    COALESCE(
      AVG(budget) FILTER (WHERE status IN ('assigned', 'in_progress', 'completed')),
      0
    )                                                           AS avg_job_budget,
    COALESCE(
      COUNT(*) FILTER (WHERE status = 'completed') * 100.0 /
      NULLIF(
        COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled')),
        0
      ),
      0
    )                                                           AS completion_rate,
    NOW()                                                       AS refreshed_at
  FROM jobs
  WHERE deleted_at IS NULL
WITH DATA;

-- A unique index is required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- The expression (1) is a constant — the view is a singleton row.
CREATE UNIQUE INDEX IF NOT EXISTS platform_stats_mv_singleton_idx
  ON platform_stats_mv ((1));
