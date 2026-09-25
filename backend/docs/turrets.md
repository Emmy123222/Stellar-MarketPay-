# Stellar Turrets Documentation

## What Are Turrets?

Stellar Turrets are trustless, server-side functions that allow transactions to be signed without a private key stored on the client. They enable keyless escrow operations where a backend service can authorize and sign transactions on behalf of an escrow account, without exposing the signing key to the frontend or end users.

## Why Use Turrets?

- **Keyless escrow**: The escrow signing key never leaves the server, eliminating the risk of client-side key exposure.
- **Trustless execution**: Transactions are signed in a deterministic, auditable way on the server side.
- **Authorization**: Only pre-authorized escrow accounts can request signatures, preventing misuse.
- **Key rotation**: The signing key can be rotated server-side without client changes.

## API Endpoints

### POST /api/turrets/sign

Signs a transaction XDR using the turret signing key. Only authorized escrow transactions are accepted.

**Request body:**

```json
{
  "transactionXDR": "AAAA...",
  "escrowId": "GC..."
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "signedXDR": "AAAA...",
    "escrowId": "GC...",
    "turretUsed": true,
    "message": "Transaction signed by turret for authorized escrow"
  }
}
```

**Error responses:**

- `400`: Missing `transactionXDR`
- `403`: Unauthorized escrow ID
- `500`: Turret signing key not configured or signing failure

### Configuration

The turret signing key is loaded from the `ESCROW_SECRET_KEY` or `TURRET_SIGNING_KEY` environment variable. Only escrow accounts matching the `ALLOWED_ESCROW_PREFIX` (default: `GC`) are authorized.

## Security

- The signing key is stored in an environment variable or Hardware Security Module (HSM).
- The `isAuthorizedEscrow()` function validates the escrow ID before signing.
- Rate limiting is applied to all turret endpoints (10 requests per minute).