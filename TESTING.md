# 🧪 Testing Guide — Stellar MarketPay

A single, copy-paste guide to running **every** test suite in this repository
locally. If you are a new contributor, start here instead of reverse-engineering
`package.json`, `Cargo.toml`, and the CI workflows.

- **Contributing workflow:** [CONTRIBUTING.md](./CONTRIBUTING.md)
- **What CI runs:** [.github/workflows/ci.yml](./.github/workflows/ci.yml)
- **Load-test details:** [k6/README.md](./k6/README.md)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [One-time setup](#2-one-time-setup)
3. [Running unit tests](#3-running-unit-tests)
4. [Running integration tests](#4-running-integration-tests)
5. [Running e2e tests](#5-running-e2e-tests)
6. [Running contract tests](#6-running-contract-tests)
7. [Running mutation tests](#7-running-mutation-tests)
8. [Running load tests](#8-running-load-tests)
9. [CI parity — run everything locally](#9-ci-parity--run-everything-locally)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Needed for |
| ---- | ------- | ---------- |
| [Node.js](https://nodejs.org) | **20.x** (minimum 18) | Frontend + backend |
| npm | 10.x | Included with Node |
| [Docker](https://docs.docker.com/get-docker/) + Compose | v2 | Integration DB/Redis + load tests |
| [Rust](https://rustup.rs) + Cargo | stable | Soroban contracts |

Install the extra Rust target and Playwright browser once:

```bash
# Rust WASM target used by the contract build/CI
rustup target add wasm32v1-none

# Playwright browsers for the frontend e2e suite
cd frontend && npx playwright install --with-deps chromium && cd ..
```

`k6` is optional — the load-test section runs it inside Docker if you don't want
to install the binary.

---

## 2. One-time setup

```bash
# From the repository root
git clone https://github.com/Emmy123222/Stellar-MarketPay-.git
cd Stellar-MarketPay-

# Root tooling (installs husky + lint-staged pre-commit hooks)
npm install

# Backend + frontend dependencies (lockfile-exact, same as CI)
cd backend && npm ci && cd ..
cd frontend && npm ci && cd ..
```

Optional, but recommended — apply environment defaults:

```bash
chmod +x scripts/setup-dev.sh && ./scripts/setup-dev.sh
```

The backend runs schema migrations automatically on startup. See
[docs/environment-variables.md](./docs/environment-variables.md) for every
variable.

---

## 3. Running unit tests

Unit tests are fast, require **no database, no network, and no Stellar node**.
They are the first line of defence and the best inner-loop command while
developing.

### Frontend (Jest + React Testing Library)

```bash
cd frontend
npm test
```

Regenerate snapshots after an intentional UI change:

```bash
cd frontend
npm run test:update-snapshots
```

> CI runs `npm test` **without** `-u`, so stale snapshots fail the build.

### Backend (Jest)

```bash
cd backend
npx jest --selectProjects unit --forceExit
```

`npm run test:unit` is a shorthand for plain `jest`; because the Jest config
declares both a `unit` and an `integration` project, prefer the explicit
`--selectProjects unit` form above for a DB-free run (this mirrors CI).

Coverage:

```bash
cd backend
npm test          # jest --coverage → backend/coverage/
```

### Backend validator tests

Route input schemas live in `backend/src/validators/` and are covered by their
own unit tests:

```bash
cd backend
npx jest src/validators --forceExit
```

### Backend property-based tests

Property tests use [fast-check](https://fast-check.dev/) and are picked up by
the pattern `*.property.test.js`:

```bash
cd backend
npm run test:property
```

---

## 4. Running integration tests

Integration tests live in `backend/src/tests/integration/` and exercise the API
against **real PostgreSQL and Redis** instances. Start them with Docker first:

```bash
# 1. Start the dependencies (Postgres on 5432, Redis on 6379)
docker compose up postgres redis -d

# 2. Point the backend at them and run the migrations
export DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
export TEST_DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=local-test-jwt-secret-with-sufficient-length
export CSRF_SECRET=local-test-csrf-secret-with-sufficient-length
export DATABASE_ENCRYPTION_KEY=local-test-encryption-key-32chars!!
export CONTRACT_ID=CMOCKCONTRACTID

cd backend
npm run migrate

# 3. Run the integration suite
npm run test:integration
```

Tear the services down when you are finished:

```bash
docker compose down -v
```

<details>
<summary>Why each variable is required</summary>

- `DATABASE_URL` / `TEST_DATABASE_URL` — the pool and the integration fixtures.
- `REDIS_URL` — the app opens a Bull email queue and a cache client at boot;
  without Redis those operations block.
- `JWT_SECRET` / `CSRF_SECRET` — signing secrets for authenticated requests.
- `DATABASE_ENCRYPTION_KEY` — column-level encryption (≥ 32 characters).
- `CONTRACT_ID` — `indexerService` requires a contract id at boot; tests never
  touch the chain, so the mock id is fine.

These match the environment used by the `backend-integration` job in
[.github/workflows/ci.yml](./.github/workflows/ci.yml).

</details>

---

## 5. Running e2e tests

End-to-end tests run the real Next.js app in a browser via
[Playwright](https://playwright.dev/). The suite uses mocked Freighter and mocked
API routes, so **no testnet connection is required**.

```bash
cd frontend
npx playwright install --with-deps chromium   # first time only
npm run test:e2e
```

The Playwright config starts the dev server automatically (`webServer`) and runs
two projects, `chromium` and `chromium-dark`.

Useful scoped runs:

```bash
# A single spec
npx playwright test tests/e2e/full-marketplace-flow.spec.ts

# Only the wallet-connection specs (what the CI `e2e-wallet` job gates on)
npx playwright test wallet-connection --project=chromium

# Accessibility checks (axe-core)
npm run test:a11y
```

Debug a failure visually:

```bash
npx playwright test --headed --debug
npx playwright show-report
```

---

## 6. Running contract tests

Soroban smart-contract tests are Rust unit tests that run against the Soroban
test host — no testnet needed.

### Escrow contract (`contracts/marketpay-contract`)

```bash
cd contracts/marketpay-contract

# All contract tests
cargo test

# Property-based milestone-percentage tests (proptest feature)
cargo test --features proptest milestone_pct_proptests

# Formatting + lints (what CI enforces)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

### Arbitrator registry (`contracts/arbitrator-registry`)

```bash
cd contracts/arbitrator-registry
cargo test
cargo clippy --all-targets -- -D warnings
```

Optional release build (verifies the WASM artifact compiles):

```bash
cd contracts/marketpay-contract
cargo build --target wasm32v1-none --release
```

> First run downloads and compiles the `soroban-sdk` dependency tree, so it can
> take several minutes. Subsequent runs are cached in `target/`.

---

## 7. Running mutation tests

Mutation testing (via [Stryker Mutator](https://stryker-mutator.io/)) checks
that the backend test suite actually **catches bugs**: it rewrites the source
and fails when a mutation survives. The configuration lives in
[backend/stryker.config.json](./backend/stryker.config.json) and currently
mutates `escrowService.js` and `disputeService.js` using the Jest runner.

```bash
cd backend
npm ci
npx stryker run
```

The HTML report is written to `backend/reports/mutation/mutation-report.html`.
Open it in a browser to see exactly which mutants survived.

Notes:

- The config sets `since.target = "main"`, so a run only mutates source files
  changed relative to the `main` branch. On a feature branch this keeps the run
  short; on `main` it may mutate everything.
- Thresholds are defined but non-blocking (`"break": null`). Use the report to
  improve tests rather than as a hard gate.
- Mutation runs are slow (each mutant re-runs the related Jest tests). Run them
  before asking for review on changes to the services above, not on every save.

---

## 8. Running load tests

Load tests use [k6](https://k6.io/) and enforce the API's SLA (p(95) latency and
error rate). They require a seeded, production-like stack. The full reference is
[k6/README.md](./k6/README.md); the shortest path uses Docker:

```bash
# 1. Bring up Postgres + Redis + backend (tuned for load)
docker compose -f docker-compose.loadtest.yml up -d --build

# 2. Seed deterministic fixtures (writes k6/test-fixtures.json)
JWT_SECRET=loadtest-jwt-secret-with-sufficient-length-for-signing \
K6_BASE_URL=http://localhost:4000 \
  node k6/seed-data.js

# 3. Run a scenario
docker compose -f docker-compose.loadtest.yml run --rm k6 run scripts/jobs-listing.js

# 4. Tear down
docker compose -f docker-compose.loadtest.yml down -v
```

Available scenarios (run them the same way, replacing the path):

| Script | Endpoint |
| ------ | -------- |
| `scripts/jobs-listing.js` | `GET /api/jobs` |
| `get-profiles.js` | `GET /api/profiles/:publicKey` |
| `scripts/apply-to-job.js` | `POST /api/applications` |
| `scripts/create-escrow.js` | `PATCH /api/jobs/:id/escrow` |

If you have a local `k6` binary, run against an already-running backend instead:

```bash
K6_BASE_URL=http://localhost:4000 JWT_SECRET=<same-as-backend> node k6/seed-data.js
cd k6 && K6_BASE_URL=http://localhost:4000 k6 run scripts/jobs-listing.js
```

> k6 must run with its working directory set to `k6/` so the relative fixture
> and result paths resolve.

---

## 9. CI parity — run everything locally

Run the same gates CI runs before opening a PR:

```bash
# ── Root ────────────────────────────────────────────────────────────────────
npx lint-staged                 # eslint --fix + prettier + cargo fmt --check

# ── Backend ─────────────────────────────────────────────────────────────────
cd backend
npm run lint
npx jest --selectProjects unit --forceExit
npm run test:integration        # needs Postgres + Redis (see §4)

# ── Frontend ────────────────────────────────────────────────────────────────
cd ../frontend
npm run lint
npm test
npm run test:e2e                # needs Playwright browsers (see §5)

# ── Contracts ───────────────────────────────────────────────────────────────
cd ../contracts/marketpay-contract
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --features proptest milestone_pct_proptests
```

| Suite | Location | Command |
| ----- | -------- | ------- |
| Frontend unit | `frontend/__tests__/` | `cd frontend && npm test` |
| Backend unit | `backend/src/**/*.test.js` | `cd backend && npx jest --selectProjects unit` |
| Backend integration | `backend/src/tests/integration/` | `cd backend && npm run test:integration` |
| Frontend e2e | `frontend/tests/e2e/` | `cd frontend && npm run test:e2e` |
| Contracts | `contracts/*` | `cd contracts/marketpay-contract && cargo test` |
| Mutation | `backend/src/services/` | `cd backend && npx stryker run` |
| Load | `k6/` | `docker compose -f docker-compose.loadtest.yml run --rm k6 run scripts/jobs-listing.js` |

---

## 10. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `Cannot find module` in backend/frontend tests | Run `npm ci` inside the affected package. |
| Integration tests hang or time out | Postgres/Redis are not reachable — re-run `docker compose up postgres redis -d` and check `DATABASE_URL` / `REDIS_URL`. |
| `relation "..." does not exist` | Migrations were not applied — `cd backend && npm run migrate`. |
| Playwright: `Executable doesn't exist` | `cd frontend && npx playwright install --with-deps chromium`. |
| Playwright port already in use | Stop any running dev server on port 3100, or set `reuseExistingServer`. |
| `cargo: command not found` | Install Rust via [rustup.rs](https://rustup.rs) and add `wasm32v1-none`. |
| Contract tests very slow on first run | Expected — the Soroban crate compiles from scratch; later runs use the cache. |
| k6 script fails on fixtures | Run `node k6/seed-data.js` first; scripts load `k6/test-fixtures.json`. |
| Snapshot mismatch in frontend | Intended change → `npm run test:update-snapshots`; otherwise fix the component. |

Found a gap in this guide? Open a PR that edits `TESTING.md` — keeping it accurate
is itself a contribution.
