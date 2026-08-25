# ADR-003: Database Schema for Escrow State Management

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Database Team

## Context

Stellar MarketPay needs to maintain off-chain state for escrow management to:

- Track escrow status without querying smart contract every time
- Enable fast queries for dashboard and analytics
- Support dispute resolution
- Maintain audit trail
- Handle edge cases (timeouts, refunds)

## Decision

We will maintain a PostgreSQL schema with the following tables:

### Core Tables

#### `escrows`

```sql
CREATE TABLE escrows (
  id UUID PRIMARY KEY,
  job_id VARCHAR(255) NOT NULL UNIQUE,
  client_address VARCHAR(56) NOT NULL,
  freelancer_address VARCHAR(56),
  amount_xlm DECIMAL(20, 7) NOT NULL,
  currency VARCHAR(10) DEFAULT 'XLM',
  status VARCHAR(50) NOT NULL, -- created, in_progress, completed, released, refunded, disputed
  contract_tx_hash VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  released_at TIMESTAMP,
  refunded_at TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX idx_escrows_client ON escrows(client_address);
CREATE INDEX idx_escrows_freelancer ON escrows(freelancer_address);
CREATE INDEX idx_escrows_status ON escrows(status);
```

#### `escrow_events`

```sql
CREATE TABLE escrow_events (
  id UUID PRIMARY KEY,
  escrow_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- created, started, released, refunded, disputed
  tx_hash VARCHAR(64),
  actor_address VARCHAR(56),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (escrow_id) REFERENCES escrows(id)
);

CREATE INDEX idx_escrow_events_escrow ON escrow_events(escrow_id);
CREATE INDEX idx_escrow_events_type ON escrow_events(event_type);
```

#### `escrow_disputes`

```sql
CREATE TABLE escrow_disputes (
  id UUID PRIMARY KEY,
  escrow_id UUID NOT NULL,
  initiator_address VARCHAR(56) NOT NULL,
  reason TEXT,
  evidence_ipfs_hash VARCHAR(255),
  status VARCHAR(50) DEFAULT 'open', -- open, resolved, closed
  resolution TEXT,
  resolved_by VARCHAR(56),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  FOREIGN KEY (escrow_id) REFERENCES escrows(id)
);

CREATE INDEX idx_disputes_escrow ON escrow_disputes(escrow_id);
CREATE INDEX idx_disputes_status ON escrow_disputes(status);
```

## Rationale

### Why This Schema?

- **Normalized Design**: Separates concerns (escrow state, events, disputes)
- **Audit Trail**: Events table provides complete history
- **Fast Queries**: Indexed on common filters (status, addresses)
- **Extensible**: JSONB metadata for future fields
- **Consistency**: Foreign keys ensure referential integrity

### Why Not Alternatives?

- **Single Table**: Would become unwieldy with events and disputes
- **NoSQL**: Loses ACID guarantees needed for financial data
- **Event Sourcing Only**: Requires replaying events for current state

## Consequences

### Positive

- ✅ Fast queries for dashboard
- ✅ Complete audit trail
- ✅ Supports dispute resolution
- ✅ Enables analytics and reporting
- ✅ ACID compliance for financial data

### Negative

- ❌ Requires migration management
- ❌ Must keep in sync with smart contract
- ❌ Additional storage overhead
- ❌ Complexity in state reconciliation

## Implementation Details

### State Transitions

```
CREATED (client funds locked)
   ↓
IN_PROGRESS (freelancer starts work)
   ↓
COMPLETED (work submitted)
   ↓
RELEASED (client approves, funds transferred)

OR

REFUNDED (timeout or client cancels)
```

### Sync Strategy

1. **On-Chain Event**: Smart contract emits event
2. **Indexer**: Horizon API detects event
3. **Backend**: Updates escrow status in DB
4. **Notification**: Emit WebSocket event to frontend
5. **Frontend**: Update UI in real-time

### Timeout Handling

```javascript
// Cron job runs every 5 minutes
SELECT * FROM escrows
WHERE status = 'in_progress'
AND updated_at < NOW() - INTERVAL '30 days'
AND released_at IS NULL;

// Trigger refund for each
```

### Dispute Resolution

1. Initiator creates dispute with evidence (IPFS hash)
2. Admin reviews evidence
3. Admin resolves with decision (release or refund)
4. System executes resolution on-chain

## Related ADRs

- ADR-001: Soroban Smart Contract for Escrow Management
- ADR-002: Horizon API for Transaction Indexing

## References

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [JSONB in PostgreSQL](https://www.postgresql.org/docs/current/datatype-json.html)
- [Database Indexing Best Practices](https://use-the-index-luke.com/)
