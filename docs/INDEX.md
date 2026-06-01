# Documentation Index

Welcome to Stellar MarketPay documentation. This index helps you find what you need.

---

## 🚀 Getting Started

**New to Stellar MarketPay?** Start here:

- **[Quick Start Guide](../QUICK_START_NEW_FEATURES.md)** - Get up and running with new features
- **[Getting Started](./getting-started.md)** - Initial setup and installation
- **[README](../README.md)** - Project overview and features

---

## 📚 Core Documentation

### Architecture & Design

- **[Architecture Overview](./architecture.md)** - System design and components
- **[Deployment Guide](./deployment.md)** - How to deploy Stellar MarketPay
- **[Soroban Contract Deployment](./contract-deployment.md)** - Build, deploy, and configure the escrow contract
- **[Environment Variables](./environment-variables.md)** - Single source of truth for runtime config

### API Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - REST API endpoints
- **[API Reference](./api.md)** - Detailed API reference
- **[Scope WebSocket Protocol](./websocket-scope-protocol.md)** - Realtime session protocol and client schema

---

## 🏗️ Architecture Decision Records (ADRs)

Decisions that shaped Stellar MarketPay's architecture:

### ADR-001: Soroban Smart Contract for Escrow Management

**File**: [ADR-001-soroban-escrow-design.md](./ADR-001-soroban-escrow-design.md)

**Decision**: Use Soroban smart contracts for trustless escrow management

**Key Points**:

- Why Soroban was chosen over alternatives
- Contract design and state machine
- Key features (atomic operations, access control, timeouts)
- Implementation details

**Status**: ✅ Accepted

---

### ADR-002: Horizon API for Transaction Indexing

**File**: [ADR-002-horizon-api-indexing.md](./ADR-002-horizon-api-indexing.md)

**Decision**: Use Horizon REST API as primary transaction data source

**Key Points**:

- Why Horizon API was chosen
- Architecture (Frontend → Backend → Horizon → Stellar)
- Implementation approach
- Caching strategy
- Error handling

**Status**: ✅ Accepted

---

### ADR-003: Database Schema for Escrow State Management

**File**: [ADR-003-database-schema-escrow.md](./ADR-003-database-schema-escrow.md)

**Decision**: Maintain off-chain escrow state in PostgreSQL

**Key Points**:

- PostgreSQL schema design
- Tables: escrows, escrow_events, escrow_disputes
- State transitions and lifecycle
- Sync strategy with smart contracts
- Timeout handling

**Status**: ✅ Accepted

---

## ❓ FAQ & Help

### Frequently Asked Questions

**File**: [FAQ.md](./FAQ.md)

**Coverage**: 50+ questions across 10 categories

**Categories**:

1. General Questions - What is MarketPay, how is it different?
2. Getting Started - Sign up, fund account, install Freighter
3. For Clients - Post jobs, manage funds, approve work
4. For Freelancers - Find jobs, submit proposals, get paid
5. Transactions & Payments - View history, understand fees
6. Disputes & Refunds - Open disputes, provide evidence
7. Technical Questions - Smart contracts, IPFS, wallets
8. Troubleshooting - Common issues and solutions
9. Support & Community - Contact support, contribute
10. Legal & Compliance - Regulations, taxes, privacy

**Quick Links**:

