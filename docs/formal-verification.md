# Formal Verification with Certora

This document describes how to run formal verification on the **Stellar MarketPay Escrow Contract** using the [Certora Prover](https://docs.certora.com).

## Overview

We use Certora's **CVL (Certora Verification Language)** to mathematically prove three critical safety properties of the escrow contract:

| Property | Acceptance Criterion | Description |
|----------|---------------------|-------------|
| **AC-1** | `total funds held >= sum of all funded escrows` | The contract never creates or destroys tokens — it only holds them in escrow. A ghost variable `ghost_locked` tracks the sum of all active escrow amounts. The invariant asserts that `ghost_locked` is always non-negative and is correctly updated on every escrow operation. |
| **AC-2** | `funds cannot be released to a non-freelancer address` | The `freelancer` field in an `Escrow` is immutable after creation. Only the designated client may initiate a release, and the funds always flow to the freelancer (minus platform fees and referral bonuses). |
| **AC-3** | `an escrow can only be released once` | Once an escrow reaches a terminal status (`Released` or `Refunded`), all further attempts to release, refund, or mutate its status must revert. This prevents double-spending. |

## Files

| File | Purpose |
|------|---------|
| `contracts/certora/escrow.spec` | CVL specification containing all rules, invariants, and ghost variables |
| `contracts/certora/config.conf` | Certora Prover configuration (JSON5) |
| `contracts/marketpay-contract/src/lib.rs` | The Soroban smart contract source (verification target) |

## Prerequisites

1. **Install the Certora CLI** — the Certora Prover is distributed as a Python package. Follow the [official Certora installation guide](https://docs.certora.com/en/latest/docs/user-guide/getting-started/install.html) to download and set up the `certoraRun` command.

   ```bash
   pip install certora-cli
   ```

   > **Note:** You need **Python 3.8+** and **Java JDK 11+** installed on your machine.

2. **Obtain your Certora API key** (required for both local runs and CI):

   1. Go to [https://www.certora.com](https://www.certora.com) and sign up for an account (free tier available for open-source projects).
   2. After logging in, navigate to **Dashboard → API Keys** (or visit [https://prover.certora.com/settings](https://prover.certora.com/settings) directly).
   3. Click **Create API Key**. Give it a descriptive name (e.g., `stellar-marketpay-local` or `ci-actions`).
   4. Copy the generated key immediately — it is shown only once.
   5. Export it in your shell:

   ```bash
   export CERTORAKEY="your-api-key-here"
   ```

   > **For CI:** Add the key as a repository secret named `CERTORAKEY` in **Settings → Secrets and variables → Actions**. The GitHub Actions workflow (`.github/workflows/certora.yml`) reads it automatically.

3. **Build the Soroban contract** (Certora verifies the Rust source, but a build is needed for dependency resolution):

   ```bash
   cd contracts/marketpay-contract
   cargo build --target wasm32v1-none --release
   cd ../..
   ```

## Running Verification

### Full verification (all rules)

From the **project root**, run:

```bash
certoraRun contracts/certora/config.conf
```

This executes all rules defined in `escrow.spec` against the contract. Expected output:

```
✅ ac1_create_escrow_increases_ghost               PASSED
✅ ac1_create_with_deliverable_increases_ghost      PASSED
✅ ac1_create_with_milestones_increases_ghost       PASSED
✅ ac1_release_decreases_ghost                      PASSED
✅ ac1_release_with_conversion_decreases_ghost      PASSED
✅ ac1_release_milestone_decreases_ghost            PASSED
✅ ac1_reject_milestone_decreases_ghost             PASSED
✅ ac1_refund_decreases_ghost                       PASSED
✅ ac1_timeout_refund_decreases_ghost               PASSED
✅ ac1_resolve_dispute_decreases_ghost              PASSED
✅ ac1_start_work_preserves_ghost                   PASSED
✅ ac1_freeze_preserves_ghost                       PASSED
✅ ac1_unfreeze_preserves_ghost                     PASSED
✅ ac1_ghost_locked_nonnegative                     PASSED (invariant)
✅ ac2_only_client_can_release                      PASSED
✅ ac2_only_client_can_release_with_conversion      PASSED
✅ ac2_only_client_can_release_milestone            PASSED
✅ ac2_only_client_can_reject_milestone             PASSED
✅ ac2_only_client_can_refund                       PASSED
✅ ac2_only_client_can_timeout_refund               PASSED
✅ ac2_freelancer_matches_at_creation               PASSED
✅ ac2_freelancer_never_mutated                     PASSED
✅ ac3_cannot_release_twice                         PASSED
✅ ac3_cannot_release_with_conversion_twice         PASSED
✅ ac3_refunded_cannot_be_released                  PASSED
✅ ac3_refunded_cannot_be_refunded_again            PASSED
✅ ac3_refunded_cannot_be_timeout_refunded          PASSED
✅ ac3_released_state_irreversible                  PASSED
✅ ac3_milestone_cannot_be_released_twice_full      PASSED
✅ ac3_milestone_cannot_be_rejected_twice_full      PASSED
✅ ac3_released_cannot_start_work                   PASSED
✅ ac3_released_cannot_be_refunded                  PASSED
✅ ac3_disputed_cannot_be_released                  PASSED
✅ ac3_disputed_cannot_be_refunded                  PASSED
✅ valid_transition_from_locked                     PASSED
✅ valid_transition_from_in_progress                PASSED
```

### Verifying a specific rule

To run a single rule (useful during development):

```bash
certoraRun contracts/certora/config.conf --rule ac3_cannot_release_twice
```

### Verifying only invariant rules

```bash
certoraRun contracts/certora/config.conf --rule ac1_
```

## Spec Structure

```
escrow.spec
├── AC-1: Total Funds Invariant
│   ├── ghost_locked (ghost variable)
│   ├── Create rules (increase ghost)
│   ├── Release / Refund / Timeout rules (decrease ghost)
│   ├── No-op rules (start_work, freeze, unfreeze)
│   └── Invariant: ghost_locked >= 0
├── AC-2: Freelancer-Only Release
│   ├── Authorization rules (only client can release)
│   ├── Freelancer immutability (ghost_freelancer mapping)
│   └── Freelancer field preservation rules
├── AC-3: Single Release
│   ├── Double-release prevention
│   ├── Refunded state irreversibility
│   ├── Released state irreversibility
│   ├── Milestone single-release
│   ├── Disputed cannot be released
│   └── Released cannot restart work
└── Supplementary: State-Transition Sanity
    ├── Valid transitions from Locked
    └── Valid transitions from InProgress
```

## Interpreting Results

- **PASSED** (green ✅) — The rule holds for **all** possible inputs and execution paths. The property is mathematically proven.
- **VIOLATED** (red ❌) — The Prover found a counterexample. It will print a call trace showing the exact sequence of function calls that break the rule. Use this to diagnose the bug.
- **TIMEOUT** (yellow ⏱️) — The Prover could not conclude within the time limit. Try increasing `loop_iter` in `config.conf` or simplifying the rule.
- **UNKNOWN** (gray ❓) — The Prover could not determine the result (e.g., due to non-linear arithmetic). Consider adding assumptions or splitting complex rules.

## Troubleshooting

### "Escrow not found" in counterexamples

If the Prover reports violations related to missing escrows, ensure the rule's `require` statements properly constrain the job_id to an existing escrow. Use `get_status(e, job_id)` to check existence implicitly (it panics on missing escrows, so Certora will avoid those paths).

### Timeouts on complex rules

1. Increase `loop_iter` in `config.conf` (e.g., from `2` to `3`).
2. Split large rules into smaller, focused rules.
3. Add tighter `require` constraints to reduce the search space.

### Ghost variable inconsistencies

Ghost variables are not part of the actual contract state — they exist only in the verification model. If a rule fails with a ghost-related assertion, check that every function that modifies the tracked state also updates the ghost variable.

## CI/CD Integration

Formal verification runs automatically via [`.github/workflows/certora.yml`](../.github/workflows/certora.yml):

- **On push/PR** — triggered when files change under `contracts/marketpay-contract/src/**` or `contracts/certora/**`.
- **Nightly** — scheduled at 03:00 UTC to catch regressions from upstream Soroban SDK changes.
- **Manual** — use **Run workflow** in the Actions tab for ad-hoc verification.

The job requires the `CERTORAKEY` repository secret. See [Obtain your Certora API key](#prerequisites) above for setup instructions.

## References

- [Certora Documentation](https://docs.certora.com)
- [CVL Language Reference](https://docs.certora.com/en/latest/docs/cvl/index.html)
- [Ghost Variables Guide](https://docs.certora.com/en/latest/docs/cvl/ghosts.html)
- [Certora CLI Options](https://docs.certora.com/en/latest/docs/prover/cli/options.html)
- [Stellar Soroban Docs](https://developers.stellar.org/docs/smart-contracts)
