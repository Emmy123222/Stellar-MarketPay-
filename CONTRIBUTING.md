## Code of Conduct

This project follows the guidelines outlined in our
[Code of Conduct](CODE_OF_CONDUCT.md).

By participating in this project, you agree to uphold these standards and help
maintain a welcoming environment for everyone.

# Contributing to Stellar MarketPay

Stellar MarketPay is a decentralized freelance marketplace built on the Stellar network. Contributions of all kinds are welcome — bug fixes, features, docs, and tests.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Environment Variables](#environment-variables) (full reference at [docs/environment-variables.md](docs/environment-variables.md))
4. [Running the App](#running-the-app)
5. [Docker Setup (Alternative)](#docker-setup-alternative)
6. [Project Structure](#project-structure)
7. [Testing](#testing)
8. [Branch Naming](#branch-naming)
9. [Commit Style](#commit-style)
10. [Submitting a Pull Request](#submitting-a-pull-request)
11. [Smart Contract Development](#smart-contract-development)
12. [Pre-commit Hooks (husky + lint-staged)](#pre-commit-hooks-husky--lint-staged)

---

## Prerequisites

| Tool             | Minimum Version | Notes                                                                  |
| ---------------- | --------------- | ---------------------------------------------------------------------- |
| Node.js          | 18.x            | [nodejs.org](https://nodejs.org)                                       |
| npm              | 9.x             | Included with Node                                                     |
| PostgreSQL       | 15+             | Or run via Docker (recommended)                                        |
| Redis            | 7+              | Or run via Docker (recommended)                                        |
| Rust + Cargo     | stable          | Only for contract work — [rustup.rs](https://rustup.rs)                |
| Freighter Wallet | latest          | Browser extension for Stellar — [freighter.app](https://freighter.app) |

---

## Local Setup

### 1. Fork and clone

```bash
# Fork on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/stellar-marketpay.git
cd stellar-marketpay

# Track upstream
git remote add upstream https://github.com/your-org/stellar-marketpay.git
```

### 2. Run the automated setup script

```bash
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

The script:

- Checks Node.js and Rust installations
- Installs frontend and backend dependencies
- Copies `.env.example` files to their working equivalents
- Adds the `wasm32-unknown-unknown` Rust target (needed for contracts)

### 3. Start the database services

The easiest path is Docker for PostgreSQL and Redis only:

```bash
docker compose up postgres redis -d
```

This starts:

- **PostgreSQL** on `localhost:5432` — database `stellarwork`, user `stellarwork`, password `stellarwork_dev`
- **Redis** on `localhost:6379`

The backend runs schema migrations automatically on startup, so no manual `psql` commands are needed.

### 4. Configure environment variables

See [docs/environment-variables.md](docs/environment-variables.md) for the full reference. At minimum you need:

```bash
# backend/.env
JWT_SECRET=any-long-random-string-here
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
DATABASE_ENCRYPTION_KEY=any-16-char-string-or-longer
```

The frontend `.env.local` defaults work out of the box for local development. See the [Environment Variables](#environment-variables) section below for a quick-start summary.

### 5. Start the dev servers

Open two terminals:

```bash
# Terminal 1 — frontend (http://localhost:3000)
cd frontend && npm run dev

# Terminal 2 — backend (http://localhost:4000)
cd backend && npm run dev
```

The backend applies all pending migrations on startup and logs the result.

### 6. Seed the database (optional)

For development and testing, you can populate the database with sample data:

```bash
cd backend
npm run db:seed
```

This creates:
- 5 users (2 clients, 3 freelancers)
- 20 open jobs
- 10 applications
- 3 in-progress jobs with escrow

The seed script is **idempotent** — running it multiple times will not create duplicates. Users and applications use `ON CONFLICT` clauses to update existing records; jobs are matched by title and skipped if already present.

### 7. Get testnet XLM

Visit [friendbot.stellar.org](https://friendbot.stellar.org) with your Freighter testnet address to fund the wallet with 10,000 XLM. The app must be pointed at `STELLAR_NETWORK=testnet`.

---

## Environment Variables

See [docs/environment-variables.md](docs/environment-variables.md) for the complete reference — every variable, type, default, validation rule, and example.

### Minimum required for local development

```bash
# backend/.env
JWT_SECRET=any-long-random-string-here
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
DATABASE_ENCRYPTION_KEY=any-16-char-string-or-longer
```

The frontend `.env.local` defaults work out of the box for local development.

---

## Running the App

| Service      | Command                      | URL                            |
| ------------ | ---------------------------- | ------------------------------ |
| Frontend     | `cd frontend && npm run dev` | http://localhost:3000          |
| Backend      | `cd backend && npm run dev`  | http://localhost:4000          |
| API docs     | —                            | http://localhost:4000/api-docs |
| Health check | —                            | http://localhost:4000/health   |

---

## Docker Setup (Alternative)

Run the entire stack (frontend, backend, PostgreSQL, Redis) in containers:

```bash
docker compose up
```

To also spin up the ELK logging stack:

```bash
docker compose --profile logging up
```

> The `backend` container requires `DATABASE_URL` and `JWT_SECRET` to be set in `backend/.env`. Copy from `.env.example` before starting.

---

## Project Structure

```
stellar-marketpay/
├── frontend/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # Reusable React components
│   ├── lib/              # Stellar SDK + wallet helpers
│   ├── utils/            # Shared utilities
│   └── tests/e2e/        # Playwright end-to-end tests
├── backend/
│   └── src/
│       ├── routes/       # Express route definitions
│       ├── controllers/  # Request handlers
│       ├── services/     # Business logic
│       ├── middleware/   # Auth, rate limiting, sanitization
│       ├── db/
│       │   ├── schema.sql        # Canonical idempotent schema
│       │   └── migrations/       # Versioned Flyway-style migrations
│       └── utils/        # Logger, encryption helpers
├── contracts/            # Soroban smart contracts (Rust/WASM)
├── docs/                 # Architecture, ADRs, API reference
├── infra/                # Terraform, Nginx config
├── monitoring/           # Prometheus, ELK stack config
└── scripts/              # Dev setup and deployment scripts
```

---

## Testing

### Frontend unit tests

```bash
cd frontend
npm test
```

Snapshot tests live in `frontend/__tests__/` covering `JobCard`, `JobCardSkeleton`, `RatingForm`, `Toast`, `FreelancerTierBadge`, and `Navbar`.

When you intentionally change UI markup, regenerate snapshots:

```bash
npm run test:update-snapshots
```

CI runs `npm test` without `-u`, so outdated snapshots fail the build.

### Backend unit and integration tests

```bash
cd backend
npm test
```

Coverage HTML is written to `backend/coverage/`. Enforced thresholds: 60% lines, 50% branches on middleware and service modules.

### End-to-end tests

Requires two mock Freighter accounts. No testnet connection needed:

```bash
cd frontend
npm run test:e2e
```

The spec at `tests/e2e/full-marketplace-flow.spec.ts` exercises the complete client and freelancer journey with `NEXT_PUBLIC_USE_CONTRACT_MOCK=true`.

### Backend linting

```bash
cd backend
npm run lint        # Check for lint errors
npm run lint:fix    # Auto-fix lint errors where possible
```

### Running all checks locally (CI equivalent)

```bash
# Root — pre-commit quality gates (eslint --fix, prettier --write, cargo fmt --check)
npx lint-staged

# Backend
cd backend && npm test && npm run lint

# Frontend
cd frontend && npm test && npm run lint && npx tsc --noEmit
```

---

## Branch Naming

```
feature/job-search-filters
fix/escrow-release-bug
docs/update-api-reference
chore/upgrade-stellar-sdk
contracts/implement-milestone-escrow
test/add-rating-service-coverage
```

Always branch from `main`:

```bash
git fetch upstream
git checkout -b feature/my-feature upstream/main
```

---

## Commit Style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add job search filters
fix: correct escrow balance calculation
docs: add milestone payment guide
contracts: implement dispute resolution
chore: upgrade soroban-sdk to 21.0
test: cover profileService edge cases
refactor: extract rate limiter middleware
```

Keep the subject line under 72 characters. Add a body when the "why" needs explanation.

---

## Pre-commit Hooks (husky + lint-staged)

This repository enforces code quality **before** code enters the history using
[husky](https://typicode.github.io/husky/) and
[lint-staged](https://github.com/lint-staged/lint-staged). The hook is managed
in `.husky/pre-commit` and configured in the root `package.json` (`lint-staged`
key).

### Installation

Installing the root dependencies also wires up the Git hook automatically
thanks to the `prepare` script:

```bash
# From the repository root
npm install
```

`npm install` runs `husky`, which sets `core.hooksPath` to `.husky/_` so Git
invokes `.husky/pre-commit` on every commit. No manual `git config` step is
required. (If hooks ever stop running, re-run `npx husky`.)

> **Note:** the Rust formatting check runs `cargo fmt --check`, which needs the
> Rust toolchain (`rustup`). JavaScript/TypeScript contributors without Rust
> installed are **not** blocked — the check is skipped with a warning.

### What runs on every commit

`lint-staged` operates only on **staged** files:

| Staged files                                       | Command                                                 | Purpose                         |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| `*.{js,ts}`                                        | `eslint --fix`                                          | Auto-fix lint issues in JS/TS   |
| `*.{js,jsx,ts,tsx,json,md,yml,yaml,css,scss,html}` | `prettier --write`                                      | Auto-format staged files        |
| `*.rs`                                             | `bash scripts/cargo-fmt-check.sh` → `cargo fmt --check` | Verify Rust files are formatted |

The `.rs` step locates the Cargo crate that owns each staged Rust file and runs
`cargo fmt --check` inside it (the contracts live in separate crates under
`contracts/`, so there is no single root Cargo workspace).

Because ESLint resolves its config per-project, make sure you have installed
the dependencies for the workspace you are editing (`npm install` in
`backend/` and `frontend/`) so ESLint can find the right plugins and rules.

### Running the checks manually

You can run the exact same checks on your currently staged changes without
committing:

```bash
npx lint-staged
```

### Skipping the hook (emergencies only)

```bash
git commit --no-verify -m "..."   # bypasses pre-commit hooks
```

This is discouraged and should only be used when you fully understand the
skipped checks (e.g. you already ran `npx lint-staged` and `cargo fmt --check`
yourself). CI will still enforce the same rules.

### Troubleshooting

- **Hooks don't run on commit:** ensure you ran `npm install` at the repo root
  (which runs `husky`) and that `git config core.hooksPath` points to `.husky/_`.
- **`command not found: lint-staged` / `eslint` / `prettier`:** install root
  dependencies with `npm install`.
- **Rust check complains even though you didn't touch Rust:** a stale `.rs`
  file may be staged; run `cargo fmt` inside the relevant `contracts/*` crate.

---

## Submitting a Pull Request

1. Branch from `main` using the naming convention above
2. Make your changes and write/update tests
3. Run the full test suite locally
4. Push and open a PR against `main`
5. Fill out the PR template
6. Link related issues: `Closes #123`

### PR Checklist

- [ ] Pre-commit hooks pass locally (`npx lint-staged` — runs automatically on commit)
- [ ] Tests pass locally (`npm test` in both `frontend/` and `backend/`)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit` in `frontend/`)
- [ ] Linting passes (`npm run lint`)
- [ ] Rust files formatted (`cargo fmt --check` in the relevant `contracts/*` crate)
- [ ] Tested on Testnet (for changes involving Stellar/Soroban)
- [ ] No breaking API changes, or changes are documented
- [ ] Documentation updated if adding new features or env vars

### Finding good first issues

Look for the `good first issue` label on GitHub — these are scoped tasks with clear acceptance criteria. Issues tagged `help wanted` are open for contribution without prior discussion.

---

## Smart Contract Development

The Soroban escrow contract lives in `contracts/`. You need Rust and the `wasm32-unknown-unknown` target.

```bash
# Build the contract
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Run contract tests
cargo test
```

For full deploy instructions including testnet deployment and registering the contract ID in your `.env`, see [docs/contract-deployment.md](docs/contract-deployment.md).

---

## Getting Help

- Open a [GitHub Discussion](https://github.com/your-org/stellar-marketpay/discussions) for questions
- Check [docs/FAQ.md](docs/FAQ.md) for common issues
- See [docs/troubleshooting.md](docs/troubleshooting.md) for environment problems
