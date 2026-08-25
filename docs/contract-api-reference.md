# Smart Contract API Reference

MarketPay is powered by two Soroban smart contracts deployed on Stellar:

- **`MarketPayContract`** (`contracts/marketpay-contract/src/lib.rs`) — escrow, milestones, sealed-bid auctions, disputes/bonds, arbitration, governance, certificates, ratings, messaging.
- **`ArbitratorRegistry`** (`contracts/arbitrator-registry/src/lib.rs`) — staking-gated arbitrator registration used to source arbitrators for disputes.

This is the authoritative reference for every public entrypoint, data type, storage key, and event **currently implemented** in those two contracts.

> **Source:** `contracts/marketpay-contract/src/lib.rs`, `contracts/arbitrator-registry/src/lib.rs`
> **Soroban SDK:** 22.0.0
> **Build target:** `wasm32-unknown-unknown` (release)
> **Function count:** `MarketPayContract` exposes **71** public entrypoints; `ArbitratorRegistry` exposes **13**.

---

## Table of Contents

- [Data Types](#data-types)
- [Storage Keys](#storage-keys)
- [Events Reference](#events-reference)
- [Initialization & Versioning](#initialization--versioning)
- [Escrow Lifecycle](#escrow-lifecycle)
- [Escrow Getters](#escrow-getters)
- [Single Arbitrator (Legacy)](#single-arbitrator-legacy)
- [Admin, Treasury & Fee Configuration](#admin-treasury--fee-configuration)
- [Multi-Sig Admin & Freeze Governance](#multi-sig-admin--freeze-governance)
- [Escrow Timeout Extension](#escrow-timeout-extension)
- [On-Chain Message Notarization](#on-chain-message-notarization)
- [Governance (DAO Proposals)](#governance-dao-proposals)
- [Disputes & Dispute Bonds](#disputes--dispute-bonds)
- [Arbitration Cases](#arbitration-cases)
- [Milestones](#milestones)
- [Job Boost](#job-boost)
- [Sealed-Bid Budget Commitment](#sealed-bid-budget-commitment)
- [Sealed-Bid Freelancer Auctions](#sealed-bid-freelancer-auctions)
- [Deliverable Oracle](#deliverable-oracle)
- [Job Certificates & Dispute Evidence](#job-certificates--dispute-evidence)
- [Ratings](#ratings)
- [Error Reference](#error-reference)
- [Arbitrator Registry Contract](#arbitrator-registry-contract)

---

## Data Types

### `EscrowStatus`

```rust
enum EscrowStatus {
    Locked,      // Funds deposited; work not started
    InProgress,  // Freelancer accepted; work underway
    Released,    // Client approved; funds sent to freelancer
    Refunded,    // Client cancelled before start; funds returned
    Disputed,    // A participant raised a dispute
    Frozen,      // Reserved state value; the contract-wide freeze is a
                 // separate `Frozen` storage flag, not an EscrowStatus a
                 // given escrow transitions into via any public function.
}
```

---

### `Escrow`

| Field              | Type                 | Description                                           |
|--------------------|----------------------|-------------------------------------------------------|
| `job_id`           | `String`             | Backend job UUID                                      |
| `client`           | `Address`            | Stellar address that locked the funds                 |
| `freelancer`       | `Address`            | Stellar address that will receive payment              |
| `token`            | `Address`            | SAC address for XLM or USDC payment token              |
| `amount`           | `i128`               | Total payment in smallest token units (stroops for XLM)|
| `status`           | `EscrowStatus`       | Current lifecycle state                                |
| `created_at`       | `u32`                | Ledger sequence number at creation                     |
| `timeout_ledger`   | `u32`                | Ledger sequence after which `timeout_refund()` opens (legacy path) |
| `milestones`       | `Vec<Milestone>`     | Milestone list for partial releases (empty if none)     |
| `referrer`         | `Option<Address>`    | Referrer receives a bonus share of the released amount  |
| `deliverable_hash` | `Option<BytesN<32>>` | Expected SHA-256 hash of the deliverable (oracle path)   |

---

### `Milestone`

| Field          | Type      | Description                                          |
|----------------|-----------|-------------------------------------------------------|
| `id`           | `u32`     | Zero-based milestone identifier                       |
| `description`  | `String`  | Human-readable milestone name                         |
| `percentage`   | `u32`     | Share of total escrow (0–100); all must sum to 100    |
| `released`     | `bool`    | Whether this milestone has been paid out               |
| `rejected`     | `bool`    | Whether this milestone was rejected & refunded         |

### `MilestoneInput`

| Field          | Type     | Description                                        |
|----------------|----------|-----------------------------------------------------|
| `description`  | `String` | Human-readable milestone name                        |
| `percentage`   | `u32`    | Share of total escrow (0–100); all must sum to 100    |

---

### `CreateEscrowParams`

| Field             | Type                          | Required | Description                               |
|-------------------|-------------------------------|----------|--------------------------------------------|
| `freelancer`      | `Address`                     | Yes      | Recipient of released funds                |
| `token`           | `Address`                     | Yes      | Payment token SAC address                  |
| `amount`          | `i128`                        | Yes      | Total escrow amount (stroops)              |
| `milestones`      | `Option<Vec<MilestoneInput>>` | No       | Per-milestone descriptions & percentages; must sum to 100, max 5 |
| `timeout_ledgers` | `Option<u32>`                 | No       | Ledger timeout (default: 120,960 ≈ 7 days) |
| `referrer`        | `Option<Address>`             | No       | Referral bonus recipient (not client/freelancer) |

---

### `ExtensionRequest`

| Field                 | Type      | Description                                        |
|-----------------------|-----------|-----------------------------------------------------|
| `requested_by`        | `Address` | Which participant (client or freelancer) requested it |
| `new_timeout_ledger`  | `u32`     | The proposed later timeout ledger                    |
| `created_at`          | `u32`     | Ledger sequence when the request was made             |

---

### `DisputeBondConfig`

Global configuration set by the admin; when unset, `raise_dispute` runs in legacy zero-cost mode.

| Field    | Type      | Description                                  |
|----------|-----------|-----------------------------------------------|
| `token`  | `Address` | SAC token used for the dispute bond           |
| `amount` | `i128`    | Bond amount required to raise a dispute       |

### `DisputeBond`

Per-job snapshot of a locked bond, created when `raise_dispute` is called while a `DisputeBondConfig` is set.

| Field              | Type      | Description                                     |
|--------------------|-----------|---------------------------------------------------|
| `caller`           | `Address` | The participant who raised the dispute and posted the bond |
| `token`            | `Address` | Bond token (copied from `DisputeBondConfig` at raise-time) |
| `amount`           | `i128`    | Bond amount locked                                |
| `raised_at_ledger` | `u32`     | Ledger sequence when the bond was locked           |

### `ArbitrationCase`

| Field         | Type           | Description                                              |
|---------------|----------------|------------------------------------------------------------|
| `job_id`      | `String`       | Disputed job                                                |
| `arbitrators` | `Vec<Address>` | Selected arbitrators (expected: 3)                          |
| `votes`       | `Vec<u32>`     | Each arbitrator's `client_percent` vote (0–100)              |
| `resolution`  | `u32`          | Median of the 3 votes = client's share of funds              |
| `status`      | `u32`          | `0` = open, `1` = resolved                                   |

> **Note:** `resolve_arbitration(env, case_id)` is the only public entrypoint that operates on `ArbitrationCase` records in the current contract. There is **no public function that creates an `ArbitrationCase`, registers the 3 arbitrators against it, or lets them submit votes** — the corresponding error codes (`OnlyAdminRegisterArbitrators = 7007`, `Need3Arbitrators = 7008`, `OnlyAdminOpenArbitration = 7009`, `ArbitrationCaseNotOpen = 7011`, `OnlySelectedArbitrators = 7012`, `AllVotesSubmitted = 7013`) exist in `errors.rs` but are not wired to any `pub fn` yet. A case record must currently be written directly to contract storage (e.g. by a future admin-only entrypoint, or off-chain tooling during development) before `resolve_arbitration` can be called against it. Treat this as a known gap between the error surface and the implemented API — see also the separate [`ArbitratorRegistry`](#arbitrator-registry-contract) contract, which independently manages staked arbitrator membership but is not yet linked to `ArbitrationCase` creation.

### `DisputeCase`

Declared in `lib.rs` but **not referenced by any public or private function** — dead/reserved code as of this writing.

| Field         | Type           |
|---------------|----------------|
| `job_id`      | `String`       |
| `arbitrators` | `Vec<Address>` |
| `votes`       | `Vec<u32>`     |
| `voters`      | `Vec<Address>` |
| `resolution`  | `u32`          |
| `status`      | `u32`          |

### `RecurringEscrow`

Declared in `lib.rs` (retainer-style recurring payments) but **no public entrypoints operate on it yet** — reserved for a future feature.

| Field                  | Type            |
|------------------------|-----------------|
| `job_id`               | `String`        |
| `client`                | `Address`       |
| `freelancer`            | `Address`       |
| `token`                 | `Address`       |
| `amount_per_release`    | `i128`          |
| `interval_ledgers`      | `u32`           |
| `releases_remaining`    | `u32`           |
| `last_release_ledger`   | `u32`           |
| `status`                | `EscrowStatus`  |

---

### `BidCommitment`

| Field                 | Type         | Description                                |
|-----------------------|--------------|----------------------------------------------|
| `job_id`              | `String`     | Associated job                                |
| `freelancer`          | `Address`    | Bidding freelancer                            |
| `commitment`          | `BytesN<32>` | `SHA-256(amount_be_bytes ∥ nonce)`             |
| `submitted_at_ledger` | `u32`        | Ledger when commitment was stored              |
| `bid_revealed`        | `bool`       | Whether the bid has been revealed              |

### `RevealedBid`

| Field                | Type      | Description                           |
|----------------------|-----------|-----------------------------------------|
| `freelancer`         | `Address` | Bidder                                  |
| `amount`             | `i128`    | Revealed bid amount in stroops          |
| `revealed_at_ledger` | `u32`     | Ledger sequence of reveal               |

### `BiddingState`

| Field                    | Type      | Description                                          |
|--------------------------|-----------|---------------------------------------------------------|
| `job_id`                 | `String`  | Associated job                                           |
| `client`                 | `Address` | Job owner                                                |
| `is_closed`              | `bool`    | Whether the commit phase is over                         |
| `closed_at_ledger`       | `u32`     | Ledger when `close_bidding` was called                    |
| `reveal_deadline_ledger` | `u32`     | `closed_at_ledger + REVEAL_WINDOW_LEDGERS` (17,280 ≈ 24h)  |

### `BudgetCommitment`

| Field           | Type      | Description                              |
|-----------------|-----------|---------------------------------------------|
| `job_id`        | `String`  | Associated job                               |
| `client`        | `Address` | Job owner                                    |
| `budget_amount` | `i128`    | Client's committed budget in stroops          |
| `is_revealed`   | `bool`    | Whether the budget has been revealed          |

### `DeliverableSubmission`

| Field                       | Type     | Description                            |
|-----------------------------|----------|-------------------------------------------|
| `job_id`                    | `String` | Associated job                             |
| `client_hash_submitted`     | `bool`   | Client has submitted their hash             |
| `freelancer_hash_submitted` | `bool`   | Freelancer has submitted their hash          |
| `hashes_match`              | `bool`   | Both hashes verified to match                |

### `Certificate`

Proof-of-work record minted to the freelancer once the escrow is released.

| Field        | Type      | Description                             |
|--------------|-----------|--------------------------------------------|
| `job_id`     | `String`  | Associated job                              |
| `title`      | `String`  | Job title (metadata)                         |
| `client`     | `Address` | Client who released the escrow               |
| `freelancer` | `Address` | Certificate recipient                         |
| `amount`     | `i128`    | Escrow amount at time of minting               |
| `created_at` | `u32`     | Ledger sequence at mint time                   |

### `Rating`

| Field                 | Type      | Description                              |
|-----------------------|-----------|----------------------------------------------|
| `job_id`              | `String`  | Associated job                                |
| `rater`               | `Address` | Who submitted the rating                       |
| `rated`               | `Address` | Who was rated                                  |
| `score_out_of_5`      | `u32`     | Score 1–5                                       |
| `submitted_at_ledger` | `u32`     | Ledger when rating was stored                    |

### `FreelancerRatingStats`

| Field         | Type  | Description                                     |
|---------------|-------|---------------------------------------------------|
| `total_score` | `u32` | Sum of all `score_out_of_5` values received         |
| `count`       | `u32` | Number of ratings received (average = total/count)  |

### `Proposal` (Governance)

| Field             | Type      | Description                                  |
|-------------------|-----------|-------------------------------------------------|
| `id`              | `u32`     | Sequential proposal ID (starts at 1)              |
| `title`           | `String`  | Short proposal title                               |
| `description`     | `String`  | Full proposal text                                  |
| `votes_for`       | `u32`     | Count of approving votes                             |
| `votes_against`   | `u32`     | Count of rejecting votes                              |
| `deadline_ledger` | `u32`     | Voting closes at this ledger sequence                  |
| `resolved`        | `bool`    | Whether the vote has been finalized                     |
| `result`          | `bool`    | `true` = passed (`votes_for > votes_against`)             |

---

## Storage Keys

`DataKey` enum variants used as instance-storage keys in `MarketPayContract`:

| Key                                 | Value Type               | Description                                  |
|--------------------------------------|---------------------------|-------------------------------------------------|
| `Admin`                              | `Address`                 | Legacy single-admin field                        |
| `Admins`                             | `Vec<Address>`             | Multi-sig admin list                              |
| `UnfreezeThreshold`                  | `u32`                      | M-of-N admin signatures required to unfreeze        |
| `Frozen`                             | `bool`                     | Global freeze flag                                   |
| `EscrowCount`                        | `u32`                      | Total escrows ever created                            |
| `Escrow(job_id)`                     | `Escrow`                   | Escrow record per job                                  |
| `TimeoutTimestamp(job_id)`           | `u32`                      | Unix timestamp for timeout eligibility                  |
| `DefaultTimeoutSeconds`              | `u32`                      | Global default escrow timeout in seconds                 |
| `ExtensionRequest(job_id)`           | `ExtensionRequest`         | Pending timeout extension request                          |
| `TreasuryAddress`                    | `Address`                  | Address receiving platform fees                              |
| `PlatformFeeBps`                     | `u32`                      | Platform fee in basis points (default 100 = 1%)                |
| `MaxReferrerBonusXlm`                | `Option<i128>`             | Admin-set cap on referrer bonus payouts (`None` = uncapped)      |
| `BudgetCommitment(job_id)`           | `BudgetCommitment`         | Sealed budget per job                                              |
| `BidCommitment(job_id, address)`     | `BidCommitment`            | Sealed bid per freelancer per job                                   |
| `BiddingState(job_id)`               | `BiddingState`             | Bidding session state                                                |
| `RevealedBids(job_id)`               | `Vec<RevealedBid>`         | All revealed bids for a job                                           |
| `DeliverableSubmission(job_id)`      | `DeliverableSubmission`    | Deliverable match state (client/freelancer hash submission flags)      |
| `FreelancerDeliverableHash(job_id)`  | `BytesN<32>`               | Freelancer-submitted deliverable SHA-256                                 |
| `EvidenceCids(job_id)`               | `Vec<Bytes>`               | Dispute-evidence IPFS CID audit trail                                     |
| `Certificate(job_id)`                | `Certificate`              | Completion certificate per job                                             |
| `FreelancerCertificates(address)`    | `Vec<String>`              | All job IDs a freelancer holds certificates for                             |
| `ClientRating(job_id)`               | `Rating`                   | Client-to-freelancer rating                                                  |
| `FreelancerRating(job_id)`           | `Rating`                   | Freelancer-to-client rating                                                   |
| `FreelancerRatingStats(address)`     | `FreelancerRatingStats`    | Rolling total_score + count                                                     |
| `Proposal(id)`                       | `Proposal`                 | Governance proposal by ID                                                        |
| `ProposalCount`                      | `u32`                      | Total proposals created                                                           |
| `HasVoted(address, proposal_id)`     | `bool`                     | Prevents double-voting                                                             |
| `CompletedJobs(address)`             | `u32`                      | Completed job count per address (voting eligibility gate)                           |
| `DisputeBondConfig`                  | `DisputeBondConfig`        | Global dispute bond configuration                                                     |
| `DisputeBond(job_id)`                | `DisputeBond`              | Per-job locked dispute bond record                                                      |
| `Arbitrator(address)`                | `bool`                     | Whether `address` was ever set via `set_arbitrator` (legacy single-arbitrator model)      |
| `ArbitratorPool`                     | `Vec<Address>`             | Declared but not populated by any public entrypoint as of this writing                      |
| `ArbitratorAddress`                  | `Address`                  | The single arbitrator set by `set_arbitrator` / read by `get_arbitrator`                       |
| `ArbitrationCase(case_id)`           | `ArbitrationCase`          | Arbitration case by ID                                                                            |
| `ArbitrationCaseCount`               | `u32`                      | Declared; not incremented by any public entrypoint as of this writing (no case-creation fn)         |
| `DisputeCase(job_id)`                | `DisputeCase`              | Declared; unused (see `DisputeCase` in Data Types)                                                    |
| `MessageCid(job_id)`                 | `Vec<String>`              | IPFS CIDs for job thread messages                                                                       |
| `Version`                            | `u32`                      | Contract version, bumped by `upgrade()` (starts at 1)                                                     |

---

## Events Reference

Events are emitted as `env.events().publish((topic_symbol, subtopic), data)`. Only events actually present in `lib.rs` are listed — several administrative functions (`upgrade`, `set_arbitrator`, `set_default_timeout_seconds`, `add_admin`, `set_unfreeze_threshold`, `set_dispute_bond`) currently emit **no** event and are marked as such below.

| Symbol         | Topic                          | Data                                                                    | Emitted By                                    |
|----------------|----------------------------------|----------------------------------------------------------------------------|--------------------------------------------------|
| `escrow_cr`    | `(escrow_cr, job_id)`             | `(client, freelancer, amount)`                                              | `create_escrow`, `create_escrow_with_deliverable`, `create_escrow_with_milestones` |
| `work_strt`    | `(work_strt, job_id)`             | `(client, freelancer)`                                                       | `start_work`                                       |
| `plat_fee`     | `(plat_fee, job_id)`              | `(treasury, fee_amount)`                                                      | `release_escrow`, `release_with_conversion`, `release_milestone` (when fee > 0) |
| `ref_bon`      | `(ref_bon, referrer)`             | `(job_id, bonus_amount)`                                                       | `release_escrow` (when a referrer bonus is paid)     |
| `escrow_rl`    | `(escrow_rl, job_id)`             | `(client, freelancer, freelancer_amount, referral_amount, fee_amount)`          | `release_escrow`, `release_with_conversion`, `submit_deliverable` (on hash match) |
| `escrow_rf`    | `(escrow_rf, job_id)`             | `(client, freelancer, amount)`                                                    | `refund_escrow`, `timeout_refund`                     |
| `set_fee`      | `(set_fee, admin)`                | `bps`                                                                              | `set_platform_fee_bps`                                 |
| `ref_cap`      | `(ref_cap, admin)`                | `cap`                                                                              | `set_max_referrer_bonus_xlm`                            |
| `frozen`       | `(frozen, admin)`                 | `true`                                                                             | `freeze_contract`                                        |
| `ext_req`      | `(ext_req, job_id)`               | `(caller, new_timeout_ledger)`                                                     | `request_extension`                                       |
| `ext_app`      | `(ext_app, job_id)`               | `(caller, requested_by, new_timeout_ledger)`                                        | `approve_extension`                                         |
| `msg_sent`     | `(msg_sent, job_id)`              | `(sender, recipient, ipfs_cid, ledger_seq)`                                          | `publish_message`                                            |
| `proposed`     | `(proposed, proposer)`            | `(proposal_id, title, deadline_ledger)`                                               | `create_proposal`                                              |
| `voted`        | `(voted, voter)`                  | `(proposal_id, approve)`                                                               | `cast_vote`                                                      |
| `resolved`     | `(resolved, proposal_id)`         | `(result, votes_for, votes_against)`                                                     | `resolve_proposal`                                                 |
| `bond_lck`     | `(bond_lck, job_id)`              | `(caller, token, amount)`                                                                 | `raise_dispute` (when a `DisputeBondConfig` is set)                   |
| `escrow_ds`    | `(escrow_ds, job_id)`             | `(client, freelancer, caller)`                                                              | `raise_dispute` (both bonded and legacy zero-cost paths)                 |
| `bond_rtn`     | `(bond_rtn, job_id)`              | `(caller, amount)`                                                                            | `resolve_dispute` (when the bond-poster wins)                              |
| `bond_slsh`    | `(bond_slsh, job_id)`             | `(winner, amount)`                                                                              | `resolve_dispute` (when the bond-poster loses)                               |
| `dsp_res`      | `(dsp_res, job_id)`               | `(arbitrator, winner, split_percentage, ...)`                                                     | `resolve_dispute`                                                               |
| `arb_rsl`      | `(arb_rsl, case_id)`              | `resolution`                                                                                        | `resolve_arbitration`                                                             |
| `milestone_released` | `(milestone_released, job_id)` | `(client, freelancer, milestone_id, amount)`                                                   | `release_milestone`                                                                  |
| `milestone_rejected` | `(milestone_rejected, job_id)` | `(client, freelancer, milestone_index, refund)`                                                | `reject_milestone`                                                                     |
| `boosted`      | `(boosted, client)`               | `(job_id, expiry_ledger, amount)`                                                                    | `boost_job`                                                                              |
| `budgtcmt`     | `(budgtcmt, client)`              | `job_id`                                                                                               | `commit_budget`                                                                            |
| `budgrvld`     | `(budgrvld, client)`              | `budget_amount`                                                                                        | `reveal_budget`                                                                              |
| `bid_cmt`      | `(bid_cmt, job_id)`               | `freelancer`                                                                                             | `submit_bid_commitment`                                                                        |
| `bid_cls`      | `(bid_cls, job_id)`               | `reveal_deadline_ledger`                                                                                  | `close_bidding`                                                                                  |
| `bid_rvl`      | `(bid_rvl, job_id)`               | `(freelancer, amount)`                                                                                    | `reveal_bid`                                                                                       |
| `evd_add`      | `(evd_add, job_id)`               | `(caller, ledger_seq)`                                                                                     | `submit_evidence_cid`                                                                                |

**No event emitted** by: `initialize`, `upgrade`, `get_version` (getter), `set_arbitrator`, `get_arbitrator` (getter), `set_treasury_address`, `set_default_timeout_seconds`, `unfreeze_contract`, `add_admin`, `set_unfreeze_threshold`, `set_dispute_bond`, `mint_certificate`, `submit_client_deliverable`, `submit_freelancer_deliverable`, `submit_deliverable_hash`, `submit_client_rating`, `submit_freelancer_rating`, and all read-only getters.

---

## Initialization & Versioning

### `initialize`

```rust
pub fn initialize(env: Env, admin: Address, treasury_address: Address)
```

Must be called **once** immediately after deployment. Stores the admin address and treasury address, sets the platform fee to 100 bps (1%), escrow counter to 0, default timeout to 7 days (604,800 seconds), unfreeze threshold to 2, admin list to `[admin]`, and `Version` to 1.

**Auth required:** None (open — call immediately after deploy to claim admin).
**Panics:** `"Already initialized"` if called again.

### `upgrade`

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

Admin-only. Deploys a new WASM implementation via `env.deployer().update_current_contract_wasm(new_wasm_hash)` and increments the stored `Version`. All existing contract storage (escrows, proposals, etc.) is preserved across the upgrade.

**Auth required:** admin (via `require_auth` on the stored admin address).
**Emits:** nothing.

### `get_version`

```rust
pub fn get_version(env: Env) -> u32
```

Returns the current contract version (starts at 1, incremented once per `upgrade()` call).

---

## Escrow Lifecycle

### State Machine

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
    ┌────────────┐          ┌──────────┐
    │ InProgress │          │ Refunded │  (terminal)
    └────────────┘          └──────────┘
         │  \
         │   raise_dispute()
         │         ▼
         │    ┌──────────┐
         │    │ Disputed │ ← release_milestone() / reject_milestone() still work here
         │    └──────────┘
         │         │
    release_escrow() / release_with_conversion()
    — or —
    submit_deliverable() on hash match
    — or —
    release_milestone() on the last remaining milestone
    — or —
    resolve_dispute() (arbitrator-only, from Disputed)
         ▼
    ┌──────────┐
    │ Released │  (terminal)
    └──────────┘
```

### `create_escrow`

```rust
pub fn create_escrow(env: Env, job_id: String, client: Address, params: CreateEscrowParams)
```

Transfers `params.amount` tokens from `client` into the contract and stores a new `Escrow` with status `Locked`. Emits `escrow_cr`.

**Auth required:** `client`

| Panic condition | Error |
|---|---|
| `amount ≤ 0` | `AmountMustBePositive (2001)` |
| `referrer == client` or `referrer == freelancer` | `InvalidReferrer (2002)` |
| duplicate `job_id` | `EscrowAlreadyExists (2003)` |
| more than 5 milestones | `MaxMilestones (3001)` |
| any milestone percentage ≤ 0 | `MilestonePercentagePositive (3002)` |
| milestone percentages don't sum to 100 | `MilestonePercentagesSum (3003)` |

### `create_escrow_with_deliverable`

```rust
pub fn create_escrow_with_deliverable(
    env: Env,
    job_id: String,
    client: Address,
    params: CreateEscrowParams,
    deliverable_hash: BytesN<32>,
)
```

Same as `create_escrow`, but also stores an expected SHA-256 `deliverable_hash` on the escrow. `release_escrow` will require a matching freelancer-submitted hash (via `submit_deliverable_hash`) before it will pay out. Emits `escrow_cr`.

**Auth required:** `client`

### `create_escrow_with_milestones`

```rust
pub fn create_escrow_with_milestones(env: Env, job_id: String, client: Address, params: CreateEscrowParams)
```

Identical code path to `create_escrow` — the distinct name documents intent for callers that are populating `params.milestones`. Milestone percentages must sum to 100 (max 5 milestones). Emits `escrow_cr`.

**Auth required:** `client`

### `start_work`

```rust
pub fn start_work(env: Env, job_id: String, freelancer: Address)
```

Transitions the escrow from `Locked` to `InProgress`. Emits `work_strt`.

**Auth required:** `freelancer` (must match `escrow.freelancer`)
**Panics:** `OnlyFreelancerCanStartWork (2005)`, `EscrowNotLocked (2006)`

### `release_escrow`

```rust
pub fn release_escrow(env: Env, job_id: String, client: Address)
```

Client-only release. If the escrow has an expected `deliverable_hash`, it must match the freelancer-submitted hash first (`DeliverableHashMismatch (2009)`). Pays the platform fee (`plat_fee` event) to the treasury, then a referrer bonus (`ref_bon` event) if a referrer is set — capped by `MaxReferrerBonusXlm` when configured, otherwise a flat 2% — then the remainder to the freelancer. Sets status `Released` and increments `CompletedJobs` for both client and freelancer (governance voting eligibility). Emits `escrow_rl`.

**Auth required:** `client`
**Panics:** `OnlyClientCanRelease (2007)`, `CannotReleaseStatus (2008)`, `DeliverableHashMismatch (2009)`

### `release_with_conversion`

```rust
pub fn release_with_conversion(
    env: Env,
    job_id: String,
    client: Address,
    _target_token: Address,
    _min_amount_out: i128,
)
```

Client-only release variant intended to support paying the freelancer out in a different asset via a DEX swap. **As currently implemented, the DEX swap is not wired up** — it transfers the escrow's original token directly, applying the platform fee but **not** the referrer bonus. The `_target_token` and `_min_amount_out` parameters are accepted but unused. Treat this entrypoint as a placeholder pending real cross-asset conversion support. Emits `escrow_rl`.

**Auth required:** `client`

### `refund_escrow`

```rust
pub fn refund_escrow(env: Env, job_id: String, client: Address)
```

Client-only. Only allowed while status is `Locked` (before `start_work`). Refunds the full amount to the client and sets status `Refunded`. Emits `escrow_rf`.

**Auth required:** `client`
**Panics:** `OnlyClientCanRefund (2010)`, `CanOnlyRefundLocked (2011)`

### `timeout_refund`

```rust
pub fn timeout_refund(env: Env, job_id: String, client: Address)
```

Client-only. Refunds the escrow if the timeout has elapsed while status is still `Locked`. Uses the Unix-timestamp timeout when set (current path), falling back to the legacy ledger-sequence timeout for older escrows. Emits `escrow_rf`.

**Auth required:** `client`
**Panics:** `OnlyClientCanTimeoutRefund (2012)`, `TimeoutNotExpired (2013)`

---

## Escrow Getters

All read-only, no auth required, no events emitted.

| Function | Signature | Returns | Description |
|---|---|---|---|
| `get_escrow` | `(env, job_id: String)` | `Escrow` | Full escrow record |
| `get_status` | `(env, job_id: String)` | `EscrowStatus` | Current status enum |
| `get_timeout_ledger` | `(env, job_id: String)` | `u32` | Legacy ledger-sequence timeout |
| `get_timeout_timestamp` | `(env, job_id: String)` | `u32` | Unix-timestamp timeout (0 if unset) |
| `get_milestone` | `(env, job_id: String, index: u32)` | `Milestone` | Single milestone by index; panics `InvalidMilestoneIndex (3006)` out of bounds |
| `is_frozen` | `(env)` | `bool` | Global freeze flag |
| `get_referrer` | `(env, job_id: String)` | `Option<Address>` | Referrer for a job's escrow, if any |
| `get_escrow_count` | `(env)` | `u32` | Total escrows ever created |
| `get_admin` | `(env)` | `Address` | The legacy single-admin field (distinct from the `Admins` multisig list) |
| `get_treasury_address` | `(env)` | `Address` | Platform fee recipient |
| `get_platform_fee_bps` | `(env)` | `u32` | Current platform fee in basis points |

---

## Single Arbitrator (Legacy)

A single-address arbitrator field used by `resolve_dispute`. Distinct from the separate [`ArbitratorRegistry`](#arbitrator-registry-contract) contract, which manages a staked pool of arbitrators but is not currently wired into dispute resolution.

| Function | Signature | Returns | Description |
|---|---|---|---|
| `set_arbitrator` | `(env, admin: Address, arbitrator: Address)` | `()` | Admin-only; sets the sole address allowed to call `resolve_dispute`. No event emitted. |
| `get_arbitrator` | `(env)` | `Option<Address>` | Currently configured arbitrator, if any |

---

## Admin, Treasury & Fee Configuration

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `set_treasury_address` | `(env, admin: Address, treasury_address: Address)` | `()` | admin | `OnlyAdminSetTreasury (1010)`. No event. |
| `set_platform_fee_bps` | `(env, admin: Address, bps: u32)` | `()` | admin | `bps` must be ≤ 1000 (10%) — `PlatformFeeExceedsMax (1012)`. Emits `set_fee`. |
| `get_default_timeout_seconds` | `(env)` | `u32` | — | Current global default escrow timeout |
| `set_default_timeout_seconds` | `(env, admin: Address, timeout_seconds: u32)` | `()` | admin | Must be > 0 — `TimeoutMustBePositive (1024)`. No event. |
| `get_max_referrer_bonus_xlm` | `(env)` | `Option<i128>` | — | `None` = uncapped legacy 2% behavior |
| `set_max_referrer_bonus_xlm` | `(env, admin: Address, cap: i128)` | `()` | admin | `cap ≥ 0` (0 disables referrer program) — `ReferrerCapNegative (1022)`. Emits `ref_cap`. |

---

## Multi-Sig Admin & Freeze Governance

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `freeze_contract` | `(env, admin: Address)` | `()` | any address in `Admins` | Blocks all state-mutating calls guarded by the internal `check_not_frozen` gate. Emits `frozen`. |
| `unfreeze_contract` | `(env, admins: Vec<Address>)` | `()` | ≥ `UnfreezeThreshold` distinct admins, each via `require_auth` | `InsufficientSignatures (1014)`, `NotAnAdmin (1015)`, `DuplicateAdminSignature (1016)`. No event. |
| `add_admin` | `(env, admin: Address, new_admin: Address)` | `()` | existing admin | `OnlyAdminCanAddAdmin (1017)`, `AlreadyAdmin (1018)`. No event. |
| `set_unfreeze_threshold` | `(env, admin: Address, threshold: u32)` | `()` | existing admin | Threshold must be between 1 and `admins.len()` — `InvalidThreshold (1020)`. No event. |
| `get_admins` | `(env)` | `Vec<Address>` | — | Full multisig admin list |
| `get_unfreeze_threshold` | `(env)` | `u32` | — | Current M-of-N threshold (default 2) |

---

## Escrow Timeout Extension

Mutual-consent extension of an escrow's timeout, requested by either participant and approved by the other.

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `request_extension` | `(env, job_id: String, caller: Address, new_timeout_ledger: u32)` | `()` | client or freelancer | Only while `Locked`/`InProgress`; one pending request per job — `ExtensionAlreadyPending (9006)`, `NewTimeoutMustBeLater (9005)`. Emits `ext_req`. |
| `approve_extension` | `(env, job_id: String, caller: Address)` | `()` | the *other* participant | `CannotApproveOwnExtension (9008)`, `NoPendingExtension (9007)`. Updates `timeout_ledger` and recalculates the Unix-timestamp timeout (~5s/ledger). Emits `ext_app`. |
| `get_extension_request` | `(env, job_id: String)` | `Option<ExtensionRequest>` | — | Pending extension request for a job, if any |

---

## On-Chain Message Notarization

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `publish_message` | `(env, job_id: String, sender: Address, recipient: Address, ipfs_cid: String)` | `()` | `sender` | Records an off-chain (IPFS-stored) message's CID on-chain, appended to a per-job list. Emits `msg_sent`. |
| `get_message_cids` | `(env, job_id: String)` | `Vec<String>` | — | All message CIDs recorded for a job |

---

## Governance (DAO Proposals)

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `create_proposal` | `(env, proposer: Address, title: String, description: String, duration_ledgers: u32)` | `u32` (proposal id) | `proposer` | `DurationPositive (6001)`. Emits `proposed`. |
| `cast_vote` | `(env, voter: Address, proposal_id: u32, approve: bool)` | `()` | `voter`, requires ≥ 1 completed job | `OnlyCompletedJobsCanVote (6005)`, `AlreadyVoted (6006)`, `VotingPeriodEnded (6004)`. Emits `voted`. |
| `resolve_proposal` | `(env, proposal_id: u32)` | `()` | anyone, after the deadline | `VotingNotOver (6007)`. Sets `resolved = true`, `result = votes_for > votes_against`. Emits `resolved`. |
| `get_proposal` | `(env, id: u32)` | `Proposal` | — | Full proposal record; `ProposalNotFound (6002)` |
| `list_active_proposals` | `(env)` | `Vec<Proposal>` | — | All proposals with `resolved == false` |

---

## Disputes & Dispute Bonds

### `raise_dispute`

```rust
pub fn raise_dispute(env: Env, job_id: String, caller: Address)
```

Client or freelancer only. Not allowed on `Released`/`Refunded`/`Frozen`/already-`Disputed` escrows (`CannotDisputeResolved (7002)`). If an admin has set a `DisputeBondConfig`, this call locks the configured bond amount from `caller` into the contract (transferred via the bond token's SAC), stores a `DisputeBond` snapshot, and emits `bond_lck`. Otherwise it runs in legacy zero-cost mode. Either path sets status `Disputed` and emits `escrow_ds`.

**Auth required:** `caller` (must be the escrow's client or freelancer) — `OnlyParticipantsCanDispute (7001)`

### `resolve_dispute`

```rust
pub fn resolve_dispute(env: Env, job_id: String, arbitrator: Address, winner: Address, split_percentage: u32)
```

**Arbitrator-only** — `arbitrator` must equal the address previously set via `set_arbitrator` (`OnlyAdminCanResolveDispute (7003)`). Escrow must be `Disputed` (`EscrowNotDisputed (7004)`). `split_percentage` (0–100) of the escrow amount goes to `winner`, the remainder to the other participant. If a `DisputeBond` was locked for this job: it's returned to the bond-poster (`bond_rtn`) if they are the `winner`, or slashed entirely to `winner` (`bond_slsh`) if the bond-poster lost — either way the bond record is consumed so a second call to `resolve_dispute` cannot re-settle it. Sets status `Released`. Emits `dsp_res` (plus `bond_rtn`/`bond_slsh` if a bond existed).

**Auth required:** `arbitrator`

### `set_dispute_bond`

```rust
pub fn set_dispute_bond(env: Env, admin: Address, token: Address, amount: i128)
```

Admin-only. Configures the global bond token/amount required to raise future disputes. `amount` must be > 0 (`BondAmountPositive (7006)`). No event.

**Auth required:** admin

### Getters

| Function | Signature | Returns | Description |
|---|---|---|---|
| `get_dispute_bond_config` | `(env)` | `(Option<Address>, i128)` | `(None, 0)` if unset (legacy zero-cost mode), else `(Some(token), amount)` |
| `get_dispute_bond` | `(env, job_id: String)` | `Option<DisputeBond>` | Per-job locked bond record, if any |

---

## Arbitration Cases

```rust
pub fn resolve_arbitration(env: Env, case_id: u32)
```

Resolves an `ArbitrationCase` by taking the **median of exactly 3 stored votes** (`case.votes`, each a `client_percent` 0–100) — computed as `sum - min - max`, so it's a true median rather than an average. Requires exactly 3 votes already present (`Exactly3VotesRequired (7014)`; case not found panics with `"Arbitration case not found"`). Sets `case.status = 1` and `case.resolution` to the median. Emits `arb_rsl`.

> As noted under [`ArbitrationCase`](#data-types) above, there is currently **no public entrypoint to create a case or submit the 3 votes** — this function only resolves a case whose `votes: Vec<u32>` already has exactly 3 entries via some other means. Docs and integrations should treat multi-arbitrator arbitration as **not yet fully wired up end-to-end** in this contract, distinct from the single-arbitrator `resolve_dispute` flow above, which is fully implemented.

**Auth required:** none enforced in code (any caller can trigger resolution once 3 votes exist) — contrast with `resolve_dispute`, which is arbitrator-gated.

---

## Milestones

### `release_milestone`

```rust
pub fn release_milestone(env: Env, job_id: String, milestone_id: u32, client: Address)
```

Client-only. Callable while escrow status is `InProgress`/`Locked`/`Disputed`. Finds the milestone by `id`, marks it released, pays out its percentage share of the escrow (minus platform fee — emits `plat_fee` when fee > 0) to the freelancer. If **all** milestones are now released or rejected, the escrow itself transitions to `Released` and `CompletedJobs` is incremented for both parties. Emits `milestone_released`.

**Auth required:** `client` — `OnlyClientCanReleaseMilestone (3004)`
**Panics:** `CannotReleaseMilestoneStatus (3005)`, `MilestoneAlreadyCompleted (3007)`, invalid id → `"Invalid milestone id"` (not in `errors.rs`'s canonical `error_code_from_panic` mapping — see [Error Reference](#error-reference) caveat)

### `reject_milestone`

```rust
pub fn reject_milestone(env: Env, job_id: String, milestone_index: u32, client: Address)
```

Client-only. Marks the milestone (by **index**, not `id`) rejected and refunds its percentage share to the client. If all milestones are resolved (released or rejected), the escrow transitions to `Released`. Emits `milestone_rejected`.

**Auth required:** `client`

---

## Job Boost

```rust
pub fn boost_job(env: Env, job_id: String, client: Address, treasury: Address, token: Address, amount: i128)
```

Client pays `amount` directly to `treasury` to boost a job listing's visibility (this is a direct payment, not related to the job's escrow). Minimum 5 XLM (50,000,000 stroops) buys a 7-day boost (120,960 ledgers); ≥ 15 XLM (150,000,000 stroops) buys a 30-day boost (518,400 ledgers). Emits `boosted` with the resulting expiry ledger.

**Auth required:** `client`
**Panics:** `MinimumBoost5Xlm (9001)`, `BoostAmountPositive (9002)`

---

## Sealed-Bid Budget Commitment

Lets a client commit to a job budget without immediately publishing it (Issue #108). This is a **procedural** seal (a flag), not a cryptographic commitment scheme — contrast with the freelancer bid commitments below, which are hash-based.

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `commit_budget` | `(env, job_id: String, budget_amount: i128, client: Address)` | `()` | `client` | `BudgetPositive (4001)`. Emits `budgtcmt`. |
| `reveal_budget` | `(env, job_id: String, client: Address)` | `()` | `client` | `BudgetCommitmentNotFound (4002)`, `OnlyClientCanRevealBudget (4003)`, `BudgetAlreadyRevealed (4004)`. Emits `budgrvld`. |
| `get_budget_commitment` | `(env, job_id: String)` | `BudgetCommitment` | — | Full commitment record |

---

## Sealed-Bid Freelancer Auctions

Cryptographic commit-reveal scheme for freelancer bids (Issue #338). A freelancer first submits `SHA-256(amount_be_bytes ∥ nonce)`, then reveals `amount` and `nonce` after bidding closes; the contract recomputes the hash and rejects mismatches.

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `submit_bid_commitment` | `(env, job_id: String, freelancer: Address, commitment: BytesN<32>)` | `()` | `freelancer` | Requires a prior `commit_budget` for the job. `BiddingClosed (4005)`, `BidCommitmentAlreadySubmitted (4006)`. Emits `bid_cmt`. |
| `close_bidding` | `(env, job_id: String, client: Address)` | `()` | `client` | Opens the reveal window: `REVEAL_WINDOW_LEDGERS` = 17,280 ledgers (~24h). Emits `bid_cls`. |
| `reveal_bid` | `(env, job_id: String, freelancer: Address, amount: i128, nonce: BytesN<32>)` | `()` | `freelancer` | Verifies `sha256(amount_be_bytes ‖ nonce) == commitment`. `BiddingNotClosed (4007)`, `RevealWindowClosed (4008)`, `BidAlreadyRevealed (4009)`, `CommitmentVerificationFailed (4010)`. Emits `bid_rvl`. |
| `get_bid_commitment` | `(env, job_id: String, freelancer: Address)` | `BidCommitment` | — | A freelancer's sealed commitment record |
| `get_revealed_bids` | `(env, job_id: String)` | `Vec<RevealedBid>` | — | All bids revealed for a job |

---

## Deliverable Oracle

Hash-based verification that client and freelancer agree the delivered work matches (Issue #105 and related).

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `submit_client_deliverable` | `(env, job_id: String)` | `()` | client (implicit — see source for exact auth) | Flags the client's side of a `DeliverableSubmission` as submitted. No event. |
| `submit_freelancer_deliverable` | `(env, job_id: String)` | `()` | freelancer (implicit) | Flags the freelancer's side of a `DeliverableSubmission` as submitted. No event. |
| `check_deliverable_match` | `(env, job_id: String)` | `bool` | — | If both hash-submitted flags are true, sets `hashes_match = true` and returns `true`, else `false` |
| `get_deliverable_submission` | `(env, job_id: String)` | `DeliverableSubmission` | — | Full submission-status record |
| `submit_deliverable_hash` | `(env, job_id: String, freelancer: Address, hash: BytesN<32>)` | `()` | `freelancer` | Stores the SHA-256 hash of completed work for later `release_escrow` verification; requires the escrow to have an expected `deliverable_hash` and be `Locked`/`InProgress`. `NoDeliverableHash (8002)`. No event. |
| `get_freelancer_deliverable_hash` | `(env, job_id: String)` | `Option<BytesN<32>>` | — | The freelancer-submitted hash, if any |
| `verify_deliverable_hash` | `(env, job_id: String)` | `bool` | — | `true` iff both the expected and submitted hashes exist and are equal |
| `submit_deliverable` | `(env, job_id: String, actual_hash: BytesN<32>, caller: Address)` | `()` | freelancer or admin (acting as oracle) — `OnlyFreelancerOrOracle (8001)` | Compares `actual_hash` to `escrow.deliverable_hash`. On match: auto-releases the escrow via the same internal path as `release_escrow` (emits `escrow_rl`). On mismatch: sets status `Disputed` (no dispute bond is locked via this path). |

---

## Job Certificates & Dispute Evidence

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `mint_certificate` | `(env, job_id: String, title: String, client: Address)` | `()` | client (must be the escrow's client) | Escrow must be `Released` — `EscrowMustBeReleased (5005)`. One per job — `CertificateAlreadyMinted (5006)`. Non-empty title required. Mints a `Certificate` to the freelancer. No event. |
| `get_certificate` | `(env, job_id: String)` | `Certificate` | — | Certificate record for a job |
| `get_freelancer_certificates` | `(env, freelancer: Address)` | `Vec<String>` | — | List of job IDs for which a freelancer holds certificates |
| `submit_evidence_cid` | `(env, job_id: String, cid: Bytes, caller: Address)` | `()` | client or freelancer | Not allowed on a `Refunded` escrow. Appends `cid` (raw IPFS CID bytes) to the job's append-only evidence audit trail. Emits `evd_add`. |
| `get_evidence_cids` | `(env, job_id: String)` | `Vec<Bytes>` | — | All evidence CIDs for a job, insertion order |

---

## Ratings

| Function | Signature | Returns | Auth | Notes |
|---|---|---|---|---|
| `submit_client_rating` | `(env, job_id: String, client: Address, score: u32)` | `()` | client | `score` 1–5 — `InvalidScore (5001)`. Updates the freelancer's aggregate `FreelancerRatingStats`. No event. |
| `submit_freelancer_rating` | `(env, job_id: String, freelancer: Address, score: u32)` | `()` | freelancer | `score` 1–5. Only after escrow `Released` — `RatingsOnlyAfterRelease (5002)`. One rating per job — `FreelancerRatingAlreadySubmitted (5004)`. Stores a `Rating` of the client by the freelancer. No event. |

> **Note:** `submit_client_rating`'s duplicate-submission protection (`RatingAlreadySubmitted (5003)`) and exact auth/status checks should be confirmed against the current `lib.rs` source before relying on them in a client integration — the two rating functions are not perfectly symmetric in the current implementation.

---

## Error Reference

`ContractError` (`contracts/marketpay-contract/src/errors.rs`), `#[repr(u32)]`, grouped by numeric prefix.

### 1xxx — Initialization & Admin

| Code | Name | Message |
|---|---|---|
| 1001 | `AlreadyInitialized` | Already initialized |
| 1002 | `NotInitialized` | Not initialized |
| 1003 | `ContractFrozen` | Contract is frozen |
| 1004 | `ContractNotFrozen` | Contract is not frozen |
| 1010 | `OnlyAdminSetTreasury` | Only admin can set treasury address |
| 1011 | `OnlyAdminSetFee` | Only admin can set platform fee |
| 1012 | `PlatformFeeExceedsMax` | Platform fee cannot exceed 10% (1000 bps) |
| 1013 | `OnlyAdminCanFreeze` | Only an admin can freeze the contract |
| 1014 | `InsufficientSignatures` | Insufficient admin signatures to unfreeze |
| 1015 | `NotAnAdmin` | One of the provided addresses is not an admin |
| 1016 | `DuplicateAdminSignature` | Duplicate admin in unfreeze signatures |
| 1017 | `OnlyAdminCanAddAdmin` | Only an admin can add new admins |
| 1018 | `AlreadyAdmin` | Address is already an admin |
| 1019 | `OnlyAdminUpdateThreshold` | Only an admin can update the threshold |
| 1020 | `InvalidThreshold` | Threshold must be between 1 and the number of admins |
| 1021 | `OnlyAdminSetReferrerCap` | Only admin can set the referrer bonus cap |
| 1022 | `ReferrerCapNegative` | Referrer bonus cap must be non-negative |
| 1023 | `OnlyAdminUpdateTimeout` | Only admin can update the timeout |
| 1024 | `TimeoutMustBePositive` | Timeout must be positive |

### 2xxx — Escrow Lifecycle

| Code | Name | Message |
|---|---|---|
| 2001 | `AmountMustBePositive` | Amount must be positive |
| 2002 | `InvalidReferrer` | Referrer cannot be the client or freelancer |
| 2003 | `EscrowAlreadyExists` | Escrow already exists for this job |
| 2004 | `EscrowNotFound` | Escrow not found |
| 2005 | `OnlyFreelancerCanStartWork` | Only the freelancer can start work |
| 2006 | `EscrowNotLocked` | Escrow is not in Locked state |
| 2007 | `OnlyClientCanRelease` | Only the client can release escrow |
| 2008 | `CannotReleaseStatus` | Cannot release escrow in current status |
| 2009 | `DeliverableHashMismatch` | Freelancer deliverable hash does not match or not submitted |
| 2010 | `OnlyClientCanRefund` | Only the client can refund |
| 2011 | `CanOnlyRefundLocked` | Can only refund before work has started |
| 2012 | `OnlyClientCanTimeoutRefund` | Only the client can request a timeout refund |
| 2013 | `TimeoutNotExpired` | Timeout period has not expired yet |

### 3xxx — Milestones

| Code | Name | Message |
|---|---|---|
| 3001 | `MaxMilestones` | Maximum 5 milestones allowed |
| 3002 | `MilestonePercentagePositive` | Milestone percentage must be positive |
| 3003 | `MilestonePercentagesSum` | Milestone percentages must sum to 100 |
| 3004 | `OnlyClientCanReleaseMilestone` | Only the client can release a milestone |
| 3005 | `CannotReleaseMilestoneStatus` | Cannot release milestone in current escrow status |
| 3006 | `InvalidMilestoneIndex` | Invalid milestone index / Milestone index out of bounds |
| 3007 | `MilestoneAlreadyCompleted` | Milestone already completed |

### 4xxx — Bidding & Sealed-Bid Auction

| Code | Name | Message |
|---|---|---|
| 4001 | `BudgetPositive` | Budget amount must be positive |
| 4002 | `BudgetCommitmentNotFound` | Budget commitment not found |
| 4003 | `OnlyClientCanRevealBudget` | Only the client can reveal the budget |
| 4004 | `BudgetAlreadyRevealed` | Budget already revealed |
| 4005 | `BiddingClosed` | Bidding is closed |
| 4006 | `BidCommitmentAlreadySubmitted` | Bid commitment already submitted |
| 4007 | `BiddingNotClosed` | Bidding is not closed |
| 4008 | `RevealWindowClosed` | Reveal window has closed |
| 4009 | `BidAlreadyRevealed` | Bid already revealed |
| 4010 | `CommitmentVerificationFailed` | Commitment verification failed |

### 5xxx — Ratings & Certificates

| Code | Name | Message |
|---|---|---|
| 5001 | `InvalidScore` | Score must be between 1 and 5 |
| 5002 | `RatingsOnlyAfterRelease` | Ratings can only be submitted after escrow release |
| 5003 | `RatingAlreadySubmitted` | Client rating already submitted for this job |
| 5004 | `FreelancerRatingAlreadySubmitted` | Freelancer rating already submitted for this job |
| 5005 | `EscrowMustBeReleased` | Escrow must be released to mint certificate |
| 5006 | `CertificateAlreadyMinted` | Certificate already minted for this job |

### 6xxx — Governance (DAO)

| Code | Name | Message |
|---|---|---|
| 6001 | `DurationPositive` | Voting duration must be positive |
| 6002 | `ProposalNotFound` | Proposal not found |
| 6003 | `ProposalAlreadyResolved` | Proposal already resolved |
| 6004 | `VotingPeriodEnded` | Voting period has ended |
| 6005 | `OnlyCompletedJobsCanVote` | Only addresses with completed jobs can vote |
| 6006 | `AlreadyVoted` | Already voted on this proposal |
| 6007 | `VotingNotOver` | Voting period is not over yet |

### 7xxx — Disputes & Arbitration

| Code | Name | Message | Wired to a public fn? |
|---|---|---|---|
| 7001 | `OnlyParticipantsCanDispute` | Only escrow participants can raise a dispute | Yes — `raise_dispute` |
| 7002 | `CannotDisputeResolved` | Cannot dispute a resolved, frozen, or already-disputed escrow | Yes — `raise_dispute` |
| 7003 | `OnlyAdminCanResolveDispute` | Only the arbitrator can resolve a dispute | Yes — `resolve_dispute` |
| 7004 | `EscrowNotDisputed` | Escrow is not in Disputed state | Yes — `resolve_dispute` |
| 7005 | `OnlyAdminUpdateDisputeBond` | Only admin can update the dispute bond | Yes — `set_dispute_bond` |
| 7006 | `BondAmountPositive` | Bond amount must be positive | Yes — `set_dispute_bond` |
| 7007 | `OnlyAdminRegisterArbitrators` | Only admin can register arbitrators | **No** — no matching entrypoint exists yet |
| 7008 | `Need3Arbitrators` | Need at least 3 registered arbitrators | **No** |
| 7009 | `OnlyAdminOpenArbitration` | Only admin can open an arbitration case | **No** |
| 7010 | `ArbitrationCaseNotFound` | Arbitration case not found | Yes — `resolve_arbitration` |
| 7011 | `ArbitrationCaseNotOpen` | Arbitration case is not open | **No** |
| 7012 | `OnlySelectedArbitrators` | Only a selected arbitrator can vote | **No** |
| 7013 | `AllVotesSubmitted` | All votes already submitted | **No** |
| 7014 | `Exactly3VotesRequired` | Exactly 3 arbitrator votes are required | Yes — `resolve_arbitration` |

### 8xxx — Deliverable Oracle & Messaging

| Code | Name | Message |
|---|---|---|
| 8001 | `OnlyFreelancerOrOracle` | Only the freelancer or an oracle-authorized admin can submit the deliverable |
| 8002 | `NoDeliverableHash` | Escrow has no deliverable hash |
| 8003 | `IpfsCidEmpty` | IPFS CID cannot be empty |

### 9xxx — Job Boost & Extensions

| Code | Name | Message |
|---|---|---|
| 9001 | `MinimumBoost5Xlm` | Minimum boost is 5 XLM |
| 9002 | `BoostAmountPositive` | Boost amount must be positive |
| 9003 | `OnlyParticipantsCanExtend` | Only escrow participants can request an extension |
| 9004 | `CannotExtendStatus` | Cannot extend timeout in current status |
| 9005 | `NewTimeoutMustBeLater` | New timeout must be later than the current one |
| 9006 | `ExtensionAlreadyPending` | An extension request is already pending |
| 9007 | `NoPendingExtension` | No pending extension request |
| 9008 | `CannotApproveOwnExtension` | Cannot approve your own extension request |
| 9009 | `OnlyParticipantsCanApprove` | Only escrow participants can approve an extension |

### 99xx — Arithmetic & System

| Code | Name | Message |
|---|---|---|
| 9901 | `ArithmeticOverflow` | Arithmetic overflow |
| 9902 | `CounterOverflow` | Counter overflow |
| 9903 | `TimeoutLedgerOverflow` | Timeout ledger overflow |
| 9904 | `TimeoutTimestampOverflow` | Timeout timestamp overflow |

### Reverse mapping caveat

`errors.rs` exposes `ContractError::panic_message()`, `ContractError::code()`, and a free function `error_code_from_panic(msg: &str) -> Option<u32>` that maps Soroban panic/`HostError` strings (including `Error(Contract, #N)` and `Error(Contract, #N): <msg>` formats) back to numeric codes for frontend error handling. **This mapping is not fully synchronized with every `panic!()` call site in `lib.rs`.** Several panic strings used in the wild do not appear in `error_code_from_panic`'s match arms, including (non-exhaustive): `resolve_dispute`'s `"Only the arbitrator can resolve a dispute"` and `"Winner must be the client or the freelancer"`; `mint_certificate`'s `"Only the escrow client can mint the certificate"` and `"Certificate title cannot be empty"`; and assorted milestone/rating/evidence panics such as `"Invalid milestone id"`, `"Milestone already released"`, `"Milestone already rejected"`, `"Only participants can record evidence"`, `"Cannot record evidence on a refunded escrow"`. Frontend code that relies on `error_code_from_panic` to classify a failed transaction should fall back to matching on the raw panic string for these cases until the mapping is completed.

---

## Arbitrator Registry Contract

`contracts/arbitrator-registry/src/lib.rs` — `ArbitratorRegistry`. A **separate, independently deployed** contract that manages a staking-gated pool of arbitrators. It is not currently invoked by `MarketPayContract`'s dispute/arbitration flow (see the [Arbitration Cases](#arbitration-cases) caveat above) — as of this writing the two contracts are not linked on-chain; any connection between "is a registered arbitrator here" and "is allowed to call `resolve_dispute` on the escrow contract" is enforced off-chain/administratively via `set_arbitrator`.

| Function | Signature | Returns | Auth | Description |
|---|---|---|---|---|
| `initialize` | `(env, admin: Address, token: Address, min_stake: i128)` | `()` | none (one-time) | `token` is the SAC used for staking. If `min_stake ≤ 0`, defaults to 100,000,000 stroops (10 XLM). |
| `set_minimum_stake` | `(env, admin: Address, min_stake: i128)` | `()` | admin | `min_stake` must be > 0 |
| `register` | `(env, caller: Address, metadata_uri: String)` | `()` | `caller` | Stakes `min_stake` tokens (transferred from caller to contract), added to the active arbitrator list with `metadata_uri` (e.g. an IPFS profile URI). Panics if already registered. |
| `deregister` | `(env, caller: Address)` | `()` | `caller` | Refunds the caller's staked amount, marks inactive, removes from the active list |
| `remove_arbitrator` | `(env, admin: Address, arbitrator: Address)` | `()` | admin | Force-removal; refunds stake to the arbitrator, marks inactive |
| `dao_register_arbitrator` | `(env, admin: Address, arbitrator: Address, metadata_uri: String)` | `()` | admin (DAO-multisig) | Registers `arbitrator` with stake transferred **from `admin`** (i.e. DAO treasury) rather than the arbitrator — bridges an off-chain DAO vote to on-chain registration |
| `dao_remove_arbitrator` | `(env, admin: Address, arbitrator: Address)` | `()` | admin | DAO-triggered removal; stake is returned **to `admin`** (DAO treasury) as a penalty, not to the arbitrator |
| `get_arbitrators` | `(env)` | `Vec<Address>` | — | All currently active arbitrator addresses |
| `get_arbitrator_count` | `(env)` | `u32` | — | Count of active arbitrators |
| `get_arbitrator` | `(env, address: Address)` | `ArbitratorInfo` | — | Detailed info for one arbitrator; panics "Not registered" if absent |
| `is_arbitrator` | `(env, address: Address)` | `bool` | — | Whether `address` is currently active |
| `get_minimum_stake` | `(env)` | `i128` | — | Current minimum stake required to register |
| `get_token` | `(env)` | `Address` | — | The SAC token address used for staking |
| `get_admin` | `(env)` | `Address` | — | Contract admin address |

### `ArbitratorInfo`

| Field            | Type      | Description                                  |
|-------------------|-----------|-------------------------------------------------|
| `active`          | `bool`    | Whether the arbitrator is currently active        |
| `staked_amount`   | `i128`    | Amount currently staked                             |
| `metadata_uri`    | `String`  | Off-chain profile URI (e.g. IPFS)                     |
| `registered_at`   | `u32`     | Ledger sequence at registration                        |

Constant: `DEFAULT_MIN_STAKE: i128 = 100_000_000` (10 XLM in stroops).

---

**Last Updated**: 2026-08-24
