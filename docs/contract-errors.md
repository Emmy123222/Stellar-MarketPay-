# Contract Error Reference

Canonical list of every Soroban contract error code, its numeric identifier,
the corresponding `panic!` message, and a human-readable description.

> **Source (codes):** `contracts/marketpay-contract/src/errors.rs`
> **Source (frontend messages):** `frontend/lib/contractErrors.ts`
> **Last updated:** 2026-07-28

---

## Error Code Ranges

| Range   | Category                    |
|---------|-----------------------------|
| 1xxx    | Initialization & admin      |
| 2xxx    | Escrow lifecycle            |
| 3xxx    | Milestones                  |
| 4xxx    | Bidding & sealed-bid auction|
| 5xxx    | Ratings & certificates      |
| 6xxx    | Governance (DAO) & proposals|
| 7xxx    | Disputes & arbitration      |
| 8xxx    | Deliverable oracle & messaging|
| 9xxx    | Job boost & extensions      |
| 99xx    | Arithmetic & system         |

---

## 1xxx — Initialization & Admin

| Code | Panic Message                                          | Description                                          |
|------|--------------------------------------------------------|------------------------------------------------------|
| 1001 | `Already initialized`                                  | `initialize()` called more than once                 |
| 1002 | `Not initialized`                                      | Contract accessed before `initialize()`              |
| 1003 | `Contract is frozen`                                   | All mutating operations blocked by admin freeze      |
| 1004 | `Contract is not frozen`                               | `unfreeze_contract()` called when not frozen         |
| 1010 | `Only admin can set treasury address`                  | Non-admin called `set_treasury_address()`            |
| 1011 | `Only admin can set platform fee`                      | Non-admin called `set_platform_fee_bps()`            |
| 1012 | `Platform fee cannot exceed 10% (1000 bps)`            | Fee > 1000 bps                                       |
| 1013 | `Only an admin can freeze the contract`                | Non-admin called `freeze_contract()`                 |
| 1014 | `Insufficient admin signatures to unfreeze`            | Fewer than threshold admins in `unfreeze_contract()` |
| 1015 | `One of the provided addresses is not an admin`        | Address in `admins` not in stored admin list         |
| 1016 | `Duplicate admin in unfreeze signatures`               | Same admin appears twice in `unfreeze_contract()`    |
| 1017 | `Only an admin can add new admins`                     | Non-admin called `add_admin()`                       |
| 1018 | `Address is already an admin`                          | Attempted to add duplicate admin                     |
| 1019 | `Only an admin can update the threshold`               | Non-admin called `set_unfreeze_threshold()`          |
| 1020 | `Threshold must be between 1 and the number of admins` | Invalid threshold value                              |
| 1021 | `Only admin can set the referrer bonus cap`            | Non-admin called `set_max_referrer_bonus_xlm()`      |
| 1022 | `Referrer bonus cap must be non-negative`              | Negative cap value                                   |
| 1023 | `Only admin can update the timeout`                    | Non-admin called `set_default_timeout_seconds()`     |
| 1024 | `Timeout must be positive`                             | `timeout_seconds == 0`                               |

---

## 2xxx — Escrow Lifecycle

| Code | Panic Message                                                | Description                                       |
|------|--------------------------------------------------------------|---------------------------------------------------|
| 2001 | `Amount must be positive`                                    | `amount <= 0` in `create_escrow()`                |
| 2002 | `Referrer cannot be the client or freelancer`                | Referrer == client or freelancer                  |
| 2003 | `Escrow already exists for this job`                         | Duplicate `job_id` in escrow creation             |
| 2004 | `Escrow not found`                                           | No escrow stored for the given `job_id`           |
| 2005 | `Only the freelancer can start work`                         | Wrong address called `start_work()`               |
| 2006 | `Escrow is not in Locked state`                              | `start_work()` or `timeout_refund()` on wrong state|
| 2007 | `Only the client can release escrow`                         | Wrong address called `release_escrow()`           |
| 2008 | `Cannot release escrow in current status`                    | Escrow not in `Locked` or `InProgress`            |
| 2009 | `Freelancer deliverable hash does not match or not submitted`| Deliverable hash mismatch on release              |
| 2010 | `Only the client can request a refund`                       | Wrong address called `refund_escrow()`            |
| 2011 | `Can only refund before work has started`                    | Escrow not in `Locked` state                      |
| 2012 | `Only the client can request a timeout refund`               | Wrong address called `timeout_refund()`           |
| 2013 | `Timeout period has not expired yet`                         | Called before timeout timestamp/ledger            |

