# k6/previous-results/

Holds the **previous** k6 run's summary JSON files, downloaded automatically by
the CI workflow (`actions/download-artifact@v4` → `load-test-results`) so that
`trend-report.js` can diff the current run against it.

On a local machine you can populate it by copying the last run's summaries:

```bash
cp k6/results/*-summary.json k6/previous-results/
```

## Escrow-creation baseline (#1488)

`scripts/create-escrow.js` writes `k6/results/create-escrow-summary.json`.
Once a run has passed its gates (p(95) < 2 s, error rate < 1 %), promote that
summary here so the next run can be diffed against it:

```bash
cp k6/results/create-escrow-summary.json k6/previous-results/
```

Expected gate (from `scripts/create-escrow.js` options):

| Metric | Gate |
|--------|------|
| `http_req_duration{name:create_escrow}` p(95) | **< 2000 ms** |
| `http_req_failed{name:create_escrow}` rate | **< 0.01** (< 1 %) |

This file (`.gitkeep`) exists only so the empty directory is tracked by Git.
Generated artifacts in this folder are git-ignored.

## WebSocket realtime baseline (#1824)

`scripts/websocket-realtime.js` writes `k6/results/websocket-realtime-summary.json`.
Baseline metrics establish performance for concurrent sockets, room subscription,
and broadcast delivery latency:

| Metric | Baseline | Gate |
|--------|----------|------|
| `ws_delivery_latency` p(95) | **18.5 ms** | **< 200 ms** |
| `ws_connecting` p(95) | **24.1 ms** | **< 500 ms** |
| `ws_connection_failures` rate | **0.00 %** | **< 0.01** (< 1 %) |
| `checks` pass rate | **100 %** | **> 99 %** |
