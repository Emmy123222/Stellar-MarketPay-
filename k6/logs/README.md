# k6/logs/

Captures the raw k6 console output (`*.log`) and the trend-report log from each
run, written by the `load-test.yml` workflow (and by local `tee` invocations).

Uploaded as part of the `load-test-results` CI artifact alongside `k6/results/`.

This file (`.gitkeep`) exists only so the empty directory is tracked by Git.
Log files in this folder are git-ignored.
