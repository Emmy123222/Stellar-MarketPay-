# ADR-002: Horizon API for Transaction Indexing

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, DevOps Team

## Context

Stellar MarketPay needs to track and display transaction history for users. The platform must:

- Fetch user transactions efficiently
- Filter by transaction type (sent, received, escrow)
- Support pagination for large transaction lists
- Maintain consistency with on-chain state
- Minimize API calls and latency

## Decision

We will use the **Horizon REST API** as the primary source for transaction data, with the following approach:

### Architecture

```
Frontend
   ↓
Backend API (/api/transactions/:publicKey)
   ↓
Horizon API (horizon-testnet.stellar.org)
   ↓
Stellar Network
```

### Implementation

1. **Frontend**: Call `/api/transactions/:publicKey?limit=20&cursor=...`
2. **Backend**: Query Horizon API for account transactions
3. **Transform**: Convert Horizon transactions to MarketPayTransaction format
4. **Cache**: Optional Redis caching for frequently accessed accounts
5. **Return**: Paginated results with `hasMore` flag

### Horizon Query Pattern

```javascript
server
  .transactions()
  .forAccount(publicKey)
  .limit(20)
  .order("desc")
  .cursor(lastTxId)
  .call();
```

## Rationale

### Why Horizon?

- **Official API**: Maintained by Stellar Development Foundation
- **Real-time Data**: Immediate access to confirmed transactions
- **No Indexing Overhead**: No need to run custom indexer
- **Pagination Support**: Built-in cursor-based pagination
- **Filtering**: Rich query capabilities (account, ledger, operation type)

### Why Not Alternatives?

- **Custom Indexer**: Adds operational complexity, requires maintenance
- **Database-only**: Misses on-chain transactions not recorded in DB
- **Soroban Events**: Limited to contract events, doesn't capture all transactions
- **Blockchain.com API**: Third-party dependency, potential rate limits

## Consequences

### Positive

- ✅ No custom indexing infrastructure
- ✅ Always in sync with Stellar network
- ✅ Minimal backend code
- ✅ Scalable to any number of users
- ✅ Real-time transaction visibility

### Negative

- ❌ Depends on Horizon API availability
- ❌ Network latency for each request
- ❌ Rate limiting on Horizon (100 req/sec)
- ❌ Cannot query historical data before Horizon deployment

## Implementation Details

### Backend Endpoint

```javascript
GET /api/transactions/:publicKey?limit=20&cursor=...

Response:
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "...",
        "hash": "...",
        "ledger": 12345,
        "created_at": "2026-05-28T10:00:00Z",
        "from": "GXXXXXX...",
        "to": "GYYYYYY...",
        "amount": "100.00",
        "asset": "XLM",
        "memo": "job-123",
        "successful": true,
        "marketPayType": "payment"
      }
    ],
    "hasMore": true
  }
}
```

### Caching Strategy

- Cache transactions for 30 seconds per account
- Invalidate cache on new transaction
- Use Redis with TTL for efficiency

### Error Handling

- Graceful fallback if Horizon is unavailable
- Retry with exponential backoff
- Return cached data if available
- User-friendly error messages

## Related ADRs

- ADR-001: Soroban Smart Contract for Escrow Management
- ADR-003: Backend Database Schema for Escrow State

## References

- [Horizon API Documentation](https://developers.stellar.org/api/introduction/index/)
- [Stellar Transactions](https://developers.stellar.org/docs/learn/fundamentals/transactions)
- [Pagination in Horizon](https://developers.stellar.org/api/introduction/pagination/)
