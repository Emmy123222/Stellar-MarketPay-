# End-to-End Encryption Protocol

Stellar MarketPay uses **NaCl box** (X25519-XSalsa20-Poly1305) for end-to-end encrypted file attachments in private messages.

---

## Key Generation

Each user generates an X25519 keypair in the browser on first use:

```ts
import nacl from "tweetnacl";
const keypair = nacl.box.keyPair(); // { publicKey: Uint8Array(32), secretKey: Uint8Array(32) }
```

- The **public key** (32 bytes, base64-encoded) is published to the backend.
- The **secret key** is stored in `localStorage` under the key `smp_nacl_keypair`.

> **Warning:** The private key lives in `localStorage` and is vulnerable to XSS. Back it up and do not reuse it across devices. A future version will use `SubtleCrypto.generateKey` with `extractable: false`.

---

## Key Exchange

### Publishing your key

`PUT /api/profiles/:publicKey/encryption-key`

```json
{ "encryptionPublicKey": "<base64-encoded 32-byte X25519 public key>" }
```

- Requires JWT authentication.
- Only the profile owner can update their own key.
- The key is validated: must decode to exactly 32 bytes.

### Fetching a recipient's key

`GET /api/profiles/:publicKey/encryption-key`

```json
{ "success": true, "data": { "encryptionPublicKey": "<base64>" } }
```

- Public — no authentication required.
- Returns `null` if the user has not published a key yet.

The key is also included in the full profile response (`GET /api/profiles/:publicKey`) as `encryptionPublicKey`.

---

## Encrypting a File Attachment

```ts
// sender side
const recipientKey = await fetchRecipientEncryptionKey(recipientAddress); // base64
const data = new Uint8Array(await file.arrayBuffer());
const nonce = nacl.randomBytes(nacl.box.nonceLength);             // 24 bytes
const ciphertext = nacl.box(data, nonce, fromBase64(recipientKey), mySecretKey);

// Wire format: nonce (24 bytes) || ciphertext
const payload = new Uint8Array(nonce.length + ciphertext.length);
payload.set(nonce, 0);
payload.set(ciphertext, nonce.length);
```

The encrypted blob is uploaded to IPFS. The sender's NaCl public key is stored on the message record (`sender_nacl_pub`) so the recipient can decrypt.

---

## Decrypting a File Attachment

```ts
// recipient side
const combined = new Uint8Array(await fetch(ipfsGatewayUrl).then(r => r.arrayBuffer()));
const nonce      = combined.slice(0, nacl.box.nonceLength);
const ciphertext = combined.slice(nacl.box.nonceLength);
const plaintext  = nacl.box.open(ciphertext, nonce, fromBase64(senderNaclPub), mySecretKey);
if (!plaintext) throw new Error("Decryption failed");
```

---

## Threat Model & Limitations

| Threat | Mitigated? |
|--------|-----------|
| Server reads message content | Yes — content encrypted before upload |
| Passive network attacker | Yes — HTTPS + NaCl box |
| XSS exfiltrates private key | **No** — key in localStorage |
| Cross-device access | **No** — key is per-device |
| Key impersonation | Partial — key bound to Stellar address via JWT |

---

## Future Work

- Migrate to `SubtleCrypto.generateKey` with `extractable: false` for XSS-resistant key storage.
- Add key fingerprint display in UI so users can verify out-of-band.
- Support multi-device key sync via encrypted backup.
