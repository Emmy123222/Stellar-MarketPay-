# Contributing to Stellar MarketPay

Stellar MarketPay is a decentralized freelance marketplace built on the Stellar network. Contributions of all kinds are welcome — bug fixes, features, docs, and tests.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Environment Variables](#environment-variables)
4. [Running the App](#running-the-app)
5. [Docker Setup (Alternative)](#docker-setup-alternative)
6. [Project Structure](#project-structure)
7. [Testing](#testing)
8. [Branch Naming](#branch-naming)
9. [Commit Style](#commit-style)
10. [Submitting a Pull Request](#submitting-a-pull-request)
11. [Smart Contract Development](#smart-contract-development)

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Node.js | 18.x | [nodejs.org](https://nodejs.org) |
| npm | 9.x | Included with Node |
| PostgreSQL | 15+ | Or run via Docker (recommended) |
| Redis | 7+ | Or run via Docker (recommended) |
| Rust + Cargo | stable | Only for contract work — [rustup.rs](https://rustup.rs) |
| Freighter Wallet | latest | Browser extension for Stellar — [freighter.app](https://freighter.app) |

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

See the [Environment Variables](#environment-variables) section below. At minimum you need:

```bash
# backend/.env
JWT_SECRET=any-long-random-string-here
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
DATABASE_ENCRYPTION_KEY=any-16-char-string-or-longer
```

The frontend `.env.local` defaults work out of the box for local development.

### 5. Start the dev servers

Open two terminals:

```bash
# Terminal 1 — frontend (http://localhost:3000)
cd frontend && npm run dev

# Terminal 2 — backend (http://localhost:4000)
cd backend && npm run dev
```

The backend applies all pending migrations on startup and logs the result.

### 6. Get testnet XLM

Visit [friendbot.stellar.org](https://friendbot.stellar.org) with your Freighter testnet address to fund the wallet with 10,000 XLM. The app must be pointed at `STELLAR_NETWORK=testnet`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | Express server port |
| `NODE_ENV` | No | `development` | `development` \| `production` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `DATABASE_ENCRYPTION_KEY` | Yes | — | Key for pgp_sym_encrypt (min 16 chars) |
| `JWT_SECRET` | Yes | — | Signs auth tokens — use 32+ random chars |
| `STELLAR_NETWORK` | No | `testnet` | `testnet` \| `mainnet` |
| `HORIZON_URL` | No | testnet URL | Stellar Horizon endpoint |
| `CONTRACT_ID` | No | — | Soroban escrow contract address |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | CORS whitelist (comma-separated) |
| `REDIS_URL` | No | — | Redis connection string |
| `SMTP_HOST` | No | — | Mail server (weekly digest feature) |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | — | From address for sent emails |
| `ADMIN_WALLET_ADDRESSES` | No | — | Comma-separated admin Stellar addresses |
| `SERVER_PRIVATE_KEY` | No | — | Backend Stellar key for faucet/turrets |
| `BASE_URL` | No | `http://localhost:3000` | Used in email links |
| `FRONTEND_URL` | No | `http://localhost:3000` | Frontend origin in digest emails |
| `API_BASE_URL` | No | `http://localhost:4000` | Backend origin in digest emails |

### Frontend (`frontend/.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | Backend base URL |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `testnet` | `testnet` \| `mainnet` |
| `NEXT_PUBLIC_HORIZON_URL` | No | testnet URL | Horizon endpoint |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No | testnet URL | Soroban RPC endpoint |
| `NEXT_PUBLIC_CONTRACT_ID` | No | — | Escrow contract address |
| `NEXT_PUBLIC_USE_CONTRACT_MOCK` | No | `false` | Skip real contract calls in E2E tests |

---

## Running the App

| Service | Command | URL |
|---------|---------|-----|
| Frontend | `cd frontend && npm run dev` | http://localhost:3000 |
| Backend | `cd backend && npm run dev` | http://localhost:4000 |
| API docs | — | http://localhost:4000/api-docs |
| Health check | — | http://localhost:4000/health |

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

### Running all checks locally (CI equivalent)

```bash
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

## Submitting a Pull Request

1. Branch from `main` using the naming convention above
2. Make your changes and write/update tests
3. Run the full test suite locally
4. Push and open a PR against `main`
5. Fill out the PR template
6. Link related issues: `Closes #123`

### PR Checklist

- [ ] Tests pass locally (`npm test` in both `frontend/` and `backend/`)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit` in `frontend/`)
- [ ] Linting passes (`npm run lint`)
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
