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
