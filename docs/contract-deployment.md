# Soroban Contract Deployment Guide

This guide walks through building, deploying, and verifying the MarketPay escrow contract on Stellar testnet and mainnet.

## Prerequisites

| Tool | Notes |
|------|--------|
| Rust ≥ 1.74 | `rustup` with `wasm32-unknown-unknown` target |
| Soroban CLI | [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) (`stellar` command) |
| Stellar account | Funded account on the target network (testnet via Friendbot) |
| Node.js ≥ 18 | For backend env updates after deploy |

Install the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

Confirm the CLI is available:

```bash
stellar --version
```

## 1. Build the contract

From the repository root:

```bash
cd contracts/marketpay-contract
cargo build --target wasm32-unknown-unknown --release
```

The WASM artifact is written to:

`target/wasm32-unknown-unknown/release/marketpay_contract.wasm`

## 2. Configure your deploy identity

Create or import a deployer key (example alias `marketpay-deployer`):

```bash
stellar keys generate marketpay-deployer
stellar keys show marketpay-deployer
```

Fund the public key on testnet:

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys show marketpay-deployer)"
```

For mainnet, fund the account with real XLM from an exchange or custodian wallet.

## 3. Deploy to testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
  --source marketpay-deployer \
  --network testnet
```

Save the contract ID printed by the CLI (starts with `C`).

## 4. Initialize the contract

Set the admin address (typically the same deployer or a multisig operations account):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- initialize \
  --admin <ADMIN_G_ADDRESS>
```

Replace `<CONTRACT_ID>` and `<ADMIN_G_ADDRESS>` with your values.

## 5. Update application configuration

### Backend

Copy `backend/.env.example` to `backend/.env` and set:

```env
CONTRACT_ID=C...
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

Restart the API after changing env vars.

### Frontend

In `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=C...
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
```

## 6. Verify deployment

Query contract version or escrow state for a test job id:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- get_version
```

Create a test escrow from the UI (post a job) or invoke `create_escrow` via the CLI using the same argument order as `contracts/marketpay-contract/src/lib.rs`.

Confirm the transaction on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

## 7. Mainnet deployment

Mainnet follows the same commands with `--network mainnet` and mainnet endpoints:

| Setting | Value |
|---------|--------|
| `HORIZON_URL` | `https://horizon.stellar.org` |
| `SOROBAN_RPC` | `https://soroban-mainnet.stellar.org` |
| `STELLAR_NETWORK` | `mainnet` |

Checklist before mainnet:

- [ ] WASM built with `--release` and checksum recorded
- [ ] Admin address is a secured key (hardware wallet or multisig)
- [ ] `CONTRACT_ID` set in production secrets only
- [ ] CI and staging validated against testnet
- [ ] Rollback plan documented for operators

## Production deployment checklist

1. Tag the release commit used for the WASM build.
2. Deploy WASM with a dedicated mainnet deployer key.
3. Run `initialize` once; record admin address and contract ID in your secret store.
4. Update production `CONTRACT_ID` for backend and frontend services.
5. Smoke-test: create escrow → start work → release on a small budget.
6. Enable monitoring for failed Soroban submissions and escrow timeouts.

## Troubleshooting

### `error: target wasm32-unknown-unknown not installed`

Run `rustup target add wasm32-unknown-unknown` and rebuild.

### `Insufficient balance` on deploy

Fund the deployer account (Friendbot on testnet). Deployments consume XLM for fees and contract storage.

### `Contract not found` after deploy

Verify `CONTRACT_ID` matches the deploy output exactly and that `STELLAR_NETWORK` matches the network you deployed to.

### Simulation failed / `InvalidAction`

Arguments may not match the contract interface. Compare with `create_escrow` in `contracts/marketpay-contract/src/lib.rs` and ensure token addresses use the correct SAC format for the network.

### Frontend still uses mock escrow

Set `NEXT_PUBLIC_USE_CONTRACT_MOCK=false` and provide a valid `NEXT_PUBLIC_CONTRACT_ID`, then restart `npm run dev`.

### Backend cannot read escrow events

Confirm `CONTRACT_ID`, `HORIZON_URL`, and indexer configuration in `backend/.env`. See [Environment Variables](./environment-variables.md).
