#!/usr/bin/env bash
# scripts/setup-dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  🏪 Stellar MarketPay — Dev Setup"
echo "  ──────────────────────────────────"
echo ""

# Node check
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
echo "✅ Node.js $(node --version)"

# Frontend
echo ""
echo "📦 Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install
[[ ! -f ".env.local" ]] && cp .env.example .env.local && echo "   Created frontend/.env.local" || echo "   frontend/.env.local already exists"

# Backend
echo ""
echo "📦 Installing backend dependencies..."
cd "$ROOT/backend"
npm install
[[ ! -f ".env" ]] && cp .env.example .env && echo "   Created backend/.env" || echo "   backend/.env already exists"

# Rust check
echo ""
if command -v cargo &>/dev/null; then
  echo "✅ $(rustc --version)"
  rustup target list --installed | grep -q "wasm32-unknown-unknown" \
    && echo "✅ wasm32-unknown-unknown target installed" \
    || (rustup target add wasm32-unknown-unknown && echo "✅ Added wasm32-unknown-unknown")
else
  echo "⚠️  Rust not found — smart contract development unavailable."
  echo "   Install: https://rustup.rs"
fi

echo ""
echo "  ──────────────────────────────────"
echo "  ✅ Setup complete!"
echo ""
echo "  Terminal 1 (frontend):  cd frontend && npm run dev"
echo "  Terminal 2 (backend):   cd backend  && npm run dev"
echo ""
echo "  Frontend → http://localhost:3000"
echo "  Backend  → http://localhost:4000"
echo ""
echo "  Get testnet XLM: https://friendbot.stellar.org"
echo "  Freighter wallet: https://freighter.app"
echo "  ──────────────────────────────────"
echo ""
