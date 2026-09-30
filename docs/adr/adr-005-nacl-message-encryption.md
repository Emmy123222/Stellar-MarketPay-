# ADR-005: NaCl Box Encryption for Private Messages

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, Security Team

## Context

Stellar MarketPay allows clients and freelancers to exchange private messages about job details, proposals, and work progress. The platform needs to:

- Protect message content from server access
- Ensure end-to-end encryption between parties
- Prevent message tampering or replay attacks
- Support forward secrecy
- Maintain message integrity
- Scale to thousands of concurrent conversations

Traditional approaches either store plaintext (insecure) or encrypt server-side (server can decrypt). For a trust-minimized platform, messages must be encrypted client-side so the server never sees plaintext.

## Decision

We will implement **client-side end-to-end encryption** using **NaCl box** (Curve25519-XSalsa20-Poly1305) with the following architecture:

### Encryption Scheme

**Algorithm**: `crypto_box` from TweetNaCl.js (JavaScript) / libsodium (other languages)

**Key Agreement**: X25519 (Elliptic Curve Diffie-Hellman)  
**Cipher**: XSalsa20 (stream cipher)  
**Authentication**: Poly1305 (MAC)  
**Nonce**: 24 bytes, randomly generated per message

### Message Flow

```
1. Sender generates 24-byte random nonce
2. Sender encrypts plaintext with:
   - Their private key
   - Recipient's public key
   - Random nonce
3. Sender uploads:
   - ciphertext
   - nonce
   - sender public key
   - recipient public key
4. Server stores opaque ciphertext (never decrypts)
5. Recipient downloads and decrypts with:
   - Their private key
   - Sender's public key
   - Original nonce
```

### Database Schema

```sql
CREATE TABLE private_messages (
  id UUID PRIMARY KEY,
  sender_address VARCHAR(56) NOT NULL,
  recipient_address VARCHAR(56) NOT NULL,
  sender_public_key VARCHAR(64) NOT NULL,
  recipient_public_key VARCHAR(64) NOT NULL,
  nonce VARCHAR(48) NOT NULL UNIQUE, -- Base64-encoded 24 bytes
  cipher_text TEXT NOT NULL,         -- Base64-encoded ciphertext
  created_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE INDEX idx_messages_sender ON private_messages(sender_address);
CREATE INDEX idx_messages_recipient ON private_messages(recipient_address);
CREATE UNIQUE INDEX idx_messages_nonce ON private_messages(nonce);
```

### Client Implementation

```typescript
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Encrypt message
function encryptMessage(
  plaintext: string,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(plaintext);
  
  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderPrivateKey
  );
  
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

// Decrypt message
function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): string {
  const decrypted = nacl.box.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    senderPublicKey,
    recipientPrivateKey
  );
  
  if (!decrypted) throw new Error('Decryption failed');
  
  return new TextDecoder().decode(decrypted);
}
```

## Rationale

### Why NaCl Box?

- **Proven Security**: Designed by Daniel J. Bernstein (renowned cryptographer)
- **Authenticated Encryption**: Built-in message authentication (no separate HMAC)
- **Elliptic Curve**: Efficient 256-bit security with small keys
- **Simple API**: Single function call for encryption/decryption
- **No Configuration**: Secure defaults, no cipher selection pitfalls
- **Cross-Platform**: Implementations in JS, Python, Go, Rust, etc.
- **Battle-Tested**: Used by Signal, WireGuard, and other security-critical systems

### Why Not Alternatives?

#### AES-GCM

- **Pros**: Industry standard, hardware acceleration
- **Cons**: Requires careful IV management, nonce reuse catastrophic, more complex API

#### RSA + AES

- **Pros**: Traditional hybrid encryption
- **Cons**: Larger keys, slower, more complex key management, outdated

#### Signal Protocol

- **Pros**: Double ratchet, forward secrecy per message
- **Cons**: Overkill for this use case, requires persistent state, complex implementation

#### TLS/HTTPS Only

- **Pros**: Simple, encrypts in transit
- **Cons**: Server can read messages, no end-to-end encryption

### Why X25519 (Curve25519)?

- **Modern ECC**: Faster and more secure than NIST curves
- **Side-Channel Resistant**: Designed to prevent timing attacks
- **Compact Keys**: 32 bytes vs 256+ for RSA
- **No Patent Issues**: Public domain implementation

## Consequences

### Positive

