# Runbook: Database Connection Pool Exhaustion

**Severity:** SEV-1 (Database bottleneck)  
**Owner:** Backend on-call  
**Related Alerts:** `DBPoolExhausted`, `DBPoolUtilizationHigh`, `HighDatabaseConnections`, `SlowDatabaseQueries`

---

## Summary
The PostgreSQL shared connection pool is exhausted or has excessive waiting requests (>10 waiting for >30s).

## Diagnostic Steps
1. Query active connections in PostgreSQL:
   ```sql
   SELECT pid, now() - query_start AS duration, query, state FROM pg_stat_activity WHERE state != 'idle';
   ```
2. Check for connection leaks in backend pool logs.

## Mitigation
1. Terminate long-running or locked queries:
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE duration > interval '1 minute';
   ```
2. Adjust `MAX_POOL_CONNECTIONS` if workload has legitimately increased.
