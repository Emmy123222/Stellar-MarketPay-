# 🤝 Contributing to Stellar MarketPay

Thank you for your interest in contributing! Stellar MarketPay is open source and welcomes contributors of all skill levels.

---

## 🍴 How to Fork & Set Up

```bash
# 1. Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/stellar-marketpay.git
cd stellar-marketpay

# 2. Add upstream
git remote add upstream https://github.com/your-org/stellar-marketpay.git

# 3. Run setup
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

---

## 🌿 Branch Naming

```
feature/job-search-filters
fix/escrow-release-bug
docs/update-api-reference
chore/upgrade-stellar-sdk
contracts/implement-milestone-escrow
```

---

## 💬 Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add job search filters
fix: correct escrow balance calculation
docs: add milestone payment guide
contracts: implement dispute resolution
chore: upgrade soroban-sdk to 21.0
```

---

## 🔃 Submitting a Pull Request

1. Create a branch from `main`
2. Make your changes
3. Push and open a PR against `main`
4. Fill in the PR template
5. Link related issues with `Closes #123`

### PR Checklist
- [ ] Tested locally on Testnet
- [ ] No TypeScript / Rust errors
- [ ] Documentation updated if needed
- [ ] No breaking changes (or clearly documented)

---

## 📁 Project Structure

```
stellar-marketpay/
├── frontend/
│   ├── components/     ← Reusable UI components
│   ├── pages/          ← Next.js routes
│   ├── lib/            ← Stellar SDK + wallet helpers
│   └── utils/          ← Shared utilities
├── backend/
│   └── src/
│       ├── routes/     ← Express route definitions
│       ├── controllers/← Request handlers
│       ├── services/   ← Business logic
│       └── middleware/ ← Auth, validation, rate limiting
├── contracts/          ← Soroban smart contracts (Rust)
└── docs/               ← Architecture & API docs
```

Look for `good first issue` labels to find beginner-friendly tasks!

---

## 🧪 Running the Tests

### Backend Tests (Node.js + Jest)

```bash
cd backend
npm test                 # Run Jest unit tests
npm run lint             # Run ESLint
```

> **Integration tests require PostgreSQL.** The backend uses `pg` for database access. Integration tests that hit real DB routes expect a running Postgres instance. Set `DATABASE_URL` in `backend/.env` pointing to your local or Docker Postgres before running tests that require a database connection.

```bash
# Example: spin up Postgres via Docker
docker run -d --name marketpay-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
```

### Frontend Tests (TypeScript + Playwright)

```bash
cd frontend
npm run type-check       # TypeScript compilation check (tsc --noEmit)
npm run lint             # ESLint
npm run test:e2e         # Playwright end-to-end tests
```

Playwright E2E tests mock wallet and API responses so no backend or wallet extension is required. The first run may need:
```bash
npx playwright install --with-deps chromium
```

### Visual Regression Tests

Snapshots live in `frontend/tests/e2e/snapshots/`. To generate or update baselines:
```bash
cd frontend
npx playwright test --update-snapshots
```

### Contract Tests (Rust / Soroban)

```bash
cd contracts/marketpay-contract
cargo check --target wasm32-unknown-unknown   # Fast compilation check
cargo clippy -- -D warnings                   # Lint
cargo test                                     # Unit tests
cargo build --target wasm32-unknown-unknown --release  # Release build
```

### CSRF Protection

All mutating API calls (`POST`, `PUT`, `PATCH`, `DELETE`) to the backend require a CSRF token in the `x-csrf-token` header. The token is set via a cookie by the backend on first request. In development, you can retrieve it from the `csrf-token` cookie after loading any page.
