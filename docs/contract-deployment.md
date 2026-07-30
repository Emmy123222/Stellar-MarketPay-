# Soroban Contract Deployment Guide

This guide provides a complete, step-by-step walkthrough for building, deploying, and verifying the MarketPay escrow contract on Stellar testnet and mainnet. Includes automated script usage, end-to-end testing guidance, and a fresh machine setup walkthrough.

> **⏱ Estimate:** ~30-45 minutes for a full first-time setup on a fresh machine.

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Rust + Cargo | >= 1.74 | [rustup.rs](https://rustup.rs) |
| Stellar CLI | Latest | `cargo install --locked stellar-cli` |
| WASM target | -- | `rustup target add wasm32-unknown-unknown` |
| Stellar account | Funded | Testnet via [Friendbot](https://friendbot.stellar.org); mainnet via exchange |
| Node.js | >= 18.x | [nodejs.org](https://nodejs.org) or `nvm` |

### Quick environment check

Run the following to confirm everything is ready:

```bash
rustc --version          # Must be >= 1.74
cargo --version          # Must be >= 1.74
stellar --version        # Stellar CLI
rustup target list --installed | grep wasm32-unknown-unknown   # WASM target
node --version           # Must be >= 18
npm --version
```

### Install missing tools

```bash
# Install Rust (if not present)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli

# Verify all tools
rustc --version && stellar --version && node --version
```

---

## 1. Build the contract

### Option A: Using Cargo directly

From the repository root:

```bash
cd contracts/marketpay-contract
cargo build --target wasm32-unknown-unknown --release
```

The WASM artifact is written to:
```
contracts/marketpay-contract/target/wasm32-unknown-unknown/release/marketpay_contract.wasm
```

### Option B: Using the Makefile

The project includes a `Makefile` with convenient targets:

```bash
cd contracts/marketpay-contract

# Standard release build
make build

# Optimized build (requires wasm-opt)
# Reduces WASM binary size by ~40% with -Oz optimizations
make build-optimized
```

**Optimized vs. standard:** The standard build already uses `opt-level="z"`, LTO, and single codegen unit. The `build-optimized` target additionally runs `wasm-opt -Oz` post-processing (install via `cargo install wasm-opt` or `brew install binaryen`).

Both produce a `.wasm` file at the same path. Use the optimized version for production deployments.

---

## 2. Configure your deploy identity

Create or import a deployer key (example alias `marketpay-deployer`):

```bash
# Generate a new keypair
stellar keys generate marketpay-deployer

# View the public key
stellar keys show marketpay-deployer
```

Fund the public key on testnet:

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys show marketpay-deployer)"
```

Verify the balance:

```bash
stellar account info marketpay-deployer --network testnet
```

> **Mainnet:** Fund the account with real XLM from an exchange or custodial wallet. Minimum 10 XLM base reserve plus gas fees.

---

## 3. Deploy to testnet

### Option A: Automated script (recommended)

Use the provided deployment script which handles build, deploy, and initialization in one step:

```bash
chmod +x scripts/deploy-contract.sh
./scripts/deploy-contract.sh testnet marketpay-deployer
```

The script will:
1. Build the WASM artifact
2. Deploy to the specified network
3. Auto-initialize the contract with the deployer address
4. Print the `CONTRACT_ID` and `NEXT_PUBLIC_CONTRACT_ID` values ready to paste into `.env` files

### Option B: Manual deployment

```bash
stellar contract deploy \
  --wasm contracts/marketpay-contract/target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
  --source marketpay-deployer \
  --network testnet
```

Save the contract ID printed by the CLI (starts with `C`). The output looks like:

```
Contract deployed at CN4X7ICX66HT3OPNFGF5FGI34H3H777HCOXISROTSN7QD6TY7B4SAUSF
```

**Extract the contract ID programmatically:**

```bash
# Run deployment and capture output
deploy_output=$(stellar contract deploy \
  --wasm contracts/marketpay-contract/target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
  --source marketpay-deployer \
  --network testnet 2>&1)

echo "$deploy_output"

# Parse the contract ID from output
CONTRACT_ID=$(echo "$deploy_output" | grep -oP 'Contract deployed at \K[[:alnum:]]+')
echo "Contract ID: $CONTRACT_ID"

# Create .env files with the contract ID
cat > backend/.env <<EOF
CONTRACT_ID=$CONTRACT_ID
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
EOF

cat > frontend/.env.local <<EOF
NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
EOF

echo "✓ Contract deployed and configured in .env files"
```

---

## 4. Initialize the contract

After deployment, the contract needs to be initialized with an admin address. This should be run **exactly once**. The admin is typically the deployer key or a multisig operations account.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- initialize \
  --admin <ADMIN_G_ADDRESS>
```

Replace:
- `<CONTRACT_ID>` with the value from Step 3
- `<ADMIN_G_ADDRESS>` with the deployer's G... address (from `stellar keys show marketpay-deployer`)

> **⚠️ Important:** Initialization is a one-time operation. Re-initializing will fail with `AlreadyInitialized` error. If you need to redeploy, use a fresh contract.

---

## 5. Update application configuration

### 5.1 Backend environment

Copy `backend/.env.example` to `backend/.env` and configure:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set the contract ID:

```env
CONTRACT_ID=CN4X7ICX66HT3OPNFGF5FGI34H3H777HCOXISROTSN7QD6TY7B4SAUSF   # Replace with actual deployed ID
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

**Verify:**

```bash
grep -q "CONTRACT_ID=C" backend/.env && echo "✓ Backend CONTRACT_ID is set" || echo "✗ Backend CONTRACT_ID not configured"
```

### 5.2 Frontend environment

Create or edit `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=CN4X7ICX66HT3OPNFGF5FGI34H3H777HCOXISROTSN7QD6TY7B4SAUSF   # Replace with actual deployed ID
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
```

**Verify:**

```bash
grep -q "NEXT_PUBLIC_CONTRACT_ID=C" frontend/.env.local && echo "✓ Frontend NEXT_PUBLIC_CONTRACT_ID is set" || echo "✗ Frontend NEXT_PUBLIC_CONTRACT_ID not configured"
```

### 5.3 Restart services

```bash
# Restart backend (if running)
cd backend && npm run dev &

# Restart frontend (if running)
cd frontend && npm run dev &

# Or if using Docker Compose:
# docker compose up -d --build backend frontend
```

---

## 6. Verify deployment

### Query contract version

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- get_version
```

Expected output (example):
```
"0.1.0"
```

### Test escrow creation

Create a test escrow via the CLI:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  -- create_escrow \
  --client <CLIENT_G_ADDRESS> \
  --freelancer <FREELANCER_G_ADDRESS> \
  --amount 1000
```

Replace `<CLIENT_G_ADDRESS>` and `<FREELANCER_G_ADDRESS>` with valid Stellar public keys.

### Check on Stellar Expert

Open the [Stellar Expert testnet explorer](https://stellar.expert/explorer/testnet) and search for your contract ID to view deployed operations, balance changes, and transaction history.

---

## 7. Mainnet deployment

Mainnet follows the same workflow with different endpoints:

| Setting | Testnet Value | Mainnet Value |
|---------|--------------|---------------|
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `SOROBAN_RPC` | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` |
| Friendbot funding | `curl https://friendbot.stellar.org?addr=...` | Manual XLM transfer |

### Mainnet deployment commands

```bash
# Deploy to mainnet
./scripts/deploy-contract.sh mainnet marketpay-deployer

# Or manually:
stellar contract deploy \
  --wasm contracts/marketpay-contract/target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
  --source marketpay-deployer \
  --network mainnet
```

### Mainnet readiness checklist

- [ ] WASM built with `--release` and binary checksum recorded (`sha256sum <wasm>`)
- [ ] Contract tested end-to-end on testnet with the exact same WASM binary
- [ ] Admin address is a secured key (hardware wallet, multisig, or cold storage)
- [ ] `CONTRACT_ID` stored in production secrets (not hardcoded)
- [ ] CI/CD pipeline validated against testnet staging environment
- [ ] Rollback plan documented (original WASM hash, upgrade path)
- [ ] Monitoring alerts configured for failed Soroban submissions (see `backend/prometheus/horizon_alerts.yml`)
- [ ] Escrow timeout handling tested and operational

---

## Production deployment checklist

1. **Tag the release** -- `git tag v<version>` for the commit used to build WASM
2. **Record checksum** -- `sha256sum contracts/marketpay-contract/target/wasm32-unknown-unknown/release/marketpay_contract.wasm`
3. **Deploy WASM** -- Use a dedicated mainnet deployer key (not shared with testnet)
4. **Initialize** -- Run `initialize` exactly once; store admin address and contract ID in your secret store
5. **Update secrets** -- Set `CONTRACT_ID` and `NEXT_PUBLIC_CONTRACT_ID` in your production environment (e.g., Docker secrets, Vercel, AWS Secrets Manager)
6. **Smoke-test** -- Create escrow, start work, release with a small test budget
7. **Enable monitoring** -- Verify Soroban submission alerts, escrow timeout events are tracked
8. **Document** -- Record the contract ID, block height of deployment, and admin address in your runbook

---

## End-to-end test on a fresh machine

This section walks through the entire flow on a clean machine -- useful for CI environments, onboarding contributors, or validating the setup guide.

### Prerequisites installation

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 2. Add WASM target
rustup target add wasm32-unknown-unknown

# 3. Install Stellar CLI
cargo install --locked stellar-cli

# 4. Clone the repository
git clone https://github.com/DANTE-1903/Stellar-MarketPay-.git
cd Stellar-MarketPay-

# 5. Verify prerequisites
echo "Rust: $(rustc --version)"
echo "Stellar CLI: $(stellar --version 2>&1 || echo 'not found')"
echo "WASM target: $(rustup target list --installed | grep wasm32-unknown-unknown)"
```

### Build & deploy

```bash
# 6. Build the contract (this takes ~2-5 minutes the first time)
cd contracts/marketpay-contract
cargo build --target wasm32-unknown-unknown --release

# 7. Create a deployer identity
stellar keys generate ci-deployer

# 8. Fund with Friendbot
curl "https://friendbot.stellar.org?addr=$(stellar keys show ci-deployer)" > /dev/null 2>&1
sleep 2  # Wait for network propagation

# 9. Deploy
cd ../..
scripts/deploy-contract.sh testnet ci-deployer

# 10. Capture the contract ID from the script output
# The script prints something like:
#   NEXT_PUBLIC_CONTRACT_ID=CN4X7ICX66HT3OPNFGF5FGI34H3H777HCOXISROTSN7QD6TY7B4SAUSF
#   CONTRACT_ID=CN4X7ICX66HT3OPNFGF5FGI34H3H777HCOXISROTSN7QD6TY7B4SAUSF
# Copy these values into backend/.env and frontend/.env.local manually
```

### Smoke test

```bash
# 11. Query the deployed contract
deployed_id=$(grep -oP 'CONTRACT_ID=\K[[:alnum:]]+' backend/.env 2>/dev/null || echo "manual")
echo "Deployed contract ID: $deployed_id"

# 12. Verify contract responds
stellar contract invoke \
  --id "$deployed_id" \
  --source ci-deployer \
  --network testnet \
  -- get_version

echo "Smoke test complete!"
```

### Known fresh-machine issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `stellar: command not found` | Cargo bin directory not in PATH | Run `source "$HOME/.cargo/env"` or add `~/.cargo/bin` to PATH |
| WASM build takes >10 min | First-ever Rust build on the machine | This is normal -- subsequent builds use the cargo cache |
| Friendbot returns 403 | Rate-limited on testnet | Wait 60 seconds and retry, or fund via the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) |
| `Contract not found` after deploy | Network propagation delay | Wait 5-10 seconds and retry |
| Deployment script fails | Missing tools or wrong network flag | Check `stellar --version`, run with `--verbose` |

---

## Troubleshooting

### `error: target wasm32-unknown-unknown not installed`

```bash
rustup target add wasm32-unknown-unknown
```

Then rebuild.

### `stellar: command not found`

The Stellar CLI binary is installed to `~/.cargo/bin/`. Make sure this directory is in your PATH:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
```

Or re-source the Cargo env:
```bash
source "$HOME/.cargo/env"
```

### `Insufficient balance` on deploy

Deploying a Soroban contract requires XLM for:
- **Base reserve** (2.5 XLM for the contract account)
- **Transaction fee** (typically 100 stroops = 0.00001 XLM)
- **Storage rent** (per byte of WASM code)

Fund the deployer account via Friendbot (testnet) or transfer real XLM (mainnet). A minimum of 10 XLM is recommended.

Check balance:
```bash
stellar account info marketpay-deployer --network testnet
```

### `Contract not found` after deploy

1. Verify `CONTRACT_ID` in your `.env` matches the deploy output exactly
2. Ensure `STELLAR_NETWORK` matches the network you deployed to
3. Wait 5-10 seconds for network propagation
4. Check the transaction on [Stellar Expert](https://stellar.expert/explorer/testnet)

### `AlreadyInitialized` error

The `initialize` function can only be called once per contract. If you need to re-initialize, deploy a **new** contract instance.

### Simulation failed / `InvalidAction`

Arguments may not match the contract interface:

1. Compare your invocation with the function signatures in `contracts/marketpay-contract/src/lib.rs`
2. Ensure token addresses use the correct [Stellar Asset Contract (SAC)](https://developers.stellar.org/docs/build/smart-contracts/token-interface) format for the network
3. Verify all arguments are in the correct order and use the expected types

### Frontend still uses mock escrow

Set these environment variables and restart the frontend:

```bash
# In frontend/.env.local
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
NEXT_PUBLIC_CONTRACT_ID=<actual_deployed_contract_id>

# Clear any Next.js build cache and restart
cd frontend
rm -rf .next
npm run dev
```

### Backend cannot read escrow events

Confirm the following in `backend/.env`:

```env
CONTRACT_ID=<match deploy output>
HORIZON_URL=https://horizon-testnet.stellar.org   # Must match network
STELLAR_NETWORK=testnet                             # Must match deployed network
```

Check backend logs for Horizon connection errors. See [Environment Variables](./environment-variables.md) for all configuration options.

### `stellar: error: unrecognized subcommand 'contract'`

Your Stellar CLI version may be too old. Update to the latest version:

```bash
cargo install --locked stellar-cli
stellar --version   # Should be >= 21.x
```

### `wasm-opt: command not found`

The `make build-optimized` target requires `wasm-opt`. Install it:

```bash
cargo install wasm-opt
# OR
brew install binaryen        # macOS
# OR
sudo apt install binaryen    # Debian/Ubuntu
```

### Build error: `linker 'cc' not found`

Install a C compiler toolchain:

```bash
# Debian/Ubuntu
sudo apt install build-essential

# macOS
echo "Already included with Xcode Command Line Tools"
xcode-select --install 2>/dev/null || true

# Fedora/RHEL
sudo dnf groupinstall "Development Tools"
```

### Transaction fails during `initialize` or `create_escrow`

Enable verbose logging to diagnose:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source marketpay-deployer \
  --network testnet \
  --verbose \
  -- get_version
```

Common causes:
- Contract not yet initialized
- Wrong admin address format (must be G... address, not S... secret)
- Insufficient XLM balance to cover the operation fee
