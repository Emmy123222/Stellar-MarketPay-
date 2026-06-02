# Private Message Encryption

`private_messages` stores opaque ciphertext at rest. The backend never decrypts message bodies; it only persists the sender/recipient metadata, a per-message nonce, and the encrypted payload.

## Current storage contract

- `sender_address` and `recipient_address` identify the two participants.
- `sender_public_key` and `recipient_public_key` are stored so clients can reconstruct the correct key agreement inputs.
- `nonce` must be unique per message.
- `cipher_text` contains the encrypted payload, not plaintext.

## Required client-side scheme

The intended client-side implementation is:

1. Derive a shared secret with X25519 from the sender private key and recipient public key.
2. Derive an authenticated encryption key from that shared secret.
3. Encrypt with XChaCha20-Poly1305.
4. Generate a fresh 24-byte random nonce for every message.
5. Reject nonce reuse before upload.

## Why the nonce constraint matters

The nonce is part of the ciphertext integrity boundary. Reusing it with the same key breaks confidentiality for modern AEAD schemes, so the database enforces `UNIQUE (nonce)` as a backstop.

## Operational note

If the client changes the key derivation or cipher suite, the payload format must be versioned before rollout so old messages remain decryptable.