- [How do I post a job?](./FAQ.md#how-do-i-post-a-job)
- [When do I get paid?](./FAQ.md#when-do-i-get-paid)
- [Is it safe?](./FAQ.md#is-stellar-marketpay-safe)
- [What are transaction fees?](./FAQ.md#what-are-transaction-fees)

---

## 📦 Setup Guides

### Pinata IPFS Setup for Dispute Evidence

**File**: [PINATA_IPFS_SETUP.md](./PINATA_IPFS_SETUP.md)

**Purpose**: Store dispute evidence on decentralized IPFS network

**Sections**:

1. Overview - What is IPFS, Pinata, why use it
2. Create Pinata Account
3. Generate API Keys
4. Install Pinata SDK
5. Implement File Upload
6. Backend Integration
7. Access Evidence Files
8. Testing
9. Production Deployment
10. Troubleshooting
11. Best Practices

**Code Examples**:

- `frontend/lib/pinata.ts` - Upload service
- `frontend/components/DisputeEvidenceUpload.tsx` - Upload component
- `backend/src/routes/disputes.js` - Backend endpoints
- Database schema for disputes

---

### Private Message Encryption

**File**: [messaging-encryption.md](./messaging-encryption.md)

**Purpose**: Documents the client-side encryption contract for private job messages and the nonce uniqueness requirement.

---

## 🎯 Feature Documentation

### Transaction History Page

**Location**: `/dashboard/transactions`

**Features**:

- Real-time transaction fetching from Stellar Horizon API
- Advanced filtering (all, sent, received, escrow)
- Cursor-based pagination
- Transaction type detection with icons
- Direct links to Stellar Expert explorer
- Responsive design with loading states

**Code**:

- `frontend/lib/stellar.ts` - Transaction functions
- `frontend/pages/dashboard/transactions.tsx` - Page component

**Related**:

- [ADR-002: Horizon API Indexing](./ADR-002-horizon-api-indexing.md)
- [FAQ: Transaction History](./FAQ.md#how-do-i-view-my-transaction-history)

---

## 📋 Implementation Guides

### Implementation Summary

**File**: [../IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md)

**Contents**:

- Overview of all 4 features
- Detailed implementation for each feature
- Integration checklist
- File structure
- Next steps and roadmap
- References and support

---

### Quick Start for New Features

**File**: [../QUICK_START_NEW_FEATURES.md](../QUICK_START_NEW_FEATURES.md)

**Contents**:

- Quick reference for each feature
- How to use each feature
- Code locations
- Testing instructions
- Troubleshooting tips
- Implementation checklist

---

## 🔗 Related Documentation

### Project Documentation

- **[README](../README.md)** - Project overview
- **[ROADMAP](../ROADMAP.md)** - Feature roadmap
- **[CONTRIBUTING](../CONTRIBUTING.md)** - Contribution guidelines
- **[TODO](../TODO.md)** - Outstanding tasks

### External Resources

- **[Stellar Documentation](https://developers.stellar.org)** - Official Stellar docs
- **[Soroban Smart Contracts](https://soroban.stellar.org)** - Soroban documentation
- **[Horizon API](https://developers.stellar.org/api)** - Horizon API reference
- **[Pinata Documentation](https://docs.pinata.cloud)** - Pinata docs
- **[IPFS Documentation](https://docs.ipfs.io)** - IPFS docs

---

## 📁 Documentation Structure

```
stellar-marketpay/
├── docs/
│   ├── INDEX.md (this file)
│   ├── ADR-001-soroban-escrow-design.md
│   ├── ADR-002-horizon-api-indexing.md
│   ├── ADR-003-database-schema-escrow.md
│   ├── FAQ.md
│   ├── PINATA_IPFS_SETUP.md
│   ├── architecture.md
│   ├── API_DOCUMENTATION.md
│   ├── api.md
│   ├── deployment.md
│   └── getting-started.md
├── IMPLEMENTATION_SUMMARY.md
├── QUICK_START_NEW_FEATURES.md
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
└── TODO.md
```

---

## 🎓 Learning Paths

### For Clients

1. [Getting Started](./getting-started.md)
2. [FAQ: For Clients](./FAQ.md#for-clients)
3. [FAQ: Transactions & Payments](./FAQ.md#transactions--payments)
4. [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)

### For Freelancers

1. [Getting Started](./getting-started.md)
2. [FAQ: For Freelancers](./FAQ.md#for-freelancers)
3. [FAQ: Transactions & Payments](./FAQ.md#transactions--payments)
4. [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)

### For Developers

1. [Architecture Overview](./architecture.md)
2. [ADR-001: Escrow Design](./ADR-001-soroban-escrow-design.md)
3. [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
4. [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
5. [API Documentation](./API_DOCUMENTATION.md)
6. [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
7. [Deployment Guide](./deployment.md)

### For DevOps/Infrastructure

1. [Deployment Guide](./deployment.md)
2. [Architecture Overview](./architecture.md)
3. [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
4. [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)

---

## 🔍 Quick Search

### By Topic

**Blockchain & Stellar**

- [ADR-001: Soroban Escrow](./ADR-001-soroban-escrow-design.md)
- [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
- [FAQ: Technical Questions](./FAQ.md#technical-questions)

**Database & Backend**

- [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Deployment Guide](./deployment.md)

**Frontend & UI**

- [Transaction History](./FAQ.md#how-do-i-view-my-transaction-history)
- [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
- [Architecture Overview](./architecture.md)

**User Guides**

- [FAQ](./FAQ.md)
- [Getting Started](./getting-started.md)
- [Quick Start](../QUICK_START_NEW_FEATURES.md)

**Disputes & Evidence**

- [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
- [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)
- [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)

---

## 📞 Support & Contact

### Getting Help

- **GitHub Issues**: [stellar-marketpay/issues](https://github.com/stellar-marketpay/issues)
- **Discord**: [Stellar MarketPay Community](https://discord.gg/stellar-marketpay)
- **Email**: support@stellar-marketpay.com
- **Twitter**: [@StellarMarketPay](https://twitter.com/StellarMarketPay)

### Contributing

- See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines
- Check [TODO.md](../TODO.md) for outstanding tasks
- Review [ROADMAP.md](../ROADMAP.md) for planned features

---

## 📝 Document Maintenance

### Last Updated

- **Date**: May 28, 2026
- **Version**: 1.0
- **Status**: ✅ Complete

### Recent Additions

- ✅ ADR-001: Soroban Escrow Design
- ✅ ADR-002: Horizon API Indexing
- ✅ ADR-003: Database Schema
- ✅ FAQ: 50+ Questions
- ✅ Pinata IPFS Setup Guide
- ✅ Implementation Summary
- ✅ Quick Start Guide

### Planned Updates

- [ ] Video tutorials
- [ ] Interactive examples
- [ ] Multi-language translations
- [ ] Community contributions guide
- [ ] Advanced topics section

---

## 🎯 Next Steps

1. **Choose your role**: Client, Freelancer, or Developer
2. **Follow the learning path** for your role
3. **Read the FAQ** for common questions
4. **Check the guides** for specific tasks
5. **Contact support** if you need help

---

**Happy learning! 🚀**

For the latest updates, visit [stellar-marketpay.com](https://stellar-marketpay.com)
