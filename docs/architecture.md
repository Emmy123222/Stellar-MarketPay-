# Architecture Overview

The system is a two-sided marketplace for jobs paid in Stellar assets. Employers post jobs and fund escrow contracts; freelancers submit work and receive payments on release or dispute resolution. The architecture is composed of a Next.js frontend, an Express API with WebSockets, PostgreSQL and Redis, a Horizon indexer, Bull workers, and two Soroban contracts.

## Components

| Component | Technology | Default port | Purpose | Source directory |
| --- | --- | --- | --- | --- |
| Frontend | Next.js (App Router) | 3000 | UI for job posting, funding, delivery, release and disputes | `frontend/` |
| API | Express + WebSockets (`ws`) | 4000 | HTTP REST endpoints and real-time event push to clients | `backend/src/server.js` |
| PostgreSQL | PostgreSQL 15+ | 5432 | Durable store for jobs, escrow records, users, disputes and indexer cursor | `backend/src/db/` |
| Redis | Redis 7+ | 6379 | Cache, Bull queue backend, and WebSocket pub/sub fan-out | `backend/src/queue/` |
| Horizon indexer | Node.js worker polling Stellar Horizon | n/a | Tails the ledger for contract events and persists them to PostgreSQL | `backend/src/indexer/` |
| Bull workers | Bull 4+ and iORed (Node.js) | n/a | Asynchronous jobs: notifications, reconciliation, retry of chain submissions | `backend/src/workers/` |
| MarketPay contract | Soroban (Rust) | n/a | Job lifecycle and escrow funds holding | `contracts/marketpay-contract/` |
| Dispute resolver contract | Soroban (Rust) | n/a | Arbitration of disputes and release of escrow to either party | `contracts/dispute-resolver-contract/` |

### Component diagram

```mermaid
flowchart LR
  subgraph Client
    FE[Next.js Frontend:3000]
  end
  subgraph Backend
    API[Express API + WS:4000]
    IDX[Horizon Indexer]
    WRK[Bull Workers]
  end
  subgraph Data
    PG[(PostgreSQL:5432)]
    RD[(Redis:6379)]
  end
  subgraph Chain
    HZ[Stellar Horizon]
    MC[MarketPay Contract]
    DC[Dispute Resolver Contract]
  end

  FE -- HTTP REST --> API
  FE -- WS --> API
  API --> PG
  API --> RD
  API --> HZ
  API --> IDX
  IDX --> HZ
  IDX --> PG
  IDX --> RD
  WRK --> PG
  WRK --> RD
  API --> MC
  API --> DC
  HZ --> MC
  HZ --> DC
```

### Ports and configuration

Defaults are defined in `.env.example` at the repo root and in `backend/src/config/`:

- `PORT=4000` -- Express API and WebSocket server.
- `FRONTEND_URL=http://localhost:3000` -- CORS origin for the API and WS.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketpay` -- PostgreSQL.
- `REDIS_URL=redis://localhost:6379` -- Redis for Bull and WS pub/sub.
- `STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org` -- Horizon endpoint used by the indexer and API.
- `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org` -- Soroban RPC for contract invocations.
- `MARKETPAY_CONTRACT_ID=` -- deployed MarketPay contract id.
- `DISPUTE_RESOLVER_CONTRACT_ID=` -- deployed Dispute Resolver contract id.

### Data stores

- PostgreSQL is the source of truth for application state. Tables live in `backend/src/db/migrations/` and include `jobs`, `escrows`, `users`, `disputes`, `chain_events` and `indexer_cursor`.
- Redis holds transient state: Bull queues (`job-notifications`, `job-reconcile`) and the WS pub/sub channels used to fan out chain events to connected clients.
- Stellar Horizon is the chain source of truth for funds and contract events; the indexer copies those events into PostgreSQL so the API never needs to query Horizon on the request path.

## Escrow lifecycle data flow

The diagram below traces a job from posting to release or dispute resolution, including the indexer and the WS notification path.

