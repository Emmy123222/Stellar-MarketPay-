# Soroban Contract Deployment Guide

This guide walks through building, deploying, and verifying the MarketPay escrow contract on Stellar testnet and mainnet.

## Deployed Contract (Testnet)

| Field | Value |
|-------|-------|
| **Contract ID** | `CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG` |
| **Network** | Testnet (`Test SDF Network ; September 2015`) |
| **Admin / Treasury** | `GAUC7VCPFCQQBMHMOH3NPRUSOT2RBXLJNV433JMAXUPFYKU2MCO7CHL4` (alias: `streampay-deployer`) |
| **XLM SAC (testnet)** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Initialized** | Yes — `initialize(admin, treasury)` called |
| **Version** | 1 |
| **Platform fee** | 100 bps (1%) |

### Test transactions

| Function | Tx Hash | Explorer |
|----------|---------|----------|
| Initialization | `51b84452…` | [View](https://stellar.expert/explorer/testnet/tx/51b84452dc148912ec2fecf317c5ac9b3a274c69c98734e6836c1023cad30f08) |
| `create_escrow` | `f262cd2c…` | [View](https://stellar.expert/explorer/testnet/tx/f262cd2c7b501e52cf79535dada3a846013fdf74569ae7fc31bc5845394768dd) |
| `start_work` → `release_escrow` | `d4cd6eb6…` | [View](https://stellar.expert/explorer/testnet/tx/d4cd6eb65775916f9a38aafa256d915836973fc6d298c854fdd93ba9b372e123) |
| `refund_escrow` | `a0faf221…` | [View](https://stellar.expert/explorer/testnet/tx/a0faf221f15a1a0ca3f7f5c0bfcfebe90d7cc64bc7b359b475b7f40777805940) |

---

## Prerequisites

| Tool | Notes |
|------|--------|
| Rust ≥ 1.74 | `rustup` with `wasm32v1-none` target |
| Soroban CLI | [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) (`stellar` command) |
| Stellar account | Funded account on the target network (testnet via Friendbot) |
| Node.js ≥ 18 | For backend env updates after deploy |

Install the WASM target:

```bash
rustup target add wasm32v1-none
```

Confirm the CLI is available:

```bash
stellar --version
```

## 1. Build the contract

From the repository root:

```bash
cd contracts/marketpay-contract
cargo build --target wasm32v1-none --release
```

The WASM artifact is written to:

`target/wasm32v1-none/release/marketpay_contract.wasm`

## 2. Configure your deploy identity

Create or import a deployer key (example alias `marketpay-deployer`):

```bash
stellar keys generate marketpay-deployer
stellar keys address marketpay-deployer
```

Fund the public key on testnet:

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address marketpay-deployer)"
```

For mainnet, fund the account with real XLM from an exchange or custodian wallet.

## 3. Deploy to testnet

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/marketpay_contract.wasm \
  --source marketpay-deployer \
  --network testnet
```

Save the contract ID printed by the CLI (starts with `C`).

## 4. Initialize the contract

Set the admin and treasury addresses (typically the same deployer or a multisig operations account):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- \
  initialize \
  --admin <ADMIN_G_ADDRESS> \
  --treasury_address <TREASURY_G_ADDRESS>
```

Replace `<CONTRACT_ID>`, `<ADMIN_G_ADDRESS>`, and `<TREASURY_G_ADDRESS>` with your values.

## 5. Update application configuration

### Backend

Copy `backend/.env.example` to `backend/.env` and set:

```env
CONTRACT_ID=CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

Restart the API after changing env vars.

### Frontend

In `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
```

## 6. Verify deployment

Query contract version or escrow state for a test job id:

```bash
stellar contract invoke \
  --id CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG \
  --source marketpay-deployer \
  --network testnet \
  -- \
  get_version
```

Create a test escrow from the UI (post a job) or invoke `create_escrow` via the CLI:

```bash
stellar contract invoke \
  --id CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG \
  --source marketpay-deployer \
  --network testnet \
  -- \
  create_escrow \
  --job_id 'my-test-job' \
  --client <CLIENT_ADDRESS> \
  --params '{"freelancer":"<FREELANCER_ADDRESS>","token":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC","amount":"10000000","milestones":null,"timeout_ledgers":null,"referrer":null}'
```

> **Note:** The `amount` field in `--params` JSON must be a **string** (not a number) for the CLI parser.

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

### `error: target wasm32v1-none not installed`

Run `rustup target add wasm32v1-none` and rebuild.

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
