# ADR-001: Soroban Smart Contract for Escrow Management

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, Smart Contract Team

## Context

Stellar MarketPay requires a secure, trustless payment mechanism for freelance work. The platform needs to:

- Lock client funds when a job is posted
- Release funds only when work is approved
- Handle refunds if work is not completed
- Prevent double-spending and unauthorized access
- Minimize transaction costs

## Decision

We will implement escrow management using **Soroban smart contracts** (Rust/WASM) deployed on the Stellar testnet, with the following architecture:

### Contract Design

```rust
pub fn create_escrow(
    env: Env,
    job_id: String,
    client: Address,
    amount: i128,
) -> Result<(), Error>

pub fn start_work(
    env: Env,
    job_id: String,
    freelancer: Address,
) -> Result<(), Error>

pub fn release_escrow(
    env: Env,
    job_id: String,
    client: Address,
) -> Result<(), Error>

pub fn refund_escrow(
    env: Env,
    job_id: String,
    client: Address,
) -> Result<(), Error>
```

### Key Features

1. **Atomic Operations**: All escrow state changes are atomic and cannot be partially executed
2. **Access Control**: Only authorized parties (client, freelancer, admin) can trigger state transitions
3. **Timeout Refunds**: Automatic refunds after inactivity period (configurable)
4. **Event Logging**: All escrow events are emitted for off-chain indexing
5. **Multi-Asset Support**: Supports XLM and other Stellar assets

### State Machine

```
CREATED → IN_PROGRESS → COMPLETED → RELEASED
   ↓          ↓              ↓
   └─────────→ REFUNDED ←────┘
```

## Rationale

### Why Soroban?

- **Native to Stellar**: Seamless integration with Stellar network
- **Low Fees**: Significantly cheaper than Ethereum-based alternatives
- **Deterministic**: Predictable execution and costs
- **Rust/WASM**: Type-safe, auditable smart contracts
- **Testnet Ready**: Mature testnet environment for development

### Why Not Alternatives?

- **Ethereum**: Higher gas fees, different ecosystem
- **Payment Channels**: Overkill for this use case, adds complexity
- **Centralized Escrow**: Requires trust in platform, defeats purpose of blockchain

## Consequences

### Positive

- ✅ Trustless payment mechanism
- ✅ Transparent transaction history on-chain
- ✅ Reduced platform liability
- ✅ Automatic refunds prevent disputes
- ✅ Low transaction costs

### Negative

- ❌ Requires Soroban RPC infrastructure
- ❌ Contract audits needed for security
- ❌ Testnet limitations (no mainnet yet)
- ❌ Learning curve for Rust/WASM development

## Implementation Details

### Contract Deployment

1. Write contract in Rust using `soroban-sdk`
2. Compile to WASM
3. Deploy to Stellar testnet via CLI
4. Store contract ID in environment variables
5. Update frontend with contract address

### Backend Integration

- Store escrow state in PostgreSQL for quick queries
- Index contract events via Horizon API
- Implement timeout refund service (cron job)
- Emit notifications on state changes

### Frontend Integration

- Build transaction XDR in `lib/stellar.ts`
- Sign via Freighter wallet
- Submit to Soroban RPC
- Poll for confirmation
- Display transaction history with explorer links

## Related ADRs

- ADR-002: Horizon API for Transaction Indexing
- ADR-003: Backend Database Schema for Escrow State

## References

- [Soroban Documentation](https://soroban.stellar.org)
- [Stellar Smart Contracts](https://developers.stellar.org/docs/learn/smart-contracts)
- [Freighter Wallet Integration](https://freighter.app)
