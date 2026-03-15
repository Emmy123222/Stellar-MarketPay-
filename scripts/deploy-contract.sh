#!/usr/bin/env bash
# scripts/deploy-contract.sh
# Build and deploy the MarketPay Soroban escrow contract.
#
# Usage:
#   chmod +x scripts/deploy-contract.sh
#   ./scripts/deploy-contract.sh [testnet|mainnet] [identity]

set -euo pipefail

NETWORK=${1:-testnet}
IDENTITY=${2:-alice}
CONTRACT_DIR="$(dirname "$0")/../contracts/marketpay-contract"
WASM="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/marketpay_contract.wasm"

echo "🏪 Stellar MarketPay — Contract Deploy"
echo "   Network:  $NETWORK"
echo "   Identity: $IDENTITY"
echo ""

command -v stellar &>/dev/null || { echo "❌ stellar CLI not found. Run: cargo install --locked stellar-cli"; exit 1; }
command -v cargo   &>/dev/null || { echo "❌ Rust/Cargo not found. Run: https://rustup.rs"; exit 1; }

# Build
echo "🔨 Building WASM..."
cd "$CONTRACT_DIR"
cargo build --target wasm32-unknown-unknown --release
echo "   ✅ Built: $(du -sh "$WASM" | cut -f1)"

# Deploy
echo ""
echo "🚀 Deploying to $NETWORK..."
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
  echo "🔧 Initializing with admin: $ADMIN_KEY"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- initialize \
    --admin "$ADMIN_KEY"
  echo "   ✅ Initialized"
fi

echo ""
echo "────────────────────────────────────────────"
echo "  Add to your .env files:"
echo "  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
echo "  CONTRACT_ID=$CONTRACT_ID"
echo "────────────────────────────────────────────"
