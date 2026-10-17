# Runbook: Infrastructure Monitoring and Alerts

**Severity:** SEV-3 (Operational warning)  
**Owner:** DevOps / Infrastructure  
**Related Alerts:** `BackendMetricsEndpointDown`, `WebSocketConnectionsSpike`, `MonthlySpendWarning`, `HighComputeUtilization`

---

## Summary
Covers general host, metrics endpoint, and container infrastructure thresholds.

## Diagnostic Steps
1. If `BackendMetricsEndpointDown`, verify the backend process is running and `/metrics` responds locally.
2. If `WebSocketConnectionsSpike`, inspect open socket counts and look for reconnect storms.
3. If `HighComputeUtilization`, inspect top CPU consumers using `docker stats` or `top`.

## Mitigation
1. Restart dead metrics exporters or backend containers.
2. Check firewall or security groups if metrics scrape fails.
