# Documentation Index

Welcome to Stellar MarketPay documentation. This index is the entry point to the `docs/` tree and is organized by audience so you can jump straight to what you need.

Every entry below resolves to an existing file. Files that are intentionally not indexed (duplicates, stubs, or non-reference assets) are listed under [Intentionally excluded](#-intentionally-excluded) with a note.

---

## 👥 Choose your audience

| Audience | Who | Start here |
|----------|-----|------------|
| **Contributor** | Anyone building, modifying, or reviewing the platform (backend, frontend, contracts, CI) | [For Contributors](#-for-contributors) |
| **Operator** | Anyone deploying, running, or on-calling the platform in production | [For Operators](#-for-operators) |
| **Integrator** | Anyone integrating with the MarketPay API, WebSocket, or SDKs | [For Integrators](#-for-integrators) |

---

## 👩‍💻 For Contributors

Building and changing Stellar MarketPay.

### Get started

- **[Getting Started](./getting-started.md)** - Clone, install, and run the platform locally
- **[Quickstart Checklist](./quickstart-checklist.md)** - Get up and running in under 5 minutes
- **[Architecture Overview](./architecture.md)** - High-level system design ⚠️ brief stub; see the ADRs below for detailed decisions
- **[Data Model & ER Diagram](./data-model.md)** - Complete PostgreSQL entity relationship diagram and data dictionary

### Architecture Decision Records (ADRs)

Full list: [docs/adr/README.md](./adr/README.md)

- **[ADR-001: Soroban Escrow Design](./adr/adr-001-soroban-escrow-design.md)** - Trustless escrow management on Soroban
- **[ADR-002: Horizon API Indexing](./adr/adr-002-horizon-api-indexing.md)** - Horizon REST API as primary transaction data source
- **[ADR-003: Database Schema for Escrow](./adr/adr-003-database-schema-escrow.md)** - Off-chain escrow state in PostgreSQL
- **[ADR-004: SEP-10 vs OAuth](./adr/adr-004-sep10-authentication.md)** - SEP-10 wallet-based authentication
- **[ADR-005: NaCl Message Encryption](./adr/adr-005-nacl-message-encryption.md)** - End-to-end encrypted private messages
- **[ADR-006: IPFS Dispute Evidence](./adr/adr-006-ipfs-dispute-evidence.md)** - IPFS storage for dispute evidence
- **[ADR-007: WebAuthn Secondary Auth](./adr/adr-007-webauthn-secondary-auth.md)** - WebAuthn as a second authentication factor
- **[ADR-008: Redis Session Cache](./adr/adr-008-redis-session-cache.md)** - Redis for sessions and caching
- **[ADR-009: WebSocket vs SSE](./adr/adr-009-websocket-vs-sse.md)** - Real-time update transport choice
- **[ADR-010: Cursor Pagination](./adr/adr-010-cursor-pagination.md)** - Cursor-based pagination strategy
- **[ADR-011: CI Consolidation](./adr/adr-011-ci-consolidation.md)** - Consolidated CI pipelines

### Contracts & backend

- **[Smart Contract API Reference](./contract-api-reference.md)** - Public functions, events, and errors of the MarketPay Soroban contract
- **[Soroban Contract Deployment](./contract-deployment.md)** - Build, deploy, and configure the escrow contract
- **[Contract Errors](./contract-errors.md)** - Contract error codes and handling
- **[Milestone-Based Escrow Specification](./milestone_escrow_contract.md)** - Milestone release schedules, proof submission, buyer approval
- **[Dispute Resolution Logic](./dispute_resolution_logic.md)** - 2-of-3 multi-sig arbitration flow
- **[Backend Contract Audit Service](./backend_audit_service.md)** - Automated WASM verification hooks
- **[Formal Verification with Certora](./formal-verification.md)** - Proving escrow contract safety properties with Certora

### Security & configuration

- **[Security Header Policy](./security.md)** - HTTP security headers, verification, and CI checks
- **[Authentication Flow (SEP-10)](./auth-flow.md)** - Complete SEP-10 auth flow with sequence diagrams
- **[Encryption Protocol](./encryption.md)** - NaCl box (X25519-XSalsa20-Poly1305) end-to-end encryption
- **[Messaging Encryption](./messaging-encryption.md)** - Client-side encryption contract for private job messages
- **[Subresource Integrity (SRI)](./sri.md)** - SRI for CDN-loaded scripts
- **[CI Secrets](./ci-secrets.md)** - Managing secrets in CI/CD
- **[Environment Variables](./environment-variables.md)** - Single source of truth for runtime config

### Project & process

- **[README](../README.md)** - Project overview and features
- **[CONTRIBUTING](../CONTRIBUTING.md)** - Contribution guidelines
- **[ROADMAP](../ROADMAP.md)** - Feature roadmap
- **[FAQ](./FAQ.md)** - Frequently asked questions (50+ questions across 10 categories)

---

## 🚀 For Operators

Deploying, running, and on-calling Stellar MarketPay in production.

### Deployment

- **[Deployment Guide](./deployment.md)** - How to deploy Stellar MarketPay
- **[Deployment Production](./deployment-production.md)** - Production deployment notes
- **[Soroban Deployment Guide](./soroban_deployment_guide.md)** - Contract deployment guide for operators

### Databases & performance

- **[Database Schema & ERD](./database-schema.md)** - Detailed PostgreSQL table definitions and index tuning
- **[Database Backup & Restore](./database-backup-restore.md)** - Backup and restore procedures
- **[Database Pool Tuning](./database-pool-tuning.md)** - Connection pool tuning
- **[Data Archiving](./data-archiving.md)** - Archiving old completed jobs for database performance
- **[Query Optimization](./query-optimization.md)** - Query performance tuning

### Runbooks & incident response

- **[Runbook: IPFS Gateway Failure](./runbooks/ipfs-gateway-failure.md)** - SEV-2 runbook for Pinata gateway outages affecting dispute evidence

### Infrastructure & operations

- **[CDN Setup](./cdn-setup.md)** - CDN configuration
- **[Service Key Setup](./service-key-setup.md)** - Service account keys
- **[Web Push Setup](./web-push-setup.md)** - VAPID web push configuration
- **[Environment Variables](./environment-variables.md)** - Runtime configuration reference
- **[CI Secrets](./ci-secrets.md)** - CI/CD secret management
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions

---

## 🔌 For Integrators

Integrating with the MarketPay API, real-time protocol, and SDKs.

### API reference

- **[API Reference](./api.md)** - Detailed REST API reference (endpoints, auth, rate limits, schemas)
- **[API Client SDK](./api-client-sdk.md)** - Auto-generated TypeScript, Python, and Go SDKs
- **[Contract API Reference](./contract-api-reference.md)** - Soroban contract functions, events, and errors
- **[Contract Errors](./contract-errors.md)** - Contract error codes (shared with contributors)

### Real-time & events

- **[WebSocket Scope Protocol](./websocket-scope-protocol.md)** - Realtime scope session protocol and client schema
- **[WebSocket Events API](./websocket-events.md)** - Real-time WebSocket events (bids, notifications, job state)

### Integration guides

- **[Authentication Flow (SEP-10)](./auth-flow.md)** - Wallet-based authentication for API clients
- **[IPFS Setup](./ipfs-setup.md)** - Pinata IPFS setup for evidence and attachments
- **[Dispute Resolution](./dispute-resolution.md)** - On-chain arbitration and evidence management
- **[Onboarding Flow](./onboarding-flow.md)** - Multi-step freelancer onboarding walkthrough
- **[Environment Variables](./environment-variables.md)** - Runtime config needed to connect
- **[FAQ](./FAQ.md)** - Frequently asked questions

---

## 📖 Project documentation (repo root)

Referenced from the index but lives outside `docs/`:

- **[README](../README.md)** - Project overview
- **[CONTRIBUTING](../CONTRIBUTING.md)** - Contribution guidelines
- **[ROADMAP](../ROADMAP.md)** - Feature roadmap

---

## ⚠️ Intentionally excluded

The following files exist under `docs/` but are deliberately not indexed as reference documentation:

| File | Reason |
|------|--------|
| `docs/adr/001-sep10-authentication.md` | Duplicate SEP-10 ADR (misnumbered `001`, collides with ADR-001). Superseded by [ADR-004](./adr/adr-004-sep10-authentication.md). |
| `docs/API_DOCUMENTATION.md` | 3-line stub; duplicate of API docs. Use [API Reference](./api.md). |
| `docs/api-documentation.md` | Describes OpenAPI/Swagger setup; overlaps [API Reference](./api.md). Use `api.md` for the endpoint reference. |
| `docs/pr-description-1425.md` | A committed pull-request description, not a reference document. |
| `docs/demo-walkthrough-captions.srt` | Media captions/subtitles asset, not a documentation page. |
| `docs/video-walkthrough-script.md` | Production media script, not a reference document. |
| `IMPLEMENTATION_SUMMARY.md` | Previously referenced at repo root (`../IMPLEMENTATION_SUMMARY.md`) but does not exist; entry removed. |

---

## 📁 Documentation tree

```
docs/
├── INDEX.md              (this file)
├── README.md             (docs landing page)
├── FAQ.md
├── api.md
├── api-client-sdk.md
├── architecture.md
├── auth-flow.md
├── backend_audit_service.md
├── cdn-setup.md
├── ci-secrets.md
├── contract-api-reference.md
├── contract-deployment.md
├── contract-errors.md
├── data-archiving.md
├── data-model.md
├── database-backup-restore.md
├── database-pool-tuning.md
├── database-schema.md
├── deployment.md
├── deployment-production.md
├── dispute_resolution_logic.md
├── dispute-resolution.md
├── encryption.md
├── environment-variables.md
├── formal-verification.md
├── getting-started.md
├── ipfs-setup.md
├── messaging-encryption.md
├── milestone_escrow_contract.md
├── onboarding-flow.md
├── pr-description-1425.md        (excluded: PR description)
├── query-optimization.md
├── quickstart-checklist.md
├── security.md
├── service-key-setup.md
├── soroban_deployment_guide.md
├── sri.md
├── troubleshooting.md
├── video-walkthrough-script.md   (excluded: media script)
├── web-push-setup.md
├── websocket-events.md
├── websocket-scope-protocol.md
├── adr/
│   ├── README.md
│   ├── 001-sep10-authentication.md   (excluded: duplicate SEP-10 ADR)
│   ├── adr-001-soroban-escrow-design.md
│   ├── adr-002-horizon-api-indexing.md
│   ├── adr-003-database-schema-escrow.md
│   ├── adr-004-sep10-authentication.md
│   ├── adr-005-nacl-message-encryption.md
│   ├── adr-006-ipfs-dispute-evidence.md
│   ├── adr-007-webauthn-secondary-auth.md
│   ├── adr-008-redis-session-cache.md
│   ├── adr-009-websocket-vs-sse.md
│   ├── adr-010-cursor-pagination.md
│   └── adr-011-ci-consolidation.md
├── API_DOCUMENTATION.md          (excluded: stub duplicate)
├── api-documentation.md          (excluded: duplicate)
└── runbooks/
    └── ipfs-gateway-failure.md
```

---

## 🔍 Quick search by topic

**Blockchain & Smart Contracts**

- [ADR-001: Soroban Escrow](./adr/adr-001-soroban-escrow-design.md)
- [Contract API Reference](./contract-api-reference.md)
- [Contract Deployment](./contract-deployment.md)
- [Milestone Escrow Spec](./milestone_escrow_contract.md)
- [Formal Verification](./formal-verification.md)

**Authentication & Security**

- [ADR-004: SEP-10](./adr/adr-004-sep10-authentication.md)
- [Auth Flow (SEP-10)](./auth-flow.md)
- [Encryption Protocol](./encryption.md)
- [Messaging Encryption](./messaging-encryption.md)
- [Security Header Policy](./security.md)
- [SRI for CDN Scripts](./sri.md)

**Database & Backend**

- [Database Schema & ERD](./database-schema.md)
- [Data Model & ER Diagram](./data-model.md)
- [Database Backup & Restore](./database-backup-restore.md)
- [Database Pool Tuning](./database-pool-tuning.md)
- [Data Archiving](./data-archiving.md)
- [Query Optimization](./query-optimization.md)
- [Backend Audit Service](./backend_audit_service.md)

**API & Integration**

- [API Reference](./api.md)
- [API Client SDK](./api-client-sdk.md)
- [WebSocket Scope Protocol](./websocket-scope-protocol.md)
- [WebSocket Events API](./websocket-events.md)
- [IPFS Setup](./ipfs-setup.md)
- [Environment Variables](./environment-variables.md)

**Operations**

- [Deployment Guide](./deployment.md)
- [Deployment Production](./deployment-production.md)
- [Runbook: IPFS Gateway Failure](./runbooks/ipfs-gateway-failure.md)
- [Troubleshooting](./troubleshooting.md)
- [CI Secrets](./ci-secrets.md)

**User Guides**

- [FAQ](./FAQ.md)
- [Getting Started](./getting-started.md)
- [Quickstart Checklist](./quickstart-checklist.md)
- [Onboarding Flow](./onboarding-flow.md)
- [Dispute Resolution](./dispute-resolution.md)

---

## 📞 Support & Contact

- **GitHub Issues**: [stellar-marketpay/issues](https://github.com/DevFaster/Stellar-MarketPay-/issues)
- **Contributing**: See [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Roadmap**: See [ROADMAP.md](../ROADMAP.md)

---

> **Maintained.** This index is audited against the `docs/` tree on every change. If you add, rename, or remove a document, update `INDEX.md` in the same pull request.
