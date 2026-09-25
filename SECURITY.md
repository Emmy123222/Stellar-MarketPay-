# Security Policy

## Reporting a Vulnerability

Stellar MarketPay handles financial transactions on-chain. We take security seriously and appreciate your help disclosing vulnerabilities responsibly.

### Contact

Use **GitHub Private Vulnerability Reporting** at:

https://github.com/Emmy123222/Stellar-MarketPay-/security/advisories

If you cannot use GitHub's private reporting, email **security@stellarmarketpay.dev** (or the maintainer's contact listed in the commit history).

### What to include

- Type of vulnerability
- Steps to reproduce
- Affected component(s) and version/commit
- Any proof-of-concept (if available)

---

## Scope

The following are **in scope** for security reports:

- **Smart contracts**: `contracts/` — Soroban (Rust/WASM) escrow and related contracts
- **Backend API**: `backend/src/` — Node.js / Express routes, services, middleware, authentication, database layer
- **Frontend**: `frontend/` — Next.js pages, API client helpers, wallet integration
- **Infrastructure config**: `infra/`, `docker-compose*.yml` — deployment, networking, secrets management
- **CI/CD workflows**: `.github/workflows/` — build and deploy pipelines

---

## Out of Scope

The following are **not in scope**:

- Previously reported vulnerabilities already tracked in public GitHub Issues
- Theoretical vulnerabilities without a working proof-of-concept
- Dependency CVEs that already have a patched version available (please upgrade instead)
- Phishing or social-engineering attacks against project contributors
- Issues in third-party systems not maintained by this project (e.g. Stellar network, Freighter wallet)

---

## Response SLA

| Step | Target Timeframe |
|------|-----------------|
| Acknowledgment | Within **48 hours** of submission |
| Triage & assessment | Within **5 business days** |
| Fix deployed (critical) | Within **14 days** of confirmation |
| Public disclosure | After fix is deployed or **90 days** from report, whichever comes first |

We will keep the reporter informed of progress at each stage.