---

## 3xxx — Milestones

| Code | Panic Message                            | Description                                  |
|------|------------------------------------------|----------------------------------------------|
| 3001 | `Maximum 5 milestones allowed`           | > 5 milestones in `create_escrow()`          |
| 3002 | `Milestone percentage must be positive`  | Any milestone `percentage == 0`              |
| 3003 | `Milestone percentages must sum to 100`  | Percentages total ≠ 100                      |
| 3004 | `Only the client can release a milestone`| Wrong address called `release_milestone()`   |
| 3005 | `Cannot release milestone in current status`| Wrong escrow state for milestone release |
| 3006 | `Milestone index out of bounds`          | `index >= milestones.len()`                  |
| 3007 | `Milestone already completed`            | Already-released milestone                   |

---

## 4xxx — Bidding & Sealed-Bid Auction

| Code | Panic Message                         | Description                                    |
|------|---------------------------------------|------------------------------------------------|
| 4001 | `Budget must be positive`             | `budget_amount <= 0` in `commit_budget()`      |
| 4002 | `Budget commitment not found`         | `commit_budget()` not called first             |
| 4003 | `Only the client can reveal the budget`| Wrong auth for `reveal_budget()`              |
| 4004 | `Budget already revealed`             | Called `reveal_budget()` twice                 |
| 4005 | `Bidding is closed`                   | `close_bidding()` already called               |
| 4006 | `Bid commitment already submitted`    | Duplicate per freelancer                       |
| 4007 | `Bidding not closed`                  | `reveal_bid()` before `close_bidding()`        |
| 4008 | `Reveal window has closed`            | Ledger past `reveal_deadline_ledger`           |
| 4009 | `Bid already revealed`                | Duplicate `reveal_bid()`                       |
| 4010 | `Commitment verification failed`      | SHA-256 of amount+nonce doesn't match          |

---

## 5xxx — Ratings & Certificates

| Code | Panic Message                                       | Description                                  |
|------|-----------------------------------------------------|----------------------------------------------|
| 5001 | `Score must be between 1 and 5`                     | Invalid rating score                         |
| 5002 | `Ratings are allowed only after escrow release`     | Escrow not `Released`                        |
| 5003 | `Client rating already submitted for this job`      | Duplicate client rating                      |
| 5004 | `Freelancer rating already submitted for this job`  | Duplicate freelancer rating                  |
| 5005 | `Escrow must be released to mint certificate`       | Escrow not in `Released` state               |
| 5006 | `Certificate already minted`                        | Duplicate `mint_certificate()`               |

---

## 6xxx — Governance (DAO) & Proposals

| Code | Panic Message                                  | Description                               |
|------|------------------------------------------------|-------------------------------------------|
| 6001 | `Duration must be positive`                    | `duration_ledgers == 0`                   |
| 6002 | `Proposal not found`                           | Invalid proposal ID                       |
| 6003 | `Proposal already resolved`                    | Finalized proposal                        |
| 6004 | `Voting period has ended`                      | Past `deadline_ledger`                    |
| 6005 | `Only users with completed jobs can vote`      | `CompletedJobs(voter) == 0`               |
| 6006 | `Voter has already cast a vote`                | Double-vote                               |
| 6007 | `Voting period is not over yet`                | `resolve_proposal()` before deadline      |

---

## 7xxx — Disputes & Arbitration

| Code | Panic Message                                              | Description                                  |
|------|------------------------------------------------------------|----------------------------------------------|
| 7001 | `Only participants can raise a dispute`                    | Not client or freelancer                     |
| 7002 | `Cannot dispute a resolved, frozen, or already-disputed escrow`| Wrong escrow status                   |
| 7003 | `Only admin can resolve a dispute`                         | Non-admin called `resolve_dispute()`         |
| 7004 | `Escrow is not in Disputed state`                          | Wrong status for dispute resolution          |
| 7005 | `Only admin can update the dispute bond`                   | Non-admin called `set_dispute_bond()`        |
| 7006 | `Bond amount must be positive`                             | `amount <= 0`                                |
| 7007 | `Only admin can register arbitrators`                      | Non-admin called `register_arbitrator()`     |
| 7008 | `Need at least 3 registered arbitrators`                   | Pool too small                               |
| 7009 | `Only admin can open arbitration`                          | Non-admin called `open_arbitration()`        |
| 7010 | `Arbitration case not found`                               | Invalid `case_id`                            |
| 7011 | `Arbitration case is not open`                             | Case already resolved                        |
| 7012 | `Only selected arbitrators can vote`                       | Not in the 3-person panel                    |
| 7013 | `All votes already submitted`                              | Panel already voted                          |
| 7014 | `Exactly 3 votes required`                                 | Incomplete votes                             |

