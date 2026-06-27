# Stellar MarketPay — Smart Contract Formal Verification

Formal verification mathematically proves that a smart contract adheres to a set of high-level properties (invariants) for **all possible inputs and execution paths**. Unlike unit tests or integration tests, which verify individual test cases, formal verification provides complete assurance within the bounds of the specifications.

We use the **Certora Prover** with **Certora Verification Language (CVL)** to formally verify our Soroban smart contract.

---

## Covered Invariants

The formal verification suite validates three critical security invariants for the escrow lifecycle:

### Invariant A: Total Locked Funds Consistency
* **Definition**: The total amount of funds reported as locked by the protocol must always equal the sum of all active escrow balances.
* **Specification**: Uses a CVL ghost variable (`total_locked`) to trace the ledger-level sum and asserts that creation, release, partial release, and refund operations update the sum correctly.

### Invariant B: No Double Release
* **Definition**: An escrow that has already been released must never be releasable again.
* **Specification**: Proves that once an escrow's state transitions to `Released`, any subsequent call to `release_escrow` or `release_with_conversion` reverts. It also proves the state transition is irreversible (`Released` cannot transition back to `Locked`, `InProgress`, or `Disputed`).

### Invariant C: Authorization Safety
* **Definition**: Only the escrow's designated client can release, partial-release, or refund an escrow.
* **Specification**: Validates that calls to `release_escrow`, `release_with_conversion`, `refund_escrow`, `timeout_refund`, and `partial_release` from any address other than the escrow client always revert.

---

## Project Structure

All formal verification files are located in the `contracts/certora` directory:

* `contracts/certora/escrow.spec`: The CVL specification file containing the methods block, ghosts, and invariant rules.
* `contracts/certora/config.conf`: The Certora configuration file specifying the contract files and verification configurations.

---

## Local Setup Instructions

To run formal verification locally, you must set up the Certora environment:

### 1. Prerequisites
- **Java Development Kit (JDK)**: Version 11 or later.
- **Python**: Version 3.8.16 or later.
- **Rust Toolchain**: `wasm32-unknown-unknown` target must be added.
- **Stellar / Soroban Build Tools**: standard cargo tools.

### 2. Install Tools
1. Install Python packages:
   ```bash
   pip install certora-cli-beta
   ```
2. Install Rust target and `rustfilt` utility:
   ```bash
   rustup target add wasm32-unknown-unknown
   cargo install rustfilt
   ```

### 3. API Authentication
You must obtain a Certora API key from [Certora](https://www.certora.com/). Set the key as an environment variable in your terminal:
```bash
export CERTORAKEY="your-certora-api-key"
```

---

## Running Verification

Navigate to the repository root and run:
```bash
certoraSorobanProver contracts/certora/config.conf
```

The prover will:
1. Compile the contract source code.
2. Symbolically execute each rule inside `escrow.spec`.
3. Provide a web dashboard link displaying the rule execution outcomes (either **PASS** or **VIOLATION** with counterexamples).

---

## CI/CD Integration

We have integrated automated formal verification via GitHub Actions in [.github/workflows/certora.yml](file:///Users/mac/drips/Stellar-MarketPay-/.github/workflows/certora.yml).

### Trigger Conditions
Verification automatically runs on pulls/pushes targeting `main` or `dev` branches when:
- Smart contract Rust files change under `contracts/marketpay-contract/src/**`
- Specification files change under `contracts/certora/**`
- The workflow file itself changes.

### Failure Reporting
If a rule fails or the prover encounters a verification violation, the build fails. Logs and dashboard links are provided directly in the GitHub Actions console.

---

## Extending Specifications

To add a new rule:
1. Open [contracts/certora/escrow.spec](file:///Users/mac/drips/Stellar-MarketPay-/contracts/certora/escrow.spec).
2. Declare any new methods/getters under the `methods` block if needed.
3. Write your rule using CVL syntax. For example, to check that non-positive escrow amounts cannot be created:
   ```cvl
   rule check_positive_amount {
       env e;
       string job_id;
       address client;
       CreateEscrowParams params;
       
       require params.amount <= 0;
       
       create_escrow@withrevert(e, job_id, client, params);
       assert lastReverted;
   }
   ```
4. Run `certoraSorobanProver contracts/certora/config.conf` to verify your new rule.
