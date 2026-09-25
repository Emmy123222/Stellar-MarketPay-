# ADR-011: CI/CD Workflow Consolidation

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** @Emmy123222
- **Supersedes:** Individual workflow files replaced by this consolidation

---

## Context

The repository accumulated 14 separate GitHub Actions workflow files over time, many of which were broken, redundant, or referencing non-existent action versions. This created maintenance overhead, slow CI runs, and confusion about which checks actually pass.

The goal was to consolidate into a minimal, maintainable set of workflows that cover the essential CI/CD surface area without sacrificing correctness.

---

## Decision

Consolidate from 14 workflow files down to **3 core workflows**:

| Workflow | Purpose | Trigger |
|---|---|---|
| `ci.yml` | PR validation: type-check, lint, build, test for all three layers | `push` to `main`/`develop`, `pull_request` to `main` |
| `deploy.yml` | Staging auto-deploy + Production manual promotion | `push` to `main`, `workflow_dispatch` |
| `security.yml` | Dependency audit, secret scanning, container scan | Scheduled daily + on `push` to `main` |

Additionally, two auxiliary workflows are retained for specialized needs:

| Workflow | Purpose |
|---|---|
| `check-openapi-docs.yml` | Validates OpenAPI spec generation on every push/PR |
| `rollback.yml` | Manual rollback to a previous image tag |

### What was merged into `ci.yml`

- **Frontend:** TypeScript type-check, ESLint, Next.js build, Playwright E2E (Chromium)
- **Backend:** ESLint, dependency installation validation
- **Contracts:** `cargo check`, `cargo clippy`, `cargo audit`, `cargo test`, release build

All three jobs run in parallel with appropriate caching (npm, Cargo) for speed.

### What was dropped and why

| Check | Reason for removal | Future plan |
|---|---|---|
| **Storybook deploy** (`deploy-storybook.yml`) | Referenced `actions/checkout@v7` and `upload-pages-artifact@v4` — neither exists. Had never run successfully. | Restore as a separate `deploy-storybook.yml` with `upload-pages-artifact@v3` (tracked in #1210) |
| **Playwright visual regression** | Spec existed but no baselines were committed; no workflow ever ran it. | Restore with committed baselines and CI diff-on-failure uploads (tracked in #1209) |
| **ZAP (OWASP Zed Attack Proxy) scanning** | Full DAST scan is expensive for CI; false-positive rate was high with no tuning. | Reintroduce as a scheduled nightly scan when the app has a stable staging URL |
| **cargo-fuzz** | Fuzz harnesses were stale and not maintained; blocking CI on fuzzing added friction without actionable results. | Restore when fuzz targets are updated and findings are triaged |

### What was retained as-is

- `deploy-staging.yml` → auto-deploy on push to `main` with Discord notifications
- `deploy-production.yml` → manual promotion with GitHub environment protection rules
- `rollback.yml` → manual rollback with environment selection
- `check-openapi-docs.yml` → OpenAPI spec validation on push/PR

---

## Consequences

### Positive

- **Faster CI:** Parallel jobs and removal of broken checks reduced CI time significantly.
- **Reduced maintenance:** Fewer files to update when action versions or toolchains change.
- **Clear expectations:** Three well-named workflows make the CI surface easy to understand.
- **No regressions:** All checks that actually passed before the consolidation still pass.

### Negative

- **Reduced coverage:** Storybook publishing, visual regression testing, ZAP scanning, and fuzzing are not running. These are tracked as separate issues (#1210, #1209, and future tickets for ZAP/cargo-fuzz).
- **Monolithic ci.yml:** If CI grows further, splitting by subsystem (e.g., `ci-frontend.yml`, `ci-contracts.yml`) may be warranted.

---

## What should come back (tracked issues)

1. **Storybook GitHub Pages deploy** — #1210
2. **Playwright visual regression with baseline snapshots** — #1209
3. **ZAP nightly scan** — TBD (requires stable staging environment with authentication)
4. **cargo-fuzz** — TBD (requires updated fuzz targets)

---

## References

- [GitHub Actions documentation](https://docs.github.com/en/actions)
- [upload-pages-artifact@v3](https://github.com/actions/upload-pages-artifact)
- [OWASP ZAP](https://www.zaproxy.org/)
- [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz)