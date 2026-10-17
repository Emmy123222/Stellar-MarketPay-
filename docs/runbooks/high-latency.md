# Runbook: High Request Latency

**Severity:** SEV-2 (Performance degradation)  
**Owner:** Backend on-call  
**Related Alerts:** `HighP99Latency`, `HighRequestLatencyMs`

---

## Summary
The 99th percentile request duration has exceeded 2000ms for more than 10 minutes.

## Diagnostic Steps
1. Identify slow endpoints using `http_request_duration_ms_bucket`.
2. Inspect database query times (`pool_query_duration_ms`).
3. Check CPU/memory metrics on backend containers.

## Mitigation
1. Identify slow or unindexed SQL queries using `pg_stat_statements`.
2. Check for upstream RPC rate limits or network latency.
3. Scale backend container replicas if CPU/concurrency bound.
