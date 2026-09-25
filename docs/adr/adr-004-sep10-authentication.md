# ADR-004: SEP-10 vs OAuth for Authentication

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, Security Team

## Context

Stellar MarketPay requires a secure authentication mechanism for users to access protected API endpoints. The platform needs to:

- Verify user identity without storing passwords
- Support wallet-based authentication (Freighter)
- Issue session tokens for API access
- Maintain compatibility with Stellar ecosystem
- Minimize security attack surface
- Provide a seamless user experience

Traditional web applications use OAuth 2.0 or session-based authentication, but blockchain applications have unique requirements around wallet ownership proof.

## Decision

We will implement **SEP-10 (Stellar Web Authentication)** as the primary authentication mechanism, with the following architecture:

### SEP-10 Challenge-Response Flow

1. **Challenge Request**: Client requests a challenge transaction for their Stellar address
2. **Challenge Generation**: Server generates an unsigned transaction with a random nonce
3. **Wallet Signing**: User signs the transaction with Freighter wallet (proves ownership)
4. **Verification**: Server verifies the signature against the Stellar network
5. **Token Issuance**: Server issues a short-lived JWT (1 hour expiry)

### Implementation

```javascript
// Challenge endpoint
GET /api/auth?account=GXXXXXX...
Response: { transaction: "base64_encoded_xdr" }

// Verification endpoint
POST /api/auth
Body: { signedXdr: "base64_encoded_signed_xdr" }
Response: { token: "jwt_token" }

// JWT Claims
{
  sub: "GXXXXXX...", // Stellar public key
  iat: 1234567890,
  exp: 1234571490   // 1 hour later
}
```

### Key Features

- **Password-less**: No credential storage or management
- **Wallet-Native**: Integrates directly with Freighter
- **Cryptographic Proof**: Signature proves private key ownership
- **Stateless**: JWT contains all necessary claims
- **Short-lived**: Tokens expire after 1 hour
- **Revocable**: Can implement token blacklist if needed

## Rationale

### Why SEP-10?

- **Stellar Standard**: Official protocol designed for Stellar authentication
- **No Credential Storage**: Server never sees or stores private keys
- **Blockchain-Native**: Identity is the Stellar address itself
- **Secure**: Uses cryptographic signatures for verification
- **Simple Implementation**: Well-documented with SDK support
- **Ecosystem Compatibility**: Works with all Stellar wallets
- **No Third-Party Dependencies**: No OAuth provider needed

### Why Not OAuth 2.0?

OAuth 2.0 was considered but rejected for the following reasons:

- **Requires Identity Provider**: Would need to run our own OAuth server or use Google/GitHub
- **External Dependency**: Ties authentication to third-party availability
- **Additional Accounts**: Users would need separate account creation
- **Not Blockchain-Native**: Doesn't prove wallet ownership
- **Complexity**: OAuth flows are more complex than SEP-10
- **Privacy Concerns**: Third-party providers track user data

### Why Not Username/Password?

Traditional password authentication was rejected because:

- **Security Burden**: Requires secure password storage (hashing, salting)
- **Account Management**: Password reset, email verification, etc.
- **User Friction**: Users must create and remember passwords
- **Not Wallet-Proof**: Doesn't verify blockchain wallet ownership
- **Attack Surface**: Vulnerable to credential stuffing, phishing

### Why Not Magic Links?

Email-based magic links were considered but rejected:

- **Email Dependency**: Requires email infrastructure
- **Latency**: Slower authentication flow
- **Spam/Deliverability**: Email may not arrive
- **Not Wallet-Proof**: Email ownership ≠ wallet ownership

## Consequences

### Positive

- ✅ Zero password management overhead
- ✅ Cryptographically secure authentication
- ✅ Seamless integration with Stellar wallets
- ✅ No user registration required
- ✅ Privacy-preserving (no email/PII needed)
- ✅ Compatible with decentralized identity standards
- ✅ Reduced attack surface
- ✅ Fast authentication flow (~2-3 seconds)

### Negative

- ❌ Requires Freighter wallet installation
- ❌ Limited to Stellar ecosystem users
- ❌ No social login options
- ❌ Users unfamiliar with blockchain may be confused
- ❌ Cannot authenticate without wallet access
- ❌ JWT revocation requires additional infrastructure

## Implementation Details

### Challenge Transaction Structure

```javascript
Transaction {
  source: serverPublicKey,
  operations: [
    ManageData {
      name: "auth",
      value: randomNonce(64 bytes)
    }
  ],
  timeBounds: {
    minTime: now,
    maxTime: now + 300 seconds
  },
  memo: Memo.text(homeDomain)
}
```

### Security Measures

1. **Nonce Uniqueness**: Each challenge uses a unique random nonce
2. **Time Bounds**: Challenges expire after 5 minutes
3. **Domain Verification**: Memo includes home domain
4. **Signature Verification**: Uses Stellar SDK to verify signatures
5. **JWT Expiry**: Tokens expire after 1 hour
6. **HTTPS Only**: All auth endpoints require HTTPS in production
7. **Rate Limiting**: Challenge endpoint limited to 10 requests/minute per IP

### Token Storage

- **Frontend**: Store JWT in `httpOnly` cookie (recommended) or `localStorage`
- **Backend**: Stateless verification using JWT secret
- **Refresh**: Re-run SEP-10 flow when token expires

### Multi-Device Support

Users can authenticate on multiple devices by signing challenges on each device. No special handling required as authentication is stateless.

### Token Revocation

If needed, implement token blacklist:

```sql
CREATE TABLE revoked_tokens (
  jti UUID PRIMARY KEY,
  revoked_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_revoked_at ON revoked_tokens(revoked_at);
```

## Future Considerations

### WebAuthn as Secondary Factor

For enhanced security, we may add WebAuthn (biometric/hardware key) as a secondary authentication factor (see ADR-007).

### Refresh Tokens

Currently, tokens expire after 1 hour and users must re-authenticate. Future versions may implement refresh tokens for longer sessions.

### Multi-Wallet Support

Future versions may support other Stellar wallets (Albedo, Rabet, Lobstr) by detecting available wallet providers.

## Related ADRs

- ADR-007: WebAuthn as Secondary Authentication
- ADR-001: Soroban Smart Contract for Escrow Management

## References

- [SEP-10 Specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
- [Stellar SDK Authentication Utilities](https://stellar.github.io/js-stellar-sdk/Server.html)
- [Freighter Wallet Documentation](https://docs.freighter.app/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
