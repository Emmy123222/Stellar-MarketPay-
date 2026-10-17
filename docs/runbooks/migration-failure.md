# Runbook: Database Schema Migration Failure

**Severity:** SEV-1 (Deployment blocked or schema mismatch)  
**Owner:** Backend on-call  
**Related Alerts:** `DatabaseMigrationFailed`

---

## Summary
The database schema migration version does not match the expected highest migration file version on disk, or a migration failed to apply during deployment bootstrap.

## Symptoms
- Alert `DatabaseMigrationFailed` firing (`db_migration_status == 0`).
- Backend process exiting on bootstrap with `Migration version mismatch: expected X, got Y. Exiting.`
- Endpoints failing due to missing columns or unapplied tables.

## Diagnostic Steps
1. Query applied migrations table in PostgreSQL:
   ```sql
   SELECT name, version, applied_at FROM schema_migrations ORDER BY version DESC;
   ```
2. Check migration files in repo:
   ```bash
   ls backend/src/db/migrations/V*.up.sql
   ```
3. Inspect container logs for SQL syntax or constraint violation errors during `migrate()`.

## Mitigation & Recovery
1. If a migration partially failed, fix the SQL script error and rerun:
   ```bash
   npm run migrate
   ```
2. If rollback is necessary, roll back the last applied migration:
   ```bash
   npm run migrate:rollback
   ```
3. Verify `schema_migrations` table is intact and restart backend service.
