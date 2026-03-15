# Architecture — Stellar MarketPay

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User's Browser                             │
│  ┌────────────────────────────┐   ┌────────────────────────────┐   │
│  │  Next.js Frontend          │   │  Freighter Extension       │   │
│  │  (React + Tailwind)        │◄─►│  (Stellar Wallet)          │   │
│  └──────────┬─────────────────┘   └────────────────────────────┘   │
└─────────────┼───────────────────────────────────────────────────────┘
              │ REST API
              ▼
┌─────────────────────────────┐
│  Node.js Backend (Express)  │
│                             │
│  • Job CRUD                 │
│  • Application management   │
│  • Profile storage          │
│  • Escrow record keeping    │
└──────────────┬──────────────┘
               │ Horizon REST
               ▼
┌─────────────────────────────┐     ┌──────────────────────────────┐
│  Stellar Horizon API        │◄───►│  Stellar Network             │
│  (horizon-testnet           │     │  (Validators)                │
│   .stellar.org)             │     │                              │
└─────────────────────────────┘     └──────────────────────────────┘
                                               ▲
                                               │ Soroban
                                  ┌────────────────────────────────┐
                                  │  MarketPay Escrow Contract     │
                                  │  (Rust/WASM)                   │
                                  │                                │
                                  │  create_escrow()               │
                                  │  start_work()                  │
                                  │  release_escrow()              │
                                  │  refund_escrow()               │
                                  └────────────────────────────────┘
```

## Job Lifecycle

```
Client posts job ──► Budget locked in Soroban escrow
         │
         ▼
Freelancers submit proposals
         │
         ▼
Client reviews & accepts proposal
         │
         ▼
Job status → in_progress
Freelancer notified
         │
         ▼
Freelancer delivers work
         │
         ▼
Client reviews deliverables
         │
    ┌────┴────┐
    │         │
Approve    Dispute
    │         │
    ▼         ▼
Escrow    Admin
released  resolves (v2.1)
to
freelancer
```

## Escrow Flow (Soroban Contract)

```
create_escrow()          start_work()         release_escrow()
[Client locks XLM]  →  [Work begins]    →   [Funds sent to freelancer]
      │                                              OR
      └──────────── refund_escrow() ────────── [Refund to client]
                   [Before work starts]
```

## Security Model

| Concern | Mitigation |
|---------|-----------|
| Payment disputes | Soroban contract enforces rules — no human intermediary |
| Key exposure | Freighter signs locally — private key never leaves browser |
| Fake job postings | Wallet signature required to post (v1.1) |
| Double spending | Stellar sequence numbers prevent replay |
| Sybil freelancers | Reputation system planned (v1.4) |
| Backend trust | Backend is stateless helper — all payments are on-chain |
