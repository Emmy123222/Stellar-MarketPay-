# Smart Contract API Reference

MarketPay is powered by a single Soroban smart contract (`MarketPayContract`) deployed on Stellar.
This is the authoritative reference for every public function, data type, storage key, and event.

> **Source:** `contracts/marketpay-contract/src/lib.rs`
> **Soroban SDK:** 22.0.0
> **Build target:** `wasm32-unknown-unknown` (release)

---

## Table of Contents

- [Data Types](#data-types)
- [Storage Keys](#storage-keys)
- [Events Reference](#events-reference)
- [Initialization](#initialization)
- [Escrow Lifecycle](#escrow-lifecycle)
- [Getters](#getters)
- [Governance (DAO)](#governance-dao)
- [Sealed-Bid Auction](#sealed-bid-auction)
- [Deliverable Oracle](#deliverable-oracle)
- [Job Certificates & Ratings](#job-certificates--ratings)
- [Dispute Arbitration](#dispute-arbitration)
- [Messaging — On-chain CID Notarization](#messaging--on-chain-cid-notarization)
- [Job Boost](#job-boost)
- [Admin & Versioning](#admin--versioning)
- [Error Reference](#error-reference)

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
}
```

---

### `Escrow`

| Field              | Type               | Description                                           |
|--------------------|--------------------|-------------------------------------------------------|
| `job_id`           | `String`           | Backend job UUID                                      |
| `client`           | `Address`          | Stellar address that locked the funds                 |
| `freelancer`       | `Address`          | Stellar address that will receive payment             |
| `token`            | `Address`          | SAC address for XLM or USDC payment token             |
| `amount`           | `i128`             | Total payment in smallest token units (stroops for XLM)|
| `status`           | `EscrowStatus`     | Current lifecycle state                               |
| `created_at`       | `u32`              | Ledger sequence number at creation                    |
| `timeout_ledger`   | `u32`              | Ledger sequence after which `timeout_refund()` opens  |
| `milestones`       | `Vec<Milestone>`   | Optional list of milestone sub-payments               |
| `referrer`         | `Option<Address>`  | Referrer receives 2% of released amount               |
| `deliverable_hash` | `Option<BytesN<32>>`| Expected SHA-256 hash of deliverable (oracle path)  |

---

### `Milestone`

| Field          | Type   | Description                           |
|----------------|--------|---------------------------------------|
| `amount`       | `i128` | Amount in stroops for this step       |
| `is_completed` | `bool` | Whether this milestone has been paid  |

---

### `CreateEscrowParams`

| Field             | Type                | Required | Description                               |
|-------------------|---------------------|----------|-------------------------------------------|
| `freelancer`      | `Address`           | Yes      | Recipient of released funds               |
| `token`           | `Address`           | Yes      | Payment token SAC address                 |
| `amount`          | `i128`              | Yes      | Total escrow amount (stroops)             |
| `milestones`      | `Option<Vec<i128>>` | No       | Per-milestone amounts; must sum to total  |
| `timeout_ledgers` | `Option<u32>`       | No       | Ledger timeout (default: 120,960 ≈ 7 days)|
| `referrer`        | `Option<Address>`   | No       | Referral bonus recipient (not client/freelancer) |

---

### `BidCommitment`

| Field                 | Type         | Description                                |
|-----------------------|--------------|--------------------------------------------|
| `job_id`              | `String`     | Associated job                             |
| `freelancer`          | `Address`    | Bidding freelancer                         |
| `commitment`          | `BytesN<32>` | `SHA-256(amount_bytes ∥ nonce)`            |
| `submitted_at_ledger` | `u32`        | Ledger when commitment was stored          |
| `bid_revealed`        | `bool`       | Whether the bid has been revealed          |

---

### `RevealedBid`

| Field                | Type      | Description                           |
|----------------------|-----------|---------------------------------------|
| `freelancer`         | `Address` | Bidder                                |
| `amount`             | `i128`    | Revealed bid amount in stroops        |
| `revealed_at_ledger` | `u32`     | Ledger sequence of reveal             |

---

### `BiddingState`

| Field                    | Type      | Description                                  |
|--------------------------|-----------|----------------------------------------------|
| `job_id`                 | `String`  | Associated job                               |
| `client`                 | `Address` | Job owner                                    |
| `is_closed`              | `bool`    | Whether the commit phase is over             |
| `closed_at_ledger`       | `u32`     | Ledger when `close_bidding` was called       |
| `reveal_deadline_ledger` | `u32`     | `closed_at_ledger + 1000` (~24h reveal window)|

---

### `BudgetCommitment`

| Field           | Type      | Description                              |
|-----------------|-----------|------------------------------------------|
| `job_id`        | `String`  | Associated job                           |
| `client`        | `Address` | Job owner                                |
| `budget_amount` | `i128`    | Client's committed budget in stroops     |
| `is_revealed`   | `bool`    | Whether the budget has been revealed     |

---

### `DeliverableSubmission`

| Field                       | Type     | Description                            |
|-----------------------------|----------|----------------------------------------|
| `job_id`                    | `String` | Associated job                         |
| `client_hash_submitted`     | `bool`   | Client has submitted their hash        |
| `freelancer_hash_submitted` | `bool`   | Freelancer has submitted their hash    |
| `hashes_match`              | `bool`   | Both hashes verified to match          |

---

### `Certificate`

| Field        | Type      | Description                             |
|--------------|-----------|-----------------------------------------|
| `job_id`     | `String`  | Associated job                          |
| `freelancer` | `Address` | Certificate recipient                   |
| `amount`     | `i128`    | Escrow amount at time of minting        |
| `created_at` | `u32`     | Ledger sequence at mint time            |

---

### `Rating`

| Field                | Type      | Description                              |
|----------------------|-----------|------------------------------------------|
| `job_id`             | `String`  | Associated job                           |
| `rater`              | `Address` | Who submitted the rating                 |
| `rated`              | `Address` | Who was rated                            |
| `score_out_of_5`     | `u32`     | Score 1–5                                |
| `submitted_at_ledger`| `u32`     | Ledger when rating was stored            |

---

### `Proposal` (Governance)

| Field             | Type      | Description                                  |
|-------------------|-----------|----------------------------------------------|
| `id`              | `u32`     | Sequential proposal ID (starts at 1)         |
| `title`           | `String`  | Short proposal title                         |
| `description`     | `String`  | Full proposal text                           |
| `votes_for`       | `u32`     | Count of approving votes                     |
| `votes_against`   | `u32`     | Count of rejecting votes                     |
| `deadline_ledger` | `u32`     | Voting closes at this ledger sequence        |
| `resolved`        | `bool`    | Whether the vote has been finalized          |
| `result`          | `bool`    | `true` = passed (`votes_for > votes_against`)|

---

### `ArbitrationCase`

| Field         | Type           | Description                              |
|---------------|----------------|------------------------------------------|
| `job_id`      | `String`       | Disputed job                             |
| `arbitrators` | `Vec<Address>` | 3 selected arbitrators                   |
| `votes`       | `Vec<u32>`     | Each arbitrator's `client_percent` (0–100)|
| `resolution`  | `u32`          | Median vote = client's share of funds    |
| `status`      | `u32`          | `0` = open, `1` = resolved               |

---

## Storage Keys

| Key                               | Value Type               | Description                               |
|-----------------------------------|--------------------------|-------------------------------------------|
| `Admin`                           | `Address`                | Contract administrator                    |
| `EscrowCount`                     | `u32`                    | Total escrows ever created                |
| `Escrow(job_id)`                  | `Escrow`                 | Escrow record per job                     |
| `TimeoutTimestamp(job_id)`        | `u32`                    | Unix timestamp for timeout eligibility    |
| `BudgetCommitment(job_id)`        | `BudgetCommitment`       | Sealed budget per job                     |
| `BidCommitment(job_id, address)`  | `BidCommitment`          | Sealed bid per freelancer per job         |
| `BiddingState(job_id)`            | `BiddingState`           | Bidding session state                     |
| `RevealedBids(job_id)`            | `Vec<RevealedBid>`       | All revealed bids for a job               |
| `DeliverableSubmission(job_id)`   | `DeliverableSubmission`  | Deliverable match state                   |
| `Certificate(job_id)`             | `Certificate`            | Completion certificate per job            |
| `FreelancerCertificates(address)` | `Vec<String>`            | All job IDs a freelancer has certs for    |
| `ClientRating(job_id)`            | `Rating`                 | Client-to-freelancer rating               |
| `FreelancerRating(job_id)`        | `Rating`                 | Freelancer-to-client rating               |
| `FreelancerRatingStats(address)`  | `FreelancerRatingStats`  | Rolling total_score + count               |
| `Proposal(id)`                    | `Proposal`               | Governance proposal by ID                 |
| `ProposalCount`                   | `u32`                    | Total proposals created                   |
| `HasVoted(address, proposal_id)`  | `bool`                   | Prevents double-voting                    |
| `CompletedJobs(address)`          | `u32`                    | Completed job count per address           |
| `DefaultTimeoutSeconds`           | `u32`                    | Global default escrow timeout in seconds  |
| `Arbitrator(address)`             | `bool`                   | Whether address is a registered arbitrator|
| `ArbitratorPool`                  | `Vec<Address>`           | All registered arbitrators                |
| `ArbitrationCase(case_id)`        | `ArbitrationCase`        | Arbitration case by ID                    |
| `ArbitrationCaseCount`            | `u32`                    | Total arbitration cases                   |
| `MessageCid(job_id)`              | `Vec<String>`            | IPFS CIDs for job thread messages         |
| `Version`                         | `u32`                    | Contract version (starts at 1)            |

---

## Events Reference

Events are emitted as `env.events().publish((topic_symbol, subtopic), data)`.

| Symbol      | Topic                        | Data                                                    | Emitted By                          |
|-------------|------------------------------|---------------------------------------------------------|-------------------------------------|
| `escrow_cr` | `(escrow_cr, job_id)`        | `(client, freelancer, amount)`                          | `create_escrow`                     |
| `work_strt` | `(work_strt, job_id)`        | `(client, freelancer)`                                  | `start_work`                        |
| `escrow_rl` | `(escrow_rl, job_id)`        | `(client, freelancer, freelancer_amount, referral_amount)` | `release_escrow`, `release_with_conversion` |
| `ref_bon`   | `(ref_bon, referrer)`        | `(job_id, bonus_amount)`                                | `release_escrow` with referrer      |
| `escrow_rf` | `(escrow_rf, job_id)`        | `(client, freelancer, amount)`                          | `refund_escrow`, `timeout_refund`   |
| `escrow_ds` | `(escrow_ds, job_id)`        | `(client, freelancer, caller)`                          | `raise_dispute`                     |
| `ms_rel`    | `(ms_rel, job_id)`           | `(client, freelancer, milestone_index, amount)`         | `partial_release`                   |
| `boosted`   | `(boosted, client)`          | `(job_id, expiry_ledger, amount)`                       | `boost_job`                         |
| `budgtcmt`  | `(budgtcmt, client)`         | `job_id`                                                | `commit_budget`                     |
| `budgrvld`  | `(budgrvld, client)`         | `budget_amount`                                         | `reveal_budget`                     |
| `bid_cmt`   | `(bid_cmt, job_id)`          | `freelancer`                                            | `submit_bid_commitment`             |
| `bid_cls`   | `(bid_cls, job_id)`          | `reveal_deadline_ledger`                                | `close_bidding`                     |
| `bid_rvl`   | `(bid_rvl, job_id)`          | `(freelancer, amount)`                                  | `reveal_bid`                        |
| `clthash`   | `(clthash, client)`          | `job_id`                                                | `submit_client_deliverable`         |
| `frelhash`  | `(frelhash, freelancer)`     | `job_id`                                                | `submit_freelancer_deliverable`     |
| `dlv_ok`    | `(dlv_ok, job_id)`           | `(caller, actual_hash)`                                 | `submit_deliverable` (hash match)   |
| `dlv_bad`   | `(dlv_bad, job_id)`          | `(caller, actual_hash)`                                 | `submit_deliverable` (hash mismatch)|
| `certmnt`   | `(certmnt, client)`          | `(job_id, amount)`                                      | `mint_certificate`                  |
| `msg_sent`  | `(msg_sent, job_id)`         | `(sender, recipient, ipfs_cid, ledger_seq)`             | `publish_message`                   |
| `proposed`  | `(proposed, proposer)`       | `(proposal_id, title, deadline_ledger)`                 | `create_proposal`                   |
| `voted`     | `(voted, voter)`             | `(proposal_id, approve)`                                | `cast_vote`                         |
| `resolved`  | `(resolved, proposal_id)`    | `(result, votes_for, votes_against)`                    | `resolve_proposal`                  |
| `arb_res`   | `(arb_res, case_id)`         | `resolution` (client_percent)                           | `resolve_arbitration`               |
| `upgraded`  | `(upgraded, admin)`          | `new_version`                                           | `upgrade`                           |
| `timeout`   | `(timeout, admin)`           | `timeout_seconds`                                       | `set_default_timeout_seconds`       |

---

## Initialization

### `initialize`

```rust
pub fn initialize(env: Env, admin: Address)
```

Must be called **once** immediately after deployment. Stores the admin address, sets the escrow counter to 0, sets the global timeout to 7 days (604,800 seconds), and sets `Version` to 1.

**Auth required:** None (open — call immediately to claim admin).
**Panics:** `"Already initialized"` if called again.

---

## Escrow Lifecycle

### State Machine

```
              create_escrow()
                    │
                    ▼
               ┌─────────┐
               │  Locked  │
               └─────────┘
              /           \
        start_work()    refund_escrow()
            /             or timeout_refund()
           ▼                    ▼
    ┌────────────┐       ┌──────────┐
    │ InProgress │       │ Refunded │  (terminal)
    └────────────┘       └──────────┘
         │  \
         │   raise_dispute()
         │         ▼
         │    ┌──────────┐
         │    │ Disputed │ ← partial_release() still works here
         │    └──────────┘
         │         │
    release_escrow() / partial_release() (all milestones done)
         ▼
    ┌──────────┐
    │ Released │  (terminal)
    └──────────┘
```

---

### `create_escrow`

```rust
pub fn create_escrow(env: Env, job_id: String, client: Address, params: CreateEscrowParams)
```

Transfers `params.amount` tokens from `client` into the contract and stores the escrow record. Status starts as `Locked`. Emits `escrow_cr`.

**Auth required:** `client`

| Panic message | Condition |
|---|---|
| `"Amount must be positive"` | `amount ≤ 0` |
| `"Referrer cannot be the client or freelancer"` | referrer == client or freelancer |
| `"Maximum 5 milestones allowed"` | more than 5 milestones provided |
| `"Milestone amount must be positive"` | any milestone ≤ 0 |
| `"Milestone amounts must sum to total escrow amount"` | sum of milestones ≠ `amount` |
| `"Escrow already exists for this job"` | duplicate `job_id` |

---

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

Same as `create_escrow` but stores a SHA-256 expected deliverable hash. Calling `submit_deliverable()` with a matching hash later auto-releases the escrow.

---

### `start_work`

```rust
pub fn start_work(env: Env, job_id: String, client: Address)
```

Transitions `Locked` → `InProgress`. Emits `work_strt`.

**Auth required:** `client`
**Panics:** `"Only the client can start work"`, `"Escrow is not in Locked state"`

---

### `release_escrow`

```rust
pub fn release_escrow(env: Env, job_id: String, client: Address)
```

Releases all remaining funds to the freelancer. Transitions to `Released`. Increments `CompletedJobs` for both parties. Emits `escrow_rl` and optionally `ref_bon`.

**Auth required:** `client`
**Precondition:** Status must be `InProgress` or `Locked`.

**Referral split (when `referrer` is set):**
- Referrer: `amount × 200 / 10_000` (2%)
- Freelancer: `amount − referral_amount` (98%)

---

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

Intended to route released funds through an on-chain DEX before delivery. Currently transfers the source token directly — DEX swap integration is planned (Issue #104). Emits `escrow_rl`.

**Auth required:** `client`

---

### `refund_escrow`

```rust
pub fn refund_escrow(env: Env, job_id: String, client: Address)
```

Returns all funds to the client. Only available before work has started (`Locked`). Emits `escrow_rf`.

**Auth required:** `client`
**Panics:** `"Can only refund before work has started"`

---

### `timeout_refund`

```rust
pub fn timeout_refund(env: Env, job_id: String, client: Address)
```

Client claims a refund if the freelancer never started work before the timeout expired. Checks the Unix timestamp stored at creation; falls back to ledger-sequence comparison for escrows created without a timestamp. Emits `escrow_rf`.

**Auth required:** `client`
**Panics:** `"Escrow is not in Locked state"`, `"Timeout period has not expired yet"`

---

### `partial_release`

```rust
pub fn partial_release(env: Env, job_id: String, milestone_index: u32, client: Address)
```

Releases a single milestone's funds to the freelancer. If this is the final incomplete milestone, the escrow transitions to `Released` and `CompletedJobs` is incremented for both parties. Works even when the escrow is `Disputed`. Emits `ms_rel`.

**Auth required:** `client`
**Precondition:** Status must be `InProgress`, `Locked`, or `Disputed`.
**Panics:** `"Invalid milestone index"`, `"Milestone already completed"`

---

### `raise_dispute`

```rust
pub fn raise_dispute(env: Env, job_id: String, caller: Address)
```

Either participant can raise a dispute. Transitions escrow to `Disputed`. Emits `escrow_ds`.

**Auth required:** `caller` (must be client or freelancer)
**Panics:** `"Only participants can raise a dispute"`, `"Cannot dispute a resolved escrow"`

---

## Getters

### `get_escrow`

```rust
pub fn get_escrow(env: Env, job_id: String) -> Escrow
```

Returns the full `Escrow` struct. Panics `"Escrow not found"` if none exists.

---

### `get_status`

```rust
pub fn get_status(env: Env, job_id: String) -> EscrowStatus
```

Returns the current `EscrowStatus` for the job.

---

### `get_timeout_ledger`

```rust
pub fn get_timeout_ledger(env: Env, job_id: String) -> u32
```

Returns the ledger sequence used by the legacy timeout path.

---

### `get_timeout_timestamp`

```rust
pub fn get_timeout_timestamp(env: Env, job_id: String) -> u32
```

Returns the Unix timestamp after which `timeout_refund()` becomes available. Returns `0` for escrows created without a stored timestamp.

---

### `get_referrer`

```rust
pub fn get_referrer(env: Env, job_id: String) -> Option<Address>
```

Returns the referrer address, or `None` if no referrer was set.

---

### `get_escrow_count`

```rust
pub fn get_escrow_count(env: Env) -> u32
```

Returns the total number of escrows ever created.

---

### `get_admin`

```rust
pub fn get_admin(env: Env) -> Address
```

Returns the current admin address.

---

### `get_default_timeout_seconds`

```rust
pub fn get_default_timeout_seconds(env: Env) -> u32
```

Returns the global default escrow timeout in seconds. Default is 604,800 (7 days).

---

### `set_default_timeout_seconds`

```rust
pub fn set_default_timeout_seconds(env: Env, admin: Address, timeout_seconds: u32)
```

Updates the global timeout applied to new escrows. Does not affect existing escrows. Emits `timeout`.

**Auth required:** `admin`
**Panics:** `"Timeout must be positive"` if `timeout_seconds == 0`

---

## Governance (DAO)

Users with at least one completed job may vote on governance proposals.

### `create_proposal`

```rust
pub fn create_proposal(
    env: Env,
    proposer: Address,
    title: String,
    description: String,
    duration_ledgers: u32,
) -> u32
```

Creates a new proposal. Returns the sequential proposal ID (starts at 1). Emits `proposed`.

**Auth required:** `proposer`
**Panics:** `"Duration must be positive"` if `duration_ledgers == 0`

---

### `cast_vote`

```rust
pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool)
```

Casts a for/against vote. Voter must have ≥ 1 completed job. One vote per address per proposal. Emits `voted`.

**Auth required:** `voter`

| Panic | Condition |
|---|---|
| `"Proposal already resolved"` | Vote after finalization |
| `"Voting period has ended"` | Ledger past `deadline_ledger` |
| `"Only users with completed jobs can vote"` | `CompletedJobs(voter) == 0` |
| `"Voter has already cast a vote"` | Duplicate vote |

---

### `resolve_proposal`

```rust
pub fn resolve_proposal(env: Env, proposal_id: u32)
```

Finalizes the proposal after the deadline. `result = votes_for > votes_against`. Emits `resolved`. Callable by anyone.

**Auth required:** None
**Panics:** `"Proposal already resolved"`, `"Voting period is not over yet"`

---

### `get_proposal`

```rust
pub fn get_proposal(env: Env, id: u32) -> Proposal
```

Returns a `Proposal` by ID.

---

### `list_active_proposals`

```rust
pub fn list_active_proposals(env: Env) -> Vec<Proposal>
```

Returns all proposals where `resolved == false`.

---

## Sealed-Bid Auction

Prevents anchoring bias by keeping bid amounts hidden until a reveal phase.

### Flow Overview

```
1. client → commit_budget(job_id, budget)
2. freelancers → submit_bid_commitment(job_id, SHA256(amount ∥ nonce))
3. client → close_bidding(job_id)             [opens 1000-ledger reveal window]
4. freelancers → reveal_bid(job_id, amount, nonce)
5. client selects winner off-chain, then → create_escrow()
```

---

### `commit_budget`

```rust
pub fn commit_budget(env: Env, job_id: String, budget_amount: i128, client: Address)
```

Client seals their budget on-chain. Hidden until `reveal_budget()`. Emits `budgtcmt`.

**Auth required:** `client`
**Panics:** `"Budget must be positive"` if `budget_amount ≤ 0`

---

### `reveal_budget`

```rust
pub fn reveal_budget(env: Env, job_id: String, client: Address)
```

Marks the budget as publicly visible. Emits `budgrvld` with `budget_amount`.

**Auth required:** `client`
**Panics:** `"Only the client can reveal the budget"`, `"Budget already revealed"`

---

### `submit_bid_commitment`

```rust
pub fn submit_bid_commitment(
    env: Env,
    job_id: String,
    freelancer: Address,
    commitment: BytesN<32>,
)
```

Freelancer submits `SHA-256(amount_bytes ∥ nonce)` as a sealed commitment. The nonce must be kept secret until reveal. Emits `bid_cmt`.

**Auth required:** `freelancer`
**Panics:** `"Budget commitment not found"`, `"Bidding is closed"`, `"Bid commitment already submitted"`

---

### `close_bidding`

```rust
pub fn close_bidding(env: Env, job_id: String, client: Address)
```

Client closes the commit phase and opens a ~24-hour reveal window (`REVEAL_WINDOW_LEDGERS = 1000`). Emits `bid_cls` with `reveal_deadline_ledger`.

**Auth required:** `client`

---

### `reveal_bid`

```rust
pub fn reveal_bid(
    env: Env,
    job_id: String,
    freelancer: Address,
    amount: i128,
    nonce: BytesN<32>,
)
```

Freelancer reveals their bid. The contract recomputes `SHA-256(amount ∥ nonce)` and verifies it against the stored commitment. On success, appends to `RevealedBids`. Emits `bid_rvl`.

**Commitment formula:**
```
commitment = SHA-256(amount.to_be_bytes() ∥ nonce_bytes)
```

**Auth required:** `freelancer`
**Panics:** `"Reveal window has closed"`, `"Bid already revealed"`, `"Commitment verification failed"`

---

### `get_bid_commitment`

```rust
pub fn get_bid_commitment(env: Env, job_id: String, freelancer: Address) -> BidCommitment
```

Returns a freelancer's sealed bid record.

---

### `get_revealed_bids`

```rust
pub fn get_revealed_bids(env: Env, job_id: String) -> Vec<RevealedBid>
```

Returns all bids successfully revealed during the reveal window.

---

## Deliverable Oracle

Allows a pre-agreed SHA-256 hash to gate automatic escrow release.

---

### `submit_deliverable`

```rust
pub fn submit_deliverable(
    env: Env,
    job_id: String,
    actual_hash: BytesN<32>,
    caller: Address,
)
```

The freelancer or admin submits the actual deliverable hash. If it matches `deliverable_hash` stored in the escrow, `release_escrow_core()` is called automatically and `dlv_ok` is emitted. On mismatch, escrow enters `Disputed` and `dlv_bad` is emitted.

**Auth required:** `caller` (must be `freelancer` or `admin`)

---

### `submit_client_deliverable` / `submit_freelancer_deliverable`

```rust
pub fn submit_client_deliverable(env: Env, job_id: String, client: Address)
pub fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address)
```

Independent confirmation from each party that their deliverable hash has been submitted. Used as a two-of-two flow (alternative to the oracle path). Emits `clthash` / `frelhash`.

**Auth required:** `client` / `freelancer`

---

### `check_deliverable_match`

```rust
pub fn check_deliverable_match(env: Env, job_id: String) -> bool
```

Returns `true` if both parties have submitted their hashes and sets `hashes_match = true` in storage.

---

### `get_deliverable_submission`

```rust
pub fn get_deliverable_submission(env: Env, job_id: String) -> DeliverableSubmission
```

Returns the current deliverable submission status.

---

## Job Certificates & Ratings

### `mint_certificate`

```rust
pub fn mint_certificate(env: Env, job_id: String, client: Address)
```

Mints an on-chain completion certificate for the freelancer. Only available once the escrow is released; one certificate per job. Emits `certmnt`.

**Auth required:** `client`
**Panics:** `"Escrow must be released to mint certificate"`, `"Certificate already minted"`

---

### `get_certificate`

```rust
pub fn get_certificate(env: Env, job_id: String) -> Certificate
```

Returns the completion certificate for a job.

---

### `get_freelancer_certificates`

```rust
pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String>
```

Returns all job IDs for which the freelancer has received certificates.

---

### `submit_client_rating`

```rust
pub fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32)
```

Client rates the freelancer 1–5 after escrow release. One rating per job. Updates the freelancer's rolling rating average.

**Auth required:** `client`
**Panics:** `"Score must be between 1 and 5"`, `"Ratings are allowed only after escrow release"`, `"Client rating already submitted for this job"`

---

### `submit_freelancer_rating`

```rust
pub fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32)
```

Freelancer rates the client 1–5 after escrow release. One rating per job.

**Auth required:** `freelancer`

---

### `get_freelancer_rating_avg`

```rust
pub fn get_freelancer_rating_avg(env: Env, freelancer: Address) -> u32
```

Returns the integer floor average of all ratings the freelancer has received. Returns `0` if no ratings exist.

---

## Dispute Arbitration

Formal dispute resolution with a randomly selected 3-arbitrator panel.

### `register_arbitrator`

```rust
pub fn register_arbitrator(env: Env, admin: Address, arbitrator: Address)
```

Admin adds a trusted address to the arbitrator pool.

**Auth required:** `admin`

---

### `open_arbitration`

```rust
pub fn open_arbitration(env: Env, job_id: String, admin: Address) -> u32
```

Admin opens a formal arbitration case. Selects 3 arbitrators from the pool using `ledger_sequence % pool_size` as a deterministic (non-cryptographic) seed. Returns the `case_id`.

**Auth required:** `admin`
**Panics:** `"Need at least 3 registered arbitrators"`

---

### `cast_arbitration_vote`

```rust
pub fn cast_arbitration_vote(env: Env, case_id: u32, arbitrator: Address, client_percent: u32)
```

Each of the 3 selected arbitrators votes on what share (0–100%) of the escrowed funds should go to the client. The remainder goes to the freelancer.

**Auth required:** `arbitrator` (must be one of the 3 selected)
**Panics:** `"Client percent must be 0-100"`, `"Arbitration case is not open"`, `"Only selected arbitrators can vote"`, `"All votes already submitted"`

---

### `resolve_arbitration`

```rust
pub fn resolve_arbitration(env: Env, case_id: u32)
```

Finalizes the case once all 3 votes are in. The resolution is the **median** vote (drops the highest and lowest). Emits `arb_res`. Callable by anyone.

**Auth required:** None
**Panics:** `"Exactly 3 votes required"`

---

### `get_arbitration_case`

```rust
pub fn get_arbitration_case(env: Env, case_id: u32) -> ArbitrationCase
```

Returns the full arbitration case record.

---

## Messaging — On-chain CID Notarization

Messages are stored off-chain on IPFS. Only the content identifier (CID) is published on-chain for censorship resistance and verifiability.

### `publish_message`

```rust
pub fn publish_message(
    env: Env,
    job_id: String,
    sender: Address,
    recipient: Address,
    ipfs_cid: String,
)
```

Appends the IPFS CID to `MessageCid(job_id)` and emits `msg_sent`. Message content remains off-chain.

**Auth required:** `sender`
**Panics:** `"IPFS CID cannot be empty"`

---

### `get_message_cids`

```rust
pub fn get_message_cids(env: Env, job_id: String) -> Vec<String>
```

Returns all IPFS CIDs recorded on-chain for a job thread.

---

## Job Boost

### `boost_job`

```rust
pub fn boost_job(
    env: Env,
    job_id: String,
    client: Address,
    treasury: Address,
    token: Address,
    amount: i128,
)
```

Client pays XLM to `treasury` to promote a job listing in search results. Emits `boosted` with the expiry ledger.

**Auth required:** `client`

**Boost tiers** (1 XLM = 10,000,000 stroops):

| Minimum Payment | Ledger Duration | Approximate Duration |
|-----------------|-----------------|----------------------|
| 5 XLM (50,000,000 stroops) | 120,960 | 7 days |
| 15 XLM (150,000,000 stroops) | 518,400 | 30 days |

**Panics:** `"Boost amount must be positive"`, `"Minimum boost is 5 XLM"`

---

## Admin & Versioning

### `upgrade`

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

Replaces the contract WASM with a new version. All on-chain storage (escrows, proposals, ratings, etc.) is preserved — Soroban upgrades only replace the executable. Increments `Version`. Emits `upgraded`.

**Auth required:** `admin`
**Precondition:** The new WASM must be pre-uploaded via `stellar contract install`.

---

### `get_version`

```rust
pub fn get_version(env: Env) -> u32
```

Returns the current contract version (starts at 1, incremented on each `upgrade`).

---

## Error Reference

All errors are Soroban contract panics that revert the transaction with no state changes.

| Panic Message | Function(s) | Cause |
|---|---|---|
| `"Already initialized"` | `initialize` | Called more than once |
| `"Not initialized"` | most getters | `initialize` not called |
| `"Amount must be positive"` | `create_escrow` | `amount ≤ 0` |
| `"Referrer cannot be the client or freelancer"` | `create_escrow` | Invalid referrer address |
| `"Maximum 5 milestones allowed"` | `create_escrow` | More than 5 milestones |
| `"Milestone amount must be positive"` | `create_escrow` | Non-positive milestone amount |
| `"Milestone amounts must sum to total escrow amount"` | `create_escrow` | Milestone totals mismatch |
| `"Escrow already exists for this job"` | `create_escrow` | Duplicate `job_id` |
| `"Escrow not found"` | multiple | No escrow for the given `job_id` |
| `"Only the client can start work"` | `start_work` | Wrong auth address |
| `"Escrow is not in Locked state"` | `start_work`, `timeout_refund` | Wrong status |
| `"Only the client can release escrow"` | `release_escrow` | Wrong auth address |
| `"Cannot release escrow in current status"` | `release_*` | Not `InProgress` or `Locked` |
| `"Only the client can request a refund"` | `refund_escrow` | Wrong auth address |
| `"Can only refund before work has started"` | `refund_escrow` | Not in `Locked` state |
| `"Timeout period has not expired yet"` | `timeout_refund` | Called before timeout |
| `"Only the client can release a milestone"` | `partial_release` | Wrong auth address |
| `"Cannot release milestone in current status"` | `partial_release` | Wrong status |
| `"Invalid milestone index"` | `partial_release` | Index out of bounds |
| `"Milestone already completed"` | `partial_release` | Duplicate release |
| `"Only participants can raise a dispute"` | `raise_dispute` | Not client or freelancer |
| `"Cannot dispute a resolved escrow"` | `raise_dispute` | Already `Released` or `Refunded` |
| `"Score must be between 1 and 5"` | `submit_*_rating` | Invalid score |
| `"Ratings are allowed only after escrow release"` | `submit_*_rating` | Not `Released` |
| `"Client rating already submitted for this job"` | `submit_client_rating` | Duplicate rating |
| `"Freelancer rating already submitted for this job"` | `submit_freelancer_rating` | Duplicate rating |
| `"Budget must be positive"` | `commit_budget` | `budget_amount ≤ 0` |
| `"Budget commitment not found"` | multiple | `commit_budget` not called first |
| `"Only the client can reveal the budget"` | `reveal_budget` | Wrong auth address |
| `"Budget already revealed"` | `reveal_budget` | Called twice |
| `"Bidding is closed"` | `submit_bid_commitment` | After `close_bidding` was called |
| `"Bid commitment already submitted"` | `submit_bid_commitment` | Duplicate per freelancer |
| `"Bidding not closed"` | `reveal_bid` | `close_bidding` not called yet |
| `"Reveal window has closed"` | `reveal_bid` | Ledger past `reveal_deadline_ledger` |
| `"Bid already revealed"` | `reveal_bid` | Duplicate reveal |
| `"Commitment verification failed"` | `reveal_bid` | Hash mismatch |
| `"Escrow must be released to mint certificate"` | `mint_certificate` | Not in `Released` state |
| `"Certificate already minted"` | `mint_certificate` | Duplicate mint |
| `"Only freelancer or oracle can submit deliverable"` | `submit_deliverable` | Wrong auth |
| `"Escrow has no deliverable hash"` | `submit_deliverable` | Used wrong `create_escrow` variant |
| `"Duration must be positive"` | `create_proposal` | `duration_ledgers == 0` |
| `"Proposal not found"` | proposal getters | Invalid proposal ID |
| `"Proposal already resolved"` | `cast_vote`, `resolve_proposal` | Already finalized |
| `"Voting period has ended"` | `cast_vote` | Past `deadline_ledger` |
| `"Only users with completed jobs can vote"` | `cast_vote` | No job history |
| `"Voter has already cast a vote"` | `cast_vote` | Double-vote |
| `"Voting period is not over yet"` | `resolve_proposal` | Before `deadline_ledger` |
| `"Only admin can update the timeout"` | `set_default_timeout_seconds` | Wrong auth |
| `"Timeout must be positive"` | `set_default_timeout_seconds` | Zero timeout |
| `"Only admin can register arbitrators"` | `register_arbitrator` | Wrong auth |
| `"Need at least 3 registered arbitrators"` | `open_arbitration` | Pool too small |
| `"Only admin can open arbitration"` | `open_arbitration` | Wrong auth |
| `"Arbitration case not found"` | arbitration getters | Invalid `case_id` |
| `"Arbitration case is not open"` | `cast_arbitration_vote` | Case already resolved |
| `"Only selected arbitrators can vote"` | `cast_arbitration_vote` | Not in the 3-person panel |
| `"All votes already submitted"` | `cast_arbitration_vote` | Panel already voted |
| `"Exactly 3 votes required"` | `resolve_arbitration` | Incomplete votes |
| `"Minimum boost is 5 XLM"` | `boost_job` | Payment below minimum |
| `"Boost amount must be positive"` | `boost_job` | `amount ≤ 0` |
| `"IPFS CID cannot be empty"` | `publish_message` | Empty CID string |

---

*For deployment instructions see [contract-deployment.md](./contract-deployment.md).*
*For the escrow database schema see [ADR-003-database-schema-escrow.md](./ADR-003-database-schema-escrow.md).*
