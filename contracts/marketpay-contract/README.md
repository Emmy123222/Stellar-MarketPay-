# MarketPay Soroban Escrow Contract

This Soroban smart contract manages trustless escrow between clients and freelancers on Stellar.

## Functions

| Function | Who calls it | Description |
|----------|-------------|-------------|
| `initialize(admin)` | Deployer | One-time setup, sets version to 1, stores admin list |
| `create_escrow(job_id, client, freelancer, token, amount)` | Client | Lock funds in contract |
| `start_work(job_id, client)` | Client | Mark work as started |
| `release_escrow(job_id, client)` | Client | Release funds to freelancer |
| `refund_escrow(job_id, client)` | Client | Refund before work starts |
| `timeout_refund(job_id, client)` | Client | Refund after the timestamp-based timeout expires |
| `raise_dispute(job_id, caller)` | Client/Freelancer | Mark escrow as disputed |
| `nominate_arbitrators(job_id, admin, arbitrators)` | Admin | Pick 3 arbitrators for a disputed job |
| `arbitrator_vote(job_id, arbitrator, client_percent)` | Arbitrator | Cast a dispute vote |
| `finalize_dispute(job_id)` | Anyone | Split funds using the median vote |
| `emergency_admin_resolve(job_id, admin, recipient)` | Admin | Force a dispute resolution |
| `get_escrow(job_id)` | Anyone | Read escrow record |
| `get_milestone(job_id, index)` | Anyone | Read a single milestone by index |
| `get_status(job_id)` | Anyone | Read escrow status |
| `get_timeout_timestamp(job_id)` | Anyone | Read the Unix timestamp used for timeout enforcement |
| `is_frozen()` | Anyone | Check whether the contract is globally frozen |
| `freeze_contract(admin)` | Admin | Globally freeze all state-mutating operations |
| `unfreeze_contract(admins)` | Multiple admins | Unfreeze the contract (M-of-N threshold of admin signatures required) |
| `add_admin(admin, new_admin)` | Admin | Add a new admin to the multi-sig list |
| `set_unfreeze_threshold(admin, threshold)` | Admin | Set the M-of-N unfreeze threshold |
| `get_admins()` | Anyone | Return the list of admin addresses |
| `get_unfreeze_threshold()` | Anyone | Return the unfreeze threshold |
| `set_default_timeout_seconds(admin, timeout_seconds)` | Admin | Override the default timeout for new escrows |
| `upgrade(new_wasm_hash)` | Admin only | Upgrade contract WASM, bumps version and preserves storage |
| `get_version()` | Anyone | Return current contract version number |
| `release_milestone(job_id, milestone_id, client)` | Client | Release a single milestone's funds |
| `reject_milestone(job_id, milestone_id, client)` | Client | Reject and refund a single milestone |

## Build & Test

```bash
# Standard build
cargo build --target wasm32-unknown-unknown --release

# Optimized build (cargo release + wasm-opt -Oz post-processing)
# Requires wasm-opt — install with one of:
#   cargo install wasm-opt
#   brew install binaryen        (macOS)
#   apt install binaryen         (Debian/Ubuntu)
make build-optimized

# Run tests
cargo test
```

### Release profile

`Cargo.toml` already configures `[profile.release]` for minimum WASM size:

| Setting | Value | Effect |
|---------|-------|--------|
| `opt-level` | `"z"` | Optimise aggressively for binary size |
| `lto` | `true` | Link-time optimisation — removes dead code across crates |
| `codegen-units` | `1` | Single codegen unit for maximum inlining and dead-code elimination |
| `strip` | `"symbols"` | Strip debug symbols from the binary |
| `panic` | `"abort"` | Replace panic unwinding machinery with a single `unreachable` trap |

After running `make build-optimized` the target binary is:

```
target/wasm32-unknown-unknown/release/marketpay_contract.optimized.wasm
```

Use this file (not the plain `.wasm`) when deploying or installing on-chain.

## Deploy

```bash
chmod +x ../../scripts/deploy-contract.sh
../../scripts/deploy-contract.sh testnet alice
```

## Contract Upgrade Process

Soroban upgrades replace only the executable WASM — all on-chain storage
(escrows, proposals, ratings, …) is preserved automatically.

The contract stores a `Version` value in state, so operators can confirm that
the active WASM and the on-chain record are in sync after an upgrade.

### Step-by-step

1. **Build the new WASM**
   ```bash
   make build-optimized
   # Produces: target/wasm32-unknown-unknown/release/marketpay_contract.optimized.wasm
   ```

2. **Install the new WASM on-chain** (uploads bytes, returns a hash)
   ```bash
   stellar contract install \
     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.optimized.wasm \
     --source <admin-key> --network testnet
   # → prints NEW_WASM_HASH
   ```

3. **Call `upgrade` with the admin key**
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source <admin-key> --network testnet \
     -- upgrade --new_wasm_hash <NEW_WASM_HASH>
   ```

4. **Verify the version bumped**
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> --network testnet \
     -- get_version
   # → 2  (or N+1 from previous version)
   ```

5. **Verify existing escrows are intact**
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> --network testnet \
     -- get_escrow --job_id <any-existing-job-id>
   ```

### Schema migration

If the new version changes a stored struct (e.g. adds a field to `Escrow`),
add a `migrate()` function in the new WASM that reads old records, transforms
them, and writes them back. Call `migrate()` once immediately after `upgrade()`.
Old records that are never touched will be read with default values for new
fields as long as the struct derives `Default` or the fields are `Option<T>`.

## XLM SAC Address (Testnet)
```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Roadmap

- **v2.0** — Milestone-based partial releases
- **v2.1** — Dispute resolution via 3-arbitrator voting with emergency admin fallback
