# Architecture — Stellar MarketPay

This document describes the system as it actually exists in this repository: a Next.js frontend that signs and submits Soroban transactions directly through Freighter, an Express/PostgreSQL backend that serves as the REST/GraphQL API and an on-chain indexer/cache (not a funds custodian), and two independent Soroban contracts (`marketpay-contract` for escrow and `arbitrator-registry` for staked arbitrators).

## Table of Contents

- [System Overview](#system-overview)
- [Component Breakdown](#component-breakdown)
- [Job & Escrow Data Flow](#job--escrow-data-flow)
- [Escrow Contract Surface](#escrow-contract-surface)
- [Job Lifecycle](#job-lifecycle)
- [Infrastructure & Deployment](#infrastructure--deployment)
- [Security Model](#security-model)

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              User's Browser                                │
│  ┌───────────────────────────────┐        ┌──────────────────────────┐    │
│  │  Next.js Frontend (Pages       │◄──────►│  Freighter Extension    │    │
│  │  Router, React 18 + Tailwind)  │  sign   │  (Stellar Wallet)       │    │
│  └───────────┬─────────────────┬─┘        └──────────────────────────┘    │
│              │                 │                                            │
│      REST/GraphQL      Signed XDR — submitted directly, no backend hop      │
│    + WebSocket (JWT)                │                                       │
└──────────────┼──────────────────────┼───────────────────────────────────────┘
               ▼                      ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────┐
│   Express Backend (API)      │   │  Stellar Horizon / Soroban RPC        │
│                               │   │                                        │
│  • Job/application/profile   │   │  (horizon-testnet / soroban-testnet   │
│    CRUD (source of truth     │   │   .stellar.org, or mainnet equiv.)    │
│    for non-financial data)   │◄─►└───────────────┬────────────────────────┘
│  • SEP-10 auth + JWT/CSRF    │   Horizon polling/streaming              │
│  • WebSocket (/ws/realtime,  │   (indexerService)                       ▼
│    /ws/scope/:sessionId)     │                              ┌────────────────────────────┐
│  • Horizon indexer — mirrors │                              │  marketpay-contract (Rust/  │
│    on-chain escrow state     │                              │  WASM) — escrow, milestones,│
│    into Postgres             │                              │  sealed-bid auctions,        │
│  • Referral/audit bookkeeping│                              │  disputes & bonds,            │
│  • Service-keypair signer    │─────signs & submits──────────►  arbitration, DAO governance,  │
│    for automated timeout     │   (STELLAR_SERVICE_SECRET,   │  certificates, ratings         │
│    refunds & recurring       │    narrow, admin-scoped path)│                                  │
│    escrow ticks only         │                              └────────────────────────────┘
└──────────────┬────────────────┘                              ┌────────────────────────────┐
               │                                                 │  arbitrator-registry        │
      ┌────────┴─────────┐                                       │  (Rust/WASM) — staked        │
      ▼                  ▼                                       │  arbitrator pool, separate    │
┌───────────┐     ┌────────────┐                                 │  from marketpay-contract       │
│ PostgreSQL │     │   Redis    │                                └────────────────────────────┘
│ (pg, hand- │     │ (ioredis,  │
│  written   │     │  cache +   │
│  SQL, no   │     │  Bull job  │
│  ORM)      │     │  queue)    │
└───────────┘     └────────────┘
```

**Key correction from earlier versions of this document:** escrow funds do **not** flow through the backend. The frontend builds the Soroban contract call, Freighter signs it locally, and the signed transaction is submitted straight to Soroban RPC / Horizon from the browser. The backend's role for the funds path is to *read back* what happened (via its Horizon indexer) and keep Postgres in sync — it is a REST/GraphQL API and indexer/cache layer, not a payment intermediary. The one exception is a small set of backend-initiated, service-keypair-signed calls used for automation (timeout refunds, recurring escrow ticks) — see [Job & Escrow Data Flow](#job--escrow-data-flow).

---

## Component Breakdown

### Frontend (`frontend/`)

- **Framework**: Next.js 14 (Pages Router — `frontend/pages/`), React 18, TypeScript, Tailwind CSS.
- **API client**: a shared Axios instance (`frontend/lib/api/client.ts`, `withCredentials: true` so the JWT/CSRF cookies ride along) wrapped by per-domain modules — `lib/api/jobs.ts`, `applications.ts`, `escrow.ts`, `profiles.ts`, `messages.ts`, `disputes.ts`, `dao.ts`, `admin.ts`, `auth.ts`, `certificates.ts`, `assessments.ts`, `nft.ts`, and more. Data fetching in components goes through `hooks/useApi.ts` (SWR-based).
- **Wallet integration**: `frontend/lib/wallet.ts` uses `@stellar/freighter-api` (with a `window.freighter` fallback) for connecting, requesting access, and signing transactions.
- **Chain interaction**: `frontend/lib/stellar.ts` uses `@stellar/stellar-sdk` (`Horizon.Server`, `SorobanRpc.Server`, `Contract`, `TransactionBuilder`) to build Soroban contract invocations (e.g. `create_escrow`, `release_escrow`), gets a fee-tier estimate from `lib/sorobanFees.ts` (backed by the backend's `/api/gas-estimate`), hands the built XDR to Freighter to sign, then submits directly to Soroban RPC/Horizon. `lib/contractMock.ts` provides a mock-contract mode (`NEXT_PUBLIC_USE_CONTRACT_MOCK=true`) for local frontend work without a deployed contract.
- **Realtime**: `hooks/useRealtimeBids.ts` and other consumers connect to the backend's `/ws/realtime` WebSocket for live notifications, bid updates, and job-expiry warnings.
- **Other notable pieces**: PWA/service worker (`@ducanh2912/next-pwa`, `public/sw.src.js`) with background sync and push notifications; i18n (`next-i18next`); WebAuthn/passkey support (`@simplewebauthn/browser`, `lib/api/passkeys.ts`); end-to-end message encryption (`tweetnacl`, `lib/crypto.ts`); Storybook, Jest, and Playwright for component/unit/e2e testing.

### Backend (`backend/`)

- **Framework**: Express 5, entry point `backend/src/server.js` — a plain `http.createServer(app)` so the same server also hosts the raw `ws` WebSocket server via the HTTP `upgrade` event. Not a framework-managed server process.
- **Routes** (`backend/src/routes/`, ~35 files) cover jobs, applications, profiles, onboarding, escrow, auth (SEP-10), ratings, messaging, disputes, admin (+2FA), time entries, notifications, developer/public API keys, referrals, events, invitations, stats, contributors, gas estimation, transactions, DAO, proposal templates, price alerts, AI job-description scoring, and NFTs — plus a GraphQL endpoint at `/api/graphql`.
- **Services** (`backend/src/services/`, ~45 files) hold the business logic: `jobService`, `applicationService`, `profileService`, `escrowService`, `recurringEscrowService`, `disputeService`, `indexerService` (the Horizon indexer), `sorobanClient` / `sorobanArbitratorRegistry` / `sorobanEvidence` (read-only Soroban RPC calls), `notificationService`, `messageService`, `encryptionService`, `stellarServiceKey` (the narrow backend-signing path), `ipfsService`, `nftCertificateService`, `ratingService`, `referralService`, `daoService`, `cacheService` (Redis), `authTokens` (JWT/refresh tokens), `auditLogService`, and more.
- **Database**: **PostgreSQL** via a raw `pg.Pool` (`backend/src/db/pool.js`) — no ORM. Schema evolves through hand-written SQL migrations (`backend/src/db/migrations/V<N>__name.{up,down}.sql`) applied by a custom runner (`backend/src/db/migrate.js`) that validates the applied version against the highest version found on disk at boot. See [Troubleshooting: Migration Version Collisions](./troubleshooting.md#migration-version-collisions) for a known pitfall in this scheme.
- **Auth**: SEP-10 Stellar Web Authentication (`routes/auth.js`, matches `docs/auth-flow.md` / ADR-004) — the backend issues a challenge transaction, the client signs it with Freighter, and the backend verifies it and issues a JWT (httpOnly cookie) plus a CSRF token (`middleware/csrf.js`, double-submit cookie pattern via `csrf-csrf`). `middleware/auth.js` verifies the JWT on protected routes and gates admin routes behind role + optional TOTP 2FA. WebAuthn/passkeys (`routes/webauthn.js`) provide a secondary auth factor.
- **Caching & queues**: Redis via `ioredis` (`services/cacheService.js`) backs both response caching and a **Bull** job queue (`workers/emailWorker.js`) for email sending.
- **WebSocket server**: a raw `ws` server on the same HTTP server, with two paths — `/ws/realtime` (notifications, bid updates, job-expiry warnings, JWT passed as a query param, 5-connection-per-user cap, missed-notification replay) and `/ws/scope/:sessionId` (a collaborative scope-document editor with live sync, persisted with a 24h TTL).
- **Background workers**: interval-based (no external cron) — job-expiry checks, an escrow-timeout checker, notification processing, idempotency-key cleanup, WS event cleanup, weekly digest/report emails, soft-deleted-record purging, a recurring-escrow ticker, saved-search alerts, and API-key rotation finalization — all started from `bootstrap()` in `server.js`.
- **Talking to Stellar**: `services/indexerService.js` polls/streams Horizon for payments touching the platform wallet/contract, parses job IDs out of memos, classifies escrow events, and writes the result back into Postgres (an `indexer_state` table tracks the sync checkpoint) — this is how the backend's view of escrow state stays consistent with the chain. `services/stellarServiceKey.js` holds a backend-owned Stellar keypair used **only** for a small set of automated, admin-scoped contract calls (timeout refunds, recurring escrow ticks) — not for regular user-initiated escrow operations.

### Smart Contracts (`contracts/`)

- **`marketpay-contract`** (`contracts/marketpay-contract/src/lib.rs`, Soroban SDK 22, `#![no_std]`) — the core escrow contract. 71 public entrypoints covering: escrow create/start/release/refund/timeout, milestone-based partial release, sealed-bid budget commitment and freelancer bid auctions, disputes with configurable bonds, (partially implemented) multi-arbitrator arbitration cases, DAO governance proposals/voting, job boosts, on-chain message CID notarization, deliverable-hash oracle verification, completion certificates, ratings, and multi-sig admin/freeze controls. See [`docs/contract-api-reference.md`](./contract-api-reference.md) for the full function-by-function reference.
- **`arbitrator-registry`** (`contracts/arbitrator-registry/src/lib.rs`) — a separate, independently deployed contract that manages a staking-gated pool of arbitrators (register/deregister with a minimum XLM/token stake, DAO-driven registration/removal). It is **not currently wired into `marketpay-contract`'s dispute resolution on-chain** — `resolve_dispute` is gated by a single `arbitrator` address set via `set_arbitrator`, independently of this registry. The two are connected administratively today, not contractually.
- **`contracts/certora/`** — a Certora formal-verification specification (`escrow.spec`) for the escrow contract; not a deployable crate (see `docs/formal-verification.md`).

---

## Job & Escrow Data Flow

1. **Auth**: The frontend requests a SEP-10 challenge (`GET /api/auth`), signs it with Freighter, and posts it back. The backend verifies the signature and sets a JWT (httpOnly cookie) plus issues a CSRF token.
2. **Job posting**: `POST /api/jobs` writes the job directly into PostgreSQL via `jobService`. No blockchain interaction happens at this step — pure backend CRUD.
3. **Application / hiring**: similarly REST CRUD through `applicationService` into Postgres, with realtime updates pushed over `/ws/realtime`.
4. **Escrow creation (funds path)**: once a client hires a freelancer, the **frontend** — not the backend — builds the `create_escrow` Soroban invocation (`frontend/lib/stellar.ts`), gets it signed by Freighter, and submits it directly to Soroban RPC/Horizon. The funds are locked **inside the Soroban contract**, never touching the backend.
5. **Indexing**: `indexerService` observes the resulting Horizon transaction, updates the `escrows`/`jobs` tables in Postgres, advances its sync checkpoint, and broadcasts a realtime WebSocket event so connected clients see the new state without polling.
6. **Release / refund**: The client-initiated release/refund follows the same frontend-signs-directly pattern as creation. The frontend also calls back to the backend (`POST /api/escrow/:jobId/release`) with the resulting `contractTxHash` so it can update status, process referral bookkeeping (`referralService`), and write an audit log — the backend explicitly does not move funds on this path. The one exception: **automated** timeout refunds and recurring-escrow ticks are signed and submitted by the backend itself using its own service keypair (`stellarServiceKey`), a narrow and explicitly scoped automation path distinct from normal user-initiated calls.
7. **Disputes / arbitration**: `disputeService` manages dispute records and IPFS-hosted evidence (`ipfsService`), reading arbitrator membership from the `arbitrator-registry` contract via `sorobanArbitratorRegistry`.

---

## Escrow Contract Surface

The escrow contract now exposes far more than the four core functions historically documented here. Grouped by category (see [`docs/contract-api-reference.md`](./contract-api-reference.md) for full signatures):

| Category | Representative functions |
|---|---|
| Escrow lifecycle | `create_escrow`, `create_escrow_with_deliverable`, `create_escrow_with_milestones`, `start_work`, `release_escrow`, `release_with_conversion`, `refund_escrow`, `timeout_refund` |
| Milestones | `release_milestone`, `reject_milestone`, `get_milestone` |
| Sealed-bid auctions | `commit_budget`, `reveal_budget`, `submit_bid_commitment`, `close_bidding`, `reveal_bid`, `get_revealed_bids` |
| Disputes & bonds | `raise_dispute`, `resolve_dispute`, `set_dispute_bond`, `get_dispute_bond`, `get_dispute_bond_config` |
| Arbitration cases | `resolve_arbitration` (case creation / vote submission are not yet exposed as public entrypoints — see the API reference for this gap) |
| Deliverable oracle | `submit_deliverable_hash`, `submit_deliverable`, `verify_deliverable_hash`, `check_deliverable_match` |
| Certificates & ratings | `mint_certificate`, `get_certificate`, `submit_client_rating`, `submit_freelancer_rating` |
| Governance (DAO) | `create_proposal`, `cast_vote`, `resolve_proposal`, `list_active_proposals` |
| Job boost | `boost_job` |
| Messaging | `publish_message`, `get_message_cids` |
| Extensions | `request_extension`, `approve_extension` |
| Admin / multi-sig / freeze | `freeze_contract`, `unfreeze_contract`, `add_admin`, `set_unfreeze_threshold`, `set_treasury_address`, `set_platform_fee_bps`, `set_default_timeout_seconds`, `set_max_referrer_bonus_xlm`, `upgrade` |

### Escrow state machine

```
        create_escrow() / create_escrow_with_deliverable()
        create_escrow_with_milestones()
              │
              ▼
         ┌──────────┐
         │  Locked  │
         └──────────┘
        /            \
  start_work()    refund_escrow()
      /               or timeout_refund()
     ▼                       ▼
┌────────────┐        ┌──────────┐
│ InProgress │        │ Refunded │  (terminal)
└────────────┘        └──────────┘
     │  \
     │   raise_dispute()
     │         ▼
     │    ┌──────────┐
     │    │ Disputed │ ← release_milestone()/reject_milestone() still work here
     │    └──────────┘
     │         │
release_escrow() / submit_deliverable() (hash match) / release_milestone() (last one) / resolve_dispute()
     ▼
┌──────────┐
│ Released │  (terminal)
└──────────┘
```

---

## Job Lifecycle

```
Client posts job ──► (backend CRUD only — no chain interaction yet)
         │
         ▼
Freelancers submit proposals / sealed bids
         │
         ▼
Client reviews & accepts a proposal
         │
         ▼
Client's browser signs create_escrow() via Freighter ──► budget locked in Soroban contract
Job status → in_progress; freelancer notified (WebSocket)
         │
         ▼
Freelancer delivers work (optionally hashed via the deliverable oracle)
         │
         ▼
Client reviews deliverables or milestones
         │
    ┌────┴────┐
    │         │
 Approve    Dispute
    │         │
    ▼         ▼
Escrow    Dispute bond (if configured) locked;
released  arbitrator resolves via resolve_dispute()
to            (multi-arbitrator arbitration cases are
freelancer     only partially wired — see contract API reference)
```

---

## Infrastructure & Deployment

- **Local dev** (`docker-compose.yml`): `frontend` (Next.js dev server, port 3000), `backend` (Express dev server, port 4000), `redis` (`redis:7-alpine`), `postgres` (`postgres:16-alpine`), and an opt-in `logging` profile running Elasticsearch + Kibana + Filebeat for local ELK log inspection.
- **Production** (`docker-compose.prod.yml`): `nginx` reverse proxy/TLS termination + `certbot` for renewal, **blue/green** `frontend-blue`/`frontend-green` and `backend-blue`/`backend-green` services (image-tag driven, gated by `blue`/`green` Compose profiles), a metrics stack (`node-exporter`, `prometheus`, `grafana`), and an optional `watchtower` for auto-updates. `deploy/scripts/` (`deploy.sh`, `health-check.sh`, `rollback.sh`, `switch-traffic.sh`) implement the blue/green cutover.
- **Kubernetes**: `deploy/helm/marketpay/` is a Helm chart with templates for `backend`, `frontend`, `postgres`, and `redis`, as an alternative to the Compose-based deployment.
- **Edge/WAF**: `infra/cloudflare/main.tf` (Terraform) configures Cloudflare-level WAF/DNS/edge rules.
- **Monitoring**: `monitoring/prometheus/` (scrape config + alert rules) and `monitoring/grafana/` (dashboards + provisioning) back the Prometheus/Grafana stack referenced above; `monitoring/filebeat/` + `monitoring/setup-elk.sh` support the optional ELK logging profile.
- **Load testing**: `k6/` holds k6 scripts (`get-jobs.js`, `get-profiles.js`, `post-applications.js`, `seed-data.js`) exercised via `docker-compose.loadtest.yml`.

**Note on `packages/`**: `packages/backend` and `packages/client` contain a small, self-contained prototype (a TypeORM-style messaging service and one React component) that is **not wired into the real `frontend/`/`backend/` build** — the root `package.json` has no `workspaces` field referencing it, and git history shows only two isolated experimental commits ever touched it. Treat it as legacy/dead code, not part of the live architecture.

---

## Contract Surface

The primary `MarketPayContract` exposes these capability groups:

| Capability | Representative entry points |
|------------|-----------------------------|
| Initialization and upgrades | `initialize`, `upgrade`, `get_version` |
| Escrow lifecycle | `create_escrow`, `start_work`, `release_escrow`, `refund_escrow`, `timeout_refund` |
| Milestones | `create_escrow_with_milestones`, `release_milestone`, `reject_milestone`, `get_milestone` |
| Disputes and arbitration | `raise_dispute`, `resolve_dispute`, `set_dispute_bond`, `get_dispute_bond`, `resolve_arbitration` |
| Sealed-bid auctions | `commit_budget`, `reveal_budget`, `submit_bid_commitment`, `close_bidding`, `reveal_bid`, `get_revealed_bids` |
| Deliverables and evidence | `submit_deliverable_hash`, `submit_deliverable`, `submit_evidence_cid`, `get_evidence_cids` |
| Certificates and ratings | `mint_certificate`, `get_certificate`, `submit_client_rating`, `submit_freelancer_rating` |
| Messaging | `publish_message`, `get_message_cids` |
| Governance and administration | `create_proposal`, `cast_vote`, `resolve_proposal`, `freeze_contract`, `unfreeze_contract`, `set_platform_fee_bps` |

`contracts/arbitrator-registry` is a separate registry contract for arbitrator enrollment and DAO-managed registry updates.

## Security Model

| Concern | Mitigation |
|---------|-----------|
| Payment disputes | Soroban contract enforces escrow rules; disputes go through a bonded `raise_dispute()`/`resolve_dispute()` flow, with multi-arbitrator arbitration cases only partially implemented today (see the contract API reference) |
| Key exposure | Freighter signs locally — the client's private key never leaves the browser extension |
| Backend-signed transactions | Limited to a narrow, explicitly-scoped service keypair (`STELLAR_SERVICE_SECRET`) used only for automated timeout refunds and recurring-escrow ticks — never for user-initiated fund movement |
| Session/API security | SEP-10 wallet-signature authentication, JWT + CSRF double-submit cookie protection, optional WebAuthn/passkey second factor, admin TOTP 2FA |
| Fake job postings | Wallet-authenticated session required to post (SEP-10) |
| Double spending | Stellar sequence numbers prevent transaction replay |
| Cross-site request forgery | `csrf-csrf` double-submit cookie on all state-mutating REST endpoints not otherwise exempted (see [Troubleshooting](./troubleshooting.md#csrf-403-errors-when-calling-the-api-from-a-script)) |
| Backend trust | Backend is a REST/GraphQL API + on-chain indexer/cache — it does not custody escrowed funds for the normal client-initiated flow |
| Dispute evidence integrity | Evidence CIDs anchored on-chain (`submit_evidence_cid`) alongside IPFS-hosted content |
| Contract upgrades | Admin-gated `upgrade()` entrypoint preserves storage across WASM redeploys; multi-sig `freeze_contract`/`unfreeze_contract` (M-of-N admin signatures) provides an emergency stop |

---

**Last Updated**: 2026-08-24
