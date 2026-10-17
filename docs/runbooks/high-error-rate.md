# Runbook: High API 5xx Error Rate

**Severity:** SEV-1 / SEV-2 (API availability degradation)  
**Owner:** Backend on-call  
**Related Alerts:** `High5xxErrorRate`, `HighErrorRate`, `HighApiErrorRate`

---

## Summary
More than 5% of incoming HTTP requests to MarketPay API are returning 5xx responses (HTTP 500, 502, 503, 504), indicating service instability or downstream failures.

## Symptoms
- Alert `High5xxErrorRate` or `HighApiErrorRate` firing.
- Elevated error counts on Grafana HTTP dashboard.
- Users seeing toast errors or failed job/escrow interactions.

## Diagnostic Steps
1. Identify high-error routes in Prometheus:
   ```promql
   topk(5, sum by (route, status_code) (rate(http_requests_total{status_code=~"5.."}[5m])))
   ```
2. Inspect backend logs for uncaught exceptions or error traces:
   ```bash
   grep -E 'ERROR|FATAL' /var/log/marketpay/backend.log | tail -n 50
   ```
3. Check PostgreSQL and Redis container health.

## Mitigation & Recovery
1. If PostgreSQL connection pool is exhausted, check for long-running transactions and restart stuck backend instances.
2. If Horizon RPC is returning 5xx, switch fallback Horizon endpoint or wait for RPC recovery.
3. Roll back any recent bad deployments if errors began immediately following a release.
