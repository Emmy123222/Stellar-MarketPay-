# MarketPay Soroban Escrow Contract

This Soroban smart contract manages trustless escrow between clients and freelancers on Stellar.

## Functions

| Function | Who calls it | Description |
|----------|-------------|-------------|
| `initialize(admin)` | Deployer | One-time setup, sets version to 1 |
| `create_escrow(job_id, client, freelancer, token, amount)` | Client | Lock funds in contract |
| `start_work(job_id, client)` | Client | Mark work as started |
| `release_escrow(job_id, client)` | Client | Release funds to freelancer |
| `refund_escrow(job_id, client)` | Client | Refund before work starts |
| `get_escrow(job_id)` | Anyone | Read escrow record |
| `get_status(job_id)` | Anyone | Read escrow status |
| `upgrade(new_wasm_hash)` | Admin only | Upgrade contract WASM, bumps version |
| `get_version()` | Anyone | Return current contract version number |

## Build & Test

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Test
cargo test
```

## Deploy

```bash
chmod +x ../../scripts/deploy-contract.sh
../../scripts/deploy-contract.sh testnet alice
```

## Contract Upgrade Process

Soroban upgrades replace only the executable WASM — all on-chain storage
(escrows, proposals, ratings, …) is preserved automatically.

### Step-by-step

1. **Build the new WASM**
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```

2. **Install the new WASM on-chain** (uploads bytes, returns a hash)
   ```bash
   stellar contract install \
     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
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
- **v2.1** — Dispute resolution via DAO governance
