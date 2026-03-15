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
