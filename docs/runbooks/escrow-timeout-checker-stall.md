# Runbook: Escrow Timeout Checker Stall

**Severity:** SEV-1 (Automated refunds delayed)  
**Owner:** Backend on-call  
**Related Alerts:** `EscrowTimeoutCheckerStalled`, `EscrowTimeoutCheckerErrorRateHigh`

---

## Summary
The escrow timeout checker (`startEscrowTimeoutChecker`) runs hourly to query and refund escrows in `funded` status whose creation date is older than 7 days. If the checker stalls or fails, expired escrows remain locked indefinitely.

## Symptoms
- Alert `EscrowTimeoutCheckerStalled` firing (no run completed within 2 hours).
- Alert `EscrowTimeoutCheckerErrorRateHigh` firing.
- Funded escrows older than 7 days remain in `funded` status instead of transitioning to `refunded`.

## Diagnostic Steps
1. Query pending expired escrows:
   ```sql
   SELECT e.job_id, j.client_address, e.status, e.created_at
   FROM escrows e
   JOIN jobs j ON e.job_id = j.id
   WHERE e.status = 'funded' AND e.created_at + INTERVAL '7 days' < NOW();
   ```
2. Check scheduler logs:
   ```bash
   grep 'escrow-timeout' /var/log/marketpay/backend.log
   ```
3. Check metric `escrow_timeout_checker_last_run_timestamp_seconds` in Prometheus.

## Mitigation & Recovery
1. If the Node.js event loop or timer stalled, restart the backend service.
2. If database queries timed out, verify PostgreSQL connection pool health.
3. If an individual escrow fails to refund, inspect on-chain error message and execute manual refund via admin CLI if needed.