---

## 8xxx — Deliverable Oracle & Messaging

| Code | Panic Message                                        | Description                              |
|------|------------------------------------------------------|------------------------------------------|
| 8001 | `Only freelancer or oracle can submit deliverable`   | Wrong auth for `submit_deliverable()`    |
| 8002 | `Escrow has no deliverable hash`                     | Used wrong `create_escrow` variant       |
| 8003 | `IPFS CID cannot be empty`                           | Empty CID in `publish_message()`         |

---

## 9xxx — Job Boost & Extensions

| Code | Panic Message                                               | Description                               |
|------|-------------------------------------------------------------|-------------------------------------------|
| 9001 | `Minimum boost is 5 XLM`                                    | Payment below minimum                     |
| 9002 | `Boost amount must be positive`                             | `amount <= 0`                             |
| 9003 | `Only the client or freelancer can request an extension`    | Not a participant                         |
| 9004 | `Cannot extend timeout in current status`                   | Wrong escrow state                        |
| 9005 | `New timeout must be later than current timeout`            | New <= current timeout                    |
| 9006 | `An extension request is already pending for this job`      | Duplicate request                         |
| 9007 | `No pending extension request`                              | No request to approve                     |
| 9008 | `Cannot approve your own extension request`                 | Same address as requester                 |
| 9009 | `Only the client or freelancer can approve an extension`    | Not a participant                         |

---

## 99xx — Arithmetic & System

| Code | Panic Message                 | Description                              |
|------|-------------------------------|------------------------------------------|
| 9901 | `Arithmetic overflow`         | Integer arithmetic overflow              |
| 9902 | `Counter overflow`            | Storage counter exceeded limits          |
| 9903 | `Timeout ledger overflow`     | Ledger sequence overflow                 |
| 9904 | `Timeout timestamp overflow`  | Timestamp overflow                       |

---

## Frontend Error-Handling Contract

`frontend/lib/contractErrors.ts` is the frontend boundary between raw Soroban
failures and user-facing messages. Keep these behaviors stable when adding or
changing contract errors:

1. **Normalize the wrapper first.** `getContractErrorCode()` removes the
   `Error: ` and `HostError: ` prefixes, then recognizes both
   `Error(Contract, #N)` and `Error(Contract, #N): <panic message>` forms.
2. **Use `UNKNOWN` for code-only failures.** A Soroban error-table number is
   not the application error enum, so `Error(Contract, #N)` maps to code `0`
   rather than guessing a specific operation failure.
3. **Prefer a localized message when a panic is known.**
   `getContractErrorMessage()` selects `en`, `es`, or `fr`; unsupported locales
   fall back to English. The unknown error has a locale-specific generic
   message, while an unmapped numeric code gets an explicit diagnostic.
4. **Preserve diagnostic text when parsing fails.** `parseContractError()`
   returns the original raw error if neither the simulation wrapper nor the
   panic message matches a known contract error. This prevents useful provider
   diagnostics from being discarded.

When adding a new contract error, update all three message maps and the
`PANIC_TO_CODE` map together. Also update the canonical Rust error reference
above and verify the frontend typecheck before opening a PR.

### Examples

| Input | Result |
|-------|--------|
| `Error(Contract, #1)` | Generic localized contract message |
| `Error(Contract, #1): Escrow not found` | Escrow-not-found message |
| `Soroban simulation failed: Bidding is closed` | Bidding-closed message |
| `Provider unavailable` | Original provider diagnostic |

## Usage in Frontend

```typescript
import { parseContractError, getContractErrorMessage } from "@/lib/contractErrors";

// Parse a raw Soroban simulation error into a localized message
const friendlyMessage = parseContractError(
  "Soroban simulation failed: Escrow not found",
  "es" // or use i18n.language
);

// Or map a known error code directly
const msg = getContractErrorMessage(2004, "fr"); // "Aucun séquestre trouvé pour cette mission."
```

---

*See also: [contract-api-reference.md](./contract-api-reference.md) for function-level API documentation.*
