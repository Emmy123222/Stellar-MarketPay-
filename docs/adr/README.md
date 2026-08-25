# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for Stellar MarketPay. ADRs document significant architectural decisions made during the development of the platform.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision along with its context and consequences. Each ADR describes:

- **Context**: The issue motivating the decision
- **Decision**: The chosen solution
- **Rationale**: Why this decision was made (alternatives considered)
- **Consequences**: Positive and negative impacts

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](../ADR-001-soroban-escrow-design.md) | Soroban Smart Contract for Escrow Management | Accepted | 2026-05-28 |
| [ADR-002](../ADR-002-horizon-api-indexing.md) | Horizon API for Transaction Indexing | Accepted | 2026-05-28 |
| [ADR-003](../ADR-003-database-schema-escrow.md) | Database Schema for Escrow State Management | Accepted | 2026-05-28 |
| [ADR-004](../ADR-004-sep10-authentication.md) | SEP-10 vs OAuth for Authentication | Accepted | 2026-05-28 |
| [ADR-005](../ADR-005-nacl-message-encryption.md) | NaCl Box Encryption for Private Messages | Accepted | 2026-05-28 |
| [ADR-006](../ADR-006-ipfs-dispute-evidence.md) | IPFS for Dispute Evidence Storage | Accepted | 2026-05-28 |
| [ADR-007](../ADR-007-webauthn-secondary-auth.md) | WebAuthn as Secondary Authentication | Accepted | 2026-05-28 |
| [ADR-008](../ADR-008-redis-session-cache.md) | Redis for Session and Cache Management | Accepted | 2026-05-28 |
| [ADR-009](../ADR-009-websocket-vs-sse.md) | WebSocket vs SSE for Real-Time Updates | Accepted | 2026-05-28 |
| [ADR-010](../ADR-010-cursor-pagination.md) | Cursor-Based Pagination | Accepted | 2026-05-28 |

## ADR Categories

### Blockchain & Smart Contracts
- **ADR-001**: Soroban escrow implementation
- **ADR-002**: Horizon API for blockchain indexing
- **ADR-003**: Database schema for escrow state

### Authentication & Security
- **ADR-004**: SEP-10 wallet-based authentication
- **ADR-005**: End-to-end message encryption
- **ADR-007**: WebAuthn 2FA implementation

### Storage & Infrastructure
- **ADR-006**: IPFS for dispute evidence
- **ADR-008**: Redis for caching and sessions

### Real-Time & API Design
- **ADR-009**: WebSocket for real-time updates
- **ADR-010**: Cursor-based pagination strategy

## ADR Template

When creating a new ADR, follow this structure:

```markdown
# ADR-XXX: [Short Title]

**Status:** [Proposed | Accepted | Deprecated | Superseded]  
**Date:** YYYY-MM-DD  
**Author:** [Name or Team]  
**Stakeholders:** [Teams/Individuals affected]

## Context

[Describe the issue or problem that requires a decision]

## Decision

[Describe the decision and how it will be implemented]

## Rationale

### Why [Chosen Solution]?

[Explain why this solution was chosen]

### Why Not [Alternative 1]?

[Explain why this alternative was rejected]

### Why Not [Alternative 2]?

[Explain why this alternative was rejected]

## Consequences

### Positive

- ✅ [Positive consequence 1]
- ✅ [Positive consequence 2]

### Negative

- ❌ [Negative consequence 1]
- ❌ [Negative consequence 2]

## Implementation Details

[Technical implementation details, code examples, configurations]

## Future Considerations

[Potential future changes or improvements]

## Related ADRs

- [Related ADR 1]
- [Related ADR 2]

## References

- [External documentation]
- [Research papers]
- [Blog posts]
```

## ADR Lifecycle

1. **Proposed**: Initial draft under review
2. **Accepted**: Decision has been approved and is being implemented
3. **Deprecated**: No longer relevant but kept for historical context
4. **Superseded**: Replaced by a newer ADR

## Contributing

When making significant architectural decisions:

1. Create a new ADR using the template above
2. Number it sequentially (ADR-011, ADR-012, etc.)
3. Place it in the `docs/` directory
4. Update this index
5. Submit a pull request for review

## Best Practices

- **Keep it concise**: ADRs should be readable in 5-10 minutes
- **Be specific**: Include code examples and technical details
- **Explain alternatives**: Document why other options were rejected
- **Update as needed**: Mark as deprecated or superseded when appropriate
- **Link related ADRs**: Help readers understand the full context

## Questions?

For questions about ADRs or to propose a new one, open an issue or discussion in the GitHub repository.

---

**Last Updated**: 2026-05-28
