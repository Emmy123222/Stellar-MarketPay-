# Data Archiving Strategy

This document describes how MarketPay removes old completed jobs from hot database tables to maintain query performance as the platform scales.

---

## Problem

Jobs accumulate over time. Completed, cancelled, and expired jobs are rarely queried by end-users, but they sit in the same `jobs` table as active listings — adding index bloat, slowing full-table scans, and inflating backup size.

---

## Solution Overview

A PostgreSQL stored procedure (`archive_jobs()`) moves eligible rows from the live tables into dedicated `archived_*` tables. An operator-controlled `archive_config` table controls retention and batch sizes without requiring a deployment.

### Archivable Statuses

Jobs with any of these statuses qualify for archiving once they are older than `retention_days`:

| Status | Meaning |
|---|---|
| `completed` | Escrow released; both parties rated |
| `cancelled` | Client cancelled before freelancer was hired |
| `expired` | Reached `expires_at` without being filled |

### What Gets Archived

Each qualifying job brings its dependents with it:

```
archive_jobs()
  ├── ratings       → archived_ratings
  ├── messages      → archived_messages
  ├── applications  → archived_applications
  ├── escrows       → archived_escrows
  └── jobs          → archived_jobs
```

The move is atomic: all tables are updated inside a single transaction. If anything fails, the transaction rolls back and the live tables are unchanged. The `archive_runs` table records every execution for audit purposes.

---

## Configuration

All settings live in the `archive_config` table and take effect on the next `archive_jobs()` call — no restarts required.

```sql
SELECT * FROM archive_config;
```

| key | Default | Description |
|---|---|---|
| `retention_days` | `365` | Minimum age (in days) of `updated_at` before a job qualifies |
| `batch_size` | `500` | Maximum jobs moved per procedure call |
| `archive_enabled` | `true` | Set to `false` to pause archiving |

### Changing a Setting

```sql
UPDATE archive_config SET value = '180' WHERE key = 'retention_days';
```

---

## Running the Archive

### On Demand

```sql
SELECT * FROM archive_jobs();
```

Returns:

| Column | Description |
|---|---|
| `run_id` | ID in `archive_runs` |
| `jobs_archived` | How many jobs were moved |
| `status` | `completed`, `disabled`, or `failed` |

### Scheduled Execution

Run `archive_jobs()` via a `pg_cron` job or an external scheduler (e.g., a Node.js cron task):

**pg_cron (run nightly at 2 AM UTC):**
```sql
SELECT cron.schedule('archive-old-jobs', '0 2 * * *', 'SELECT archive_jobs()');
```

**Node.js (using `node-cron`):**
```js
import cron from 'node-cron';
import { pool } from './db.js';

// Nightly at 02:00 UTC
cron.schedule('0 2 * * *', async () => {
  const { rows } = await pool.query('SELECT * FROM archive_jobs()');
  console.log('[archiver]', rows[0]);
});
```

### Processing Large Backlogs

When first enabling archiving on a large dataset, run the procedure repeatedly until it reports `jobs_archived = 0`:

```sql
DO $$
DECLARE r RECORD;
BEGIN
  LOOP
    SELECT * INTO r FROM archive_jobs();
    RAISE NOTICE 'Archived % jobs (run_id=%)', r.jobs_archived, r.run_id;
    EXIT WHEN r.jobs_archived = 0 OR r.status <> 'completed';
  END LOOP;
END;
$$;
```

---

## Checking Archive Candidates

The `archive_candidates` view shows jobs that would be moved on the next run:

```sql
SELECT id, status, updated_at, age
  FROM archive_candidates
 LIMIT 20;
```

---

## Querying Archived Data

The `archived_*` tables are drop-in replacements for reporting queries. All original columns are preserved plus two archival metadata columns:

| Column | Type | Description |
|---|---|---|
| `archived_at` | `TIMESTAMPTZ` | When this row was moved |
| `archive_run_id` | `BIGINT` | References `archive_runs.id` |

### Example: Freelancer lifetime earnings (including archived jobs)

```sql
SELECT
  e.contract_id,
  SUM(e.amount_xlm) AS total_xlm
FROM archived_escrows e
WHERE e.status = 'released'
  AND e.job_id IN (
    SELECT id FROM archived_jobs WHERE freelancer_address = $1
  )
GROUP BY e.contract_id;
```

### Example: Full job history across live and archived tables

```sql
-- Union view: show all jobs for a client regardless of archive status
SELECT id, title, status, created_at, 'live' AS source
  FROM jobs
 WHERE client_address = $1

UNION ALL

SELECT id, title, status, created_at, 'archived' AS source
  FROM archived_jobs
 WHERE client_address = $1

ORDER BY created_at DESC;
```

---

## Audit Log

Every `archive_jobs()` invocation writes a record to `archive_runs`:

```sql
SELECT id, started_at, finished_at, jobs_archived, status, error_message
  FROM archive_runs
 ORDER BY started_at DESC
 LIMIT 10;
```

A `status = 'failed'` row means the transaction was rolled back — live tables are untouched. Check `error_message` for the cause.

---

## Rollback / Data Restore

If you need to restore an archived job to the live tables:

```sql
BEGIN;

-- Restore jobs
INSERT INTO jobs (id, title, description, budget, currency, category, skills, status,
                  client_address, freelancer_address, escrow_contract_id, applicant_count,
                  deadline, timezone, screening_questions, milestones, dispute_reason,
                  dispute_description, disputed_by, disputed_at, created_at, updated_at,
                  expires_at, extended_count, extended_until, view_count, share_count,
                  boosted, boosted_until, visibility, bidding_closed_at)
SELECT id, title, description, budget, currency, category, skills, status,
       client_address, freelancer_address, escrow_contract_id, applicant_count,
       deadline, timezone, screening_questions, milestones, dispute_reason,
       dispute_description, disputed_by, disputed_at, created_at, updated_at,
       expires_at, extended_count, extended_until, view_count, share_count,
       boosted, boosted_until, visibility, bidding_closed_at
  FROM archived_jobs
 WHERE id = '<job-uuid>';

-- Restore dependents (applications, escrows, ratings, messages) similarly ...

-- Remove from archive
DELETE FROM archived_jobs WHERE id = '<job-uuid>';

COMMIT;
```

To drop the archiving infrastructure entirely, run the down-migration:

```bash
psql $DATABASE_URL -f backend/src/db/migrations/V12__job_archiving.down.sql
```

---

## Impact on Existing Indexes and Queries

- All existing `jobs` indexes remain on the live table; the archive tables have their own covering indexes.
- The `archived_jobs` table does **not** have a `job_search_vector` generated column or `pg_trgm` indexes — archived jobs are excluded from full-text search by design.
- Foreign-key constraints are intentionally **not** present on archive tables. The move is considered a soft delete; referential integrity was validated when the rows were in the live tables.

---

## Performance Considerations

| Concern | Mitigation |
|---|---|
| Long lock window | `FOR UPDATE SKIP LOCKED` avoids contention with active writers; `batch_size` caps the work per transaction |
| Index bloat after bulk deletes | Run `ANALYZE jobs;` or `VACUUM jobs;` after large initial backlogs |
| Archive table growth | Archive tables are append-only; periodically COPY to cold storage (S3/GCS) and truncate if needed |
| Concurrent inserts during archiving | The procedure targets `completed/cancelled/expired` rows only — rows being actively written are `open` or `in_progress` and are skipped |

---

*Migration files: `backend/src/db/migrations/V12__job_archiving.up.sql` / `V12__job_archiving.down.sql`*
