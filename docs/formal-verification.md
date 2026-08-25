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

1. **Install the Certora CLI** — the Certora Prover is distributed as a Java-based CLI tool. Follow the [official Certora installation guide](https://docs.certora.com/en/latest/docs/user-guide/getting-started/install.html) to download and set up the `certoraRun` command.

   > **Note:** Certora is **not** installed via `pip` or `npm`. Use the official installation script from your Certora account dashboard.

2. **Set your Certora API key** (obtain from [certora.com](https://www.certora.com)):

   ```bash
   export CERTORAKEY="your-api-key-here"
   ```

3. **Build the Soroban contract** (Certora verifies the Rust source, but a build is needed for dependency resolution):

   ```bash
   cd contracts/marketpay-contract
   cargo build --target wasm32-unknown-unknown --release
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

Add this to your GitHub Actions workflow (`.github/workflows/formal-verification.yml`):

```yaml
name: Formal Verification

on:
  push:
    branches: [main]
    paths:
      - 'contracts/marketpay-contract/src/**'
      - 'contracts/certora/**'
  pull_request:
    paths:
      - 'contracts/marketpay-contract/src/**'
      - 'contracts/certora/**'

jobs:
  certora:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          target: wasm32-unknown-unknown
      - name: Build contract
        working-directory: contracts/marketpay-contract
        run: cargo build --target wasm32-unknown-unknown --release
      - name: Install Certora CLI
        run: |
          # Download the Certora CLI from the official source
          # See: https://docs.certora.com/en/latest/docs/user-guide/getting-started/install.html
          wget -q https://repo.certora.com/install.sh -O /tmp/certora-install.sh
          bash /tmp/certora-install.sh
      - name: Run Certora Prover
        env:
          CERTORAKEY: ${{ secrets.CERTORAKEY }}
        run: certoraRun contracts/certora/config.conf
```

## References

- [Certora Documentation](https://docs.certora.com)
- [CVL Language Reference](https://docs.certora.com/en/latest/docs/cvl/index.html)
- [Ghost Variables Guide](https://docs.certora.com/en/latest/docs/cvl/ghosts.html)
- [Certora CLI Options](https://docs.certora.com/en/latest/docs/prover/cli/options.html)
- [Stellar Soroban Docs](https://developers.stellar.org/docs/smart-contracts)
