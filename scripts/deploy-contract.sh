#!/usr/bin/env bash
# scripts/deploy-contract.sh
# Build and deploy a Stellar MarketPay Soroban contract.
#
# Usage:
#   chmod +x scripts/deploy-contract.sh
#   ./scripts/deploy-contract.sh [testnet|mainnet] [identity] [version] [contract_name]
#
# `contract_name`: 'marketpay-contract' (default) or 'arbitrator-registry'
# `version` is the semver string stored on-chain; defaults to Cargo.toml version.

set -euo pipefail

NETWORK=${1:-testnet}
IDENTITY=${2:-alice}
CONTRACT_NAME=${4:-marketpay-contract}
CONTRACT_DIR="$(dirname "$0")/../contracts/$CONTRACT_NAME"
VERSION=${3:-$(sed -n 's/^version = "\(.*\)"/\1/p' "$CONTRACT_DIR/Cargo.toml" | head -1)}

WASM_BASENAME="${CONTRACT_NAME//-/_}"
WASM_RAW="$CONTRACT_DIR/target/wasm32v1-none/release/${WASM_BASENAME}.wasm"
WASM_OPT="$CONTRACT_DIR/target/wasm32v1-none/release/${WASM_BASENAME}.optimized.wasm"

echo "🏪 Stellar MarketPay — Contract Deploy"
echo "   Contract: $CONTRACT_NAME"
echo "   Network:  $NETWORK"
echo "   Identity: $IDENTITY"
echo "   Version:  $VERSION"
echo ""

command -v stellar &>/dev/null || { echo "❌ stellar CLI not found. Run: cargo install --locked stellar-cli"; exit 1; }
command -v cargo   &>/dev/null || { echo "❌ Rust/Cargo not found. Run: https://rustup.rs"; exit 1; }

# Build
echo "🔨 Building WASM..."
cd "$CONTRACT_DIR"

if command -v wasm-opt &>/dev/null && command -v make &>/dev/null; then
  echo "   ⚡ Running optimized build (make build-optimized)..."
  make build-optimized
  WASM="$WASM_OPT"
elif command -v make &>/dev/null; then
  echo "   ⚙️ Running standard build (make build)..."
  make build
  WASM="$WASM_RAW"
else
  cargo build --target wasm32v1-none --release
  WASM="$WASM_RAW"
fi

if [[ -f "$WASM_OPT" ]]; then
  WASM="$WASM_OPT"
  echo "   ✅ Using optimized WASM: $(du -sh "$WASM" | cut -f1)"
else
  echo "   ✅ Using standard WASM: $(du -sh "$WASM" | cut -f1)"
fi

# Deploy
echo ""
echo "🚀 Deploying $CONTRACT_NAME to $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK" 2>&1)

echo ""
echo "✅ Deployed!"
echo "   Contract ID: $CONTRACT_ID"

# Initialize
ADMIN_KEY=$(stellar keys address "$IDENTITY" 2>/dev/null || echo "")
if [[ -n "$ADMIN_KEY" ]]; then
  echo ""
  echo "🔧 Initializing $CONTRACT_NAME with admin: $ADMIN_KEY"
  if [[ "$CONTRACT_NAME" == "marketpay-contract" ]]; then
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --source "$IDENTITY" \
      --network "$NETWORK" \
      -- \
      initialize \
      --admin "$ADMIN_KEY" \
      --treasury_address "$ADMIN_KEY" \
      --version "$VERSION"
    echo "   ✅ Initialized marketpay-contract"
  elif [[ "$CONTRACT_NAME" == "arbitrator-registry" ]]; then
    # Arbitrator registry initialization requires admin, min_stake, default_voting_period_ledgers
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --source "$IDENTITY" \
      --network "$NETWORK" \
      -- \
      initialize \
      --admin "$ADMIN_KEY" \
      --min_stake 100000000 \
      --default_voting_period_ledgers 17280 || echo "⚠️ Could not auto-initialize arbitrator-registry; please invoke initialize manually if needed."
  fi
fi

echo ""
echo "────────────────────────────────────────────"
echo "  Add to your .env files:"
if [[ "$CONTRACT_NAME" == "marketpay-contract" ]]; then
  echo "  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
  echo "  CONTRACT_ID=$CONTRACT_ID"
elif [[ "$CONTRACT_NAME" == "arbitrator-registry" ]]; then
  echo "  ARBITRATOR_REGISTRY_CONTRACT_ID=$CONTRACT_ID"
  echo "  NEXT_PUBLIC_ARBITRATOR_REGISTRY_CONTRACT_ID=$CONTRACT_ID"
fi
echo "────────────────────────────────────────────"