- ✅ **End-to-End Encryption**: Server cannot read message content
- ✅ **Message Integrity**: Poly1305 MAC prevents tampering
- ✅ **Replay Protection**: Unique nonce per message
- ✅ **Simple Implementation**: Single library (TweetNaCl)
- ✅ **Cross-Platform**: Works in browsers, mobile, backend
- ✅ **No Key Distribution**: Uses Stellar public keys
- ✅ **Regulatory Compliance**: GDPR-friendly (server can't access content)
- ✅ **Trust-Minimized**: Users don't need to trust server

### Negative

- ❌ **Client-Side Complexity**: Encryption logic in frontend
- ❌ **No Server-Side Search**: Cannot search encrypted messages
- ❌ **Key Management Burden**: Users must safeguard private keys
- ❌ **No Message Recovery**: Lost key = lost messages
- ❌ **Limited Forward Secrecy**: Same key pair used for all messages
- ❌ **No Multi-Device Sync**: Each device needs separate decryption

## Implementation Details

### Key Derivation

Keys are derived from Stellar wallet seeds:

```typescript
import StellarSdk from '@stellar/stellar-sdk';

// Derive encryption keypair from Stellar keypair
function deriveEncryptionKeys(stellarSecret: string): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const keypair = StellarSdk.Keypair.fromSecret(stellarSecret);
  const seed = keypair.rawSecretKey(); // 32 bytes
  
  // Use seed as private key for NaCl
  const privateKey = seed;
  const publicKey = nacl.box.keyPair.fromSecretKey(privateKey).publicKey;
  
  return { publicKey, privateKey };
}
```

### Nonce Management

**Critical**: Nonce must be unique for every message with the same key pair.

- **Generation**: `crypto.getRandomValues(new Uint8Array(24))`
- **Storage**: Stored with ciphertext in database
- **Validation**: Database enforces `UNIQUE` constraint on nonce
- **Reuse Prevention**: Frontend checks nonce before send

### Security Properties

1. **Confidentiality**: Only sender and recipient can read
2. **Authenticity**: Recipient knows sender is legitimate
3. **Integrity**: Tampering detected by Poly1305 MAC
4. **Replay Protection**: Nonce uniqueness prevents replay
5. **No Forward Secrecy**: Compromise of private key exposes all messages (acceptable tradeoff for simplicity)

### Message Deletion

When users delete messages:

```sql
-- Hard delete (cannot be recovered)
DELETE FROM private_messages WHERE id = $1;

-- Soft delete (for audit trails)
UPDATE private_messages SET deleted_at = NOW() WHERE id = $1;
```

Server cannot decrypt deleted messages anyway, but hard delete saves storage.

### Dispute Evidence

If messages are needed for dispute resolution, users must:

1. Decrypt relevant messages client-side
2. Export as plaintext or PDF
3. Upload to IPFS as dispute evidence (see ADR-006)

Server cannot assist with message decryption.

### Performance Considerations

- **Encryption Overhead**: ~0.1ms per message on modern devices
- **Bandwidth**: Ciphertext is same size as plaintext + 16 bytes (MAC)
- **Storage**: Negligible overhead (nonce + 16 bytes)
- **Batch Decryption**: Frontend can decrypt multiple messages in parallel

## Future Considerations

### Signal Protocol Integration

For enhanced forward secrecy, future versions may implement Signal's Double Ratchet algorithm. This provides per-message forward secrecy but adds complexity.

### Multi-Device Support

To support message access across devices, future versions may:

1. Use separate key pairs per device
2. Implement key derivation from master seed
3. Store encrypted keys in cloud with password protection

### Metadata Privacy

Current implementation leaks metadata (sender, recipient, timestamp). Future versions may use:

- **Sealed Sender**: Hide sender identity from server
- **Timing Obfuscation**: Delay message delivery randomly
- **Mix Networks**: Route messages through multiple hops

### Group Messages

Current implementation is peer-to-peer. Group messaging would require:

- **Shared Group Key**: Encrypted for each member
- **Key Rotation**: When members join/leave
- **Scalability**: Consider Megolm-style group encryption

## Related ADRs

- ADR-004: SEP-10 Authentication (uses same Stellar keys)
- ADR-006: IPFS for Dispute Evidence (plaintext export)

## References

- [NaCl: Networking and Cryptography library](https://nacl.cr.yp.to/)
- [TweetNaCl.js Documentation](https://github.com/dchest/tweetnacl-js)
- [Curve25519 Paper](https://cr.yp.to/ecdh.html)
- [XSalsa20 Specification](https://cr.yp.to/snuffle/xsalsa-20110204.pdf)
- [Poly1305 Paper](https://cr.yp.to/mac.html)
- [Why NaCl is Better Than OpenSSL](https://cr.yp.to/highspeed/coolnacl-20120725.pdf)
