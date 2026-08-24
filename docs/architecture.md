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
                                  │  MarketPay Contract Suite      │
                                  │  (Soroban Rust/WASM)           │
                                  │                                │
                                  │  Escrow lifecycle              │
                                  │  Milestones + disputes         │
                                  │  Sealed-bid auctions           │
                                  │  Deliverables + evidence CIDs  │
                                  │  Governance + admin controls   │
                                  └────────────────────────────────┘
```

## Job Lifecycle

```
Client posts job ──► Optional sealed budget commitment
         │
         ▼
Freelancers submit sealed bid commitments
         │
         ▼
Client closes bidding; freelancers reveal bids
         │
         ▼
Client selects freelancer and creates escrow
         │
         ▼
Budget locked in Soroban escrow
         │
         ▼
Freelancer starts work
         │
         ▼
Job status → in_progress
         │
         ▼
Freelancer submits deliverable hash / IPFS evidence
         │
         ▼
Client reviews deliverables or milestones
         │
    ┌────┴───────────────┬──────────────────┐
    │                    │                  │
Approve              Dispute          Timeout/refund
    │                    │                  │
    ▼                    ▼                  ▼
Funds released       Bonded dispute   Funds refunded
to freelancer        + arbitration    when eligible
```

## Escrow Flow (Soroban Contract)

```
commit_budget() ──► submit_bid_commitment() ──► close_bidding() ──► reveal_bid()
      │
      ▼
create_escrow() / create_escrow_with_milestones()
[Client locks XLM/USDC in the selected SAC token]
      │
      ├──► start_work() ──► release_escrow()
      │                    [Full payout, platform fee, optional referral bonus]
      │
      ├──► release_milestone() / reject_milestone()
      │                    [Partial payout or milestone refund]
      │
      ├──► submit_deliverable_hash() / submit_deliverable()
      │                    [Hash match auto-releases; mismatch enters dispute]
      │
      ├──► raise_dispute() ──► resolve_dispute() / resolve_arbitration()
      │                    [Bonded dispute path with evidence CIDs]
      │
      └──► refund_escrow() / timeout_refund()
                           [Client refund before work or after timeout]
```

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
| Payment disputes | Soroban contract enforces rules — no human intermediary |
| Key exposure | Freighter signs locally — private key never leaves browser |
| Fake job postings | Wallet signature required to post (v1.1) |
| Double spending | Stellar sequence numbers prevent replay |
| Sybil freelancers | Reputation system planned (v1.4) |
| Backend trust | Backend is stateless helper — all payments are on-chain |