```mermaid
sequenceDiagram
  participant EMP as Employer (Frontend)
  participant FRE as Freelancer (Frontend)
  participant API as Express API
  participant DB as PostgreSQL
  participant RED as Redis
  participant MC as MarketPay Contract
  participant DC as Dispute Resolver Contract
  participant IDX as Horizon Indexer
  participant WRK as Bull Workers

  EMP->>API: POST /jobs (title, budget, deadline)
  API->>DB: INSERT job status='OPEN'
  API-->>FRE: WS job.created

  FRE>>API: POST /jobs/:id/apply
  API->>DB: INSERT application
  API-->>EMP: WS application.received

  EMP>>API: POST /jobs/:id/fund
  API->>DB: update job status='FUNDING'
  API->>MC: invoke fund_escrow(job_id, amount)
  MC-->>API: transaction hash
  API->>RED: enqueue job-reconcile
  IDX->>HO: stream ledger for MarketPay events
  IDX->>DB: INSERT chain_events (escrow.funded)
  IDX->>DB: update job status='IN_PROGRESS'
  IDX->>RED: PUBLISH job.funded
  RED->>API: subscribe message
  API-->>EMP: WS job.funded
  API-->>FRE: WS job.funded

  FRE>>API: POST /jobs/:id/deliver (deliverable)
  API->>RED: enqueue job-notifications
  WRK->>API: send notification to employer
  API-->>EMP: WS job.delivered

  alt Release
    Em->>API: POST /jobs/:id/release
    API->>MC: invoke release_escrow(job_id)
    MC-->>API: transaction hash
    IDX->>DB: INSERT chain_events (escrow.released)
    IDX->>RED: PUBLISH job.released
    RED->>API: subscribe message
    API-->>FRE: WS job.released
  else Dispute
    Emp->>API: POST /jobs/:id/dispute (reason)
    API->>DB: INSERT disputes status='OPEN'
    API->>DC: invoke open_dispute(job_id)
    IDX->>DB: INSERT chain_events (dispute.opened)
    IDX->>DB: update job status='DISPUTED'
    DC->>API: arbitrator resolution (release_to_employer | release_to_freelancer)
    IDX->>RED: PUBLISH  job.resolved
    RED->>API: subscribe message
    API-->>EMP: WS job.resolved
    API-->>FRE: WS job.resolved
  end
```

### State transitions

Job status is managed in PostgreSQL and mirrors the contract enum in `contracts/marketpay-contract/src/lib.rs`:

```
OPEN -> FUNDING -> IN_PROGRESS -> DELIVERED -> RELEASED
FUNDING -> DISPUTED, DELIVERED -> DISPUTED, DISPUTED -> RESOLVED
```

The indexer is the only component allowed to move a job into a chain-confirmed state (`IN_PROGRESS`, `RELEASED`, `RESOLVED`). The API only writes optimistic states (`OPEN`, `FUNDING`, `DISPUTED`) and the Bull worker confirms the transaction hash before the indexer finalizes the state.

## Directory map

| Path | What lives there |
| --- | --- |
| `frontend/app/` | Next.js App Router pages for job list, job detail, dispute center |
| `frontend/components/` | Shared UI components, including the WS hook in `useSocket.ts` |
| `frontend/lib/` | API client, Stellar wallet helpers, formatters |
| `backend/src/server.js` | Express app, HTTP routers and WS upgrade handler |
| `backend/src/routes/` | REST route handlers (`jobs`, `auth`, `users`, `webhooks`) |
| `backend/src/services/` | Domain logic (escrow orchestration, contract clients) |
| `backend/src/indexer/` | Horizon poller, event decoder, cursor persistence |
| `backend/src/workers/` | Bull processors for notifications and reconciliation |
| `backend/src/db/` | Database connection and migrations |
| `backend/src/ws/` | WebSocket connection registry and Redis pub/sub bridge |
| `contracts/marketpay-contract/` | Soroban contract for jobs and escrow funds |
| `contracts/dispute-resolver-contract/` | Soroban contract for dispute arbitration |
| `docs/adr/` | Architecture Decision Records |

## Request flows

- HTTP: browser -> Next.js (3000) -> Express (4000) -> PostgreSQL/ Redis/ Soroban RPC.
- WebSocket: browser -> Express WS (4000) -> Redis pub/sub -> all connected clients for the affected job.
- Chain events: Horizon -> indexer -> PostgreSQL + Redis publish -> WS clients.
- Async work: API -> Redis Bull queue -> Bull worker -> PostgreSQL/ notification provider.

## Related documents

- [ADRs](docs/adr/) -- decisions on the indexer cursor, WS fan-out and escrow state machine.
- [Docs index](docs/INDEX.md)
- [API reference](docs/api.md)
- [Contract reference](docs/contracts.md)
- [Local development](docs/development.md)
