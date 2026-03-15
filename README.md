# 🏪 Stellar MarketPay

> A decentralised freelance marketplace powered by Stellar blockchain and Soroban smart contracts.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-purple)](https://soroban.stellar.org)

Stellar MarketPay is an open-source decentralised freelance marketplace where clients post jobs, freelancers apply, and payments are secured in **Soroban smart contract escrow** — released automatically when work is approved. No middlemen. No payment delays. No platform fees eating your earnings.

---

## ✨ Features (v1)

- 🔗 **Wallet Connect** — Freighter browser wallet integration
- 📋 **Post Jobs** — Clients post jobs with XLM budget locked in escrow
- 🙋 **Apply & Bid** — Freelancers apply with proposals
- 🔒 **Escrow Payments** — Funds held in Soroban contract until work approved
- ✅ **Release & Complete** — Client approves → funds released to freelancer instantly
- 📜 **Job History** — Track all your jobs and earnings on-chain

---

## 🗂 Project Structure

```
stellar-marketpay/
├── frontend/          # Next.js + React + Tailwind CSS
├── backend/           # Node.js + Express API
├── contracts/         # Stellar Soroban smart contracts (Rust)
├── docs/              # Architecture & API documentation
├── scripts/           # Deployment & utility scripts
├── .github/           # CI/CD workflows & issue templates
├── CONTRIBUTING.md
├── ROADMAP.md
└── LICENSE
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18.x |
| npm | Latest |
| Rust + Cargo | ≥ 1.74 (for contracts) |
| Freighter Wallet | Browser extension |

### 1. Clone

```bash
git clone https://github.com/your-org/stellar-marketpay.git
cd stellar-marketpay
```

### 2. One-command setup

```bash
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

### 3. Start Frontend

```bash
cd frontend
npm run dev
# → http://localhost:3000
```

### 4. Start Backend

```bash
cd backend
npm run dev
# → http://localhost:4000
```

---

## 🔑 Environment Variables

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CONTRACT_ID=           # Set after deploying contract
```

### Backend (`backend/.env`)
```env
PORT=4000
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=                        # Set after deploying contract
```

---

## 🧪 Get Testnet XLM

1. Install [Freighter Wallet](https://freighter.app)
2. Switch to **Testnet** in Freighter settings
3. Visit [Stellar Friendbot](https://friendbot.stellar.org) with your public key
4. Receive 10,000 test XLM instantly

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. All skill levels welcome!

## 🗺 Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features.

## 📄 License

MIT — see [LICENSE](LICENSE)
