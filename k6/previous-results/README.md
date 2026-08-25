# k6/previous-results/

Holds the **previous** k6 run's summary JSON files, downloaded automatically by
the CI workflow (`actions/download-artifact@v4` → `load-test-results`) so that
`trend-report.js` can diff the current run against it.

On a local machine you can populate it by copying the last run's summaries:

```bash
cp k6/results/*-summary.json k6/previous-results/
```

This file (`.gitkeep`) exists only so the empty directory is tracked by Git.
Generated artifacts in this folder are git-ignored.
