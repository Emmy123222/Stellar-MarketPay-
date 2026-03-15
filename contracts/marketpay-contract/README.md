# MarketPay Soroban Escrow Contract

This Soroban smart contract manages trustless escrow between clients and freelancers on Stellar.

## Functions

| Function | Who calls it | Description |
|----------|-------------|-------------|
| `initialize(admin)` | Deployer | One-time setup |
| `create_escrow(job_id, client, freelancer, token, amount)` | Client | Lock funds in contract |
| `start_work(job_id, client)` | Client | Mark work as started |
| `release_escrow(job_id, client)` | Client | Release funds to freelancer |
| `refund_escrow(job_id, client)` | Client | Refund before work starts |
| `get_escrow(job_id)` | Anyone | Read escrow record |
| `get_status(job_id)` | Anyone | Read escrow status |

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

## XLM SAC Address (Testnet)
```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Roadmap

- **v2.0** — Milestone-based partial releases
- **v2.1** — Dispute resolution via DAO governance
