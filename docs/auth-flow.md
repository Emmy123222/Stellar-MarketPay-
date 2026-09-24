# Authentication Flow — Stellar SEP-10

**Table of Contents**
- [Overview](#overview)
- [SEP-10 Standard](#sep-10-standard)
- [Primary Flow — Happy Path](#primary-flow--happy-path)
- [Error Flows](#error-flows)
- [Two-Factor Authentication (TOTP)](#two-factor-authentication-totp)
- [WebAuthn (Passkey) Flow](#webauthn-passkey-flow)
- [Token Lifecycle](#token-lifecycle)
- [API Specification](#api-specification)
- [Frontend Integration](#frontend-integration)
- [Backend Implementation](#backend-implementation)
- [Security Model](#security-model)
- [Common Questions](#common-questions)

---

## Overview

Stellar MarketPay uses **SEP-10** — the Stellar standard for **challenge-response authentication**. Instead of passwords, a user proves ownership of a Stellar account by signing a server-generated transaction (the *challenge*) with their wallet (e.g., **Freighter**). When the signature is verified, the server issues a short-lived **JWT** for subsequent API calls.

Key properties:
- **Password-less** — users never create or share a secret with the app
- **Stateless** — the server stores no session state; only the JWT claims matter
- **Blockchain-native** — identity is a public Stellar address usable on-chain

---

## SEP-10 Standard

- Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- **Challenge transaction** — an unsigned `TransactionEnvelope` (XDR) containing a nonce, home domain, and short expiry (~5 minutes)
- **Signed XDR** — the client returns the same envelope signed with the Stellar account's private key
- **Verification** — the server checks the signature against the public key on the Stellar network

---

## Primary Flow — Happy Path

```mermaid
sequenceDiagram
    autonumber
    participant U  as User
    participant W  as Freighter Wallet
    participant FE as Frontend (Next.js)
    participant BE as Backend API
    participant SN as Stellar Network (Horizon)

    Note over U,SN: ── Phase 1: Challenge Request ──────────────────────────

    U->>FE: Click "Connect Wallet"
    FE->>W: getPublicKey()
    W-->>FE: G... (Stellar public key)
    FE->>BE: GET /api/auth?account=G...
    BE->>BE: Build SEP-10 challenge XDR<br/>(nonce + home_domain + 5-min expiry)
    BE-->>FE: { transaction: "<base64 XDR>" }

    Note over U,SN: ── Phase 2: Wallet Signing ─────────────────────────────

    FE->>W: signTransaction(xdr, { network: "TESTNET" })
    W->>U: Prompt user to approve signing
    U->>W: Approve
    W-->>FE: signedXdr (base64)

    Note over U,SN: ── Phase 3: Server Verification ────────────────────────

    FE->>BE: POST /api/auth { signedXdr }
    BE->>BE: Deserialize XDR<br/>Extract account, nonce, home_domain
    BE->>SN: Load account (verify it exists on network)
    SN-->>BE: Account record (signers, thresholds)
    BE->>BE: Verify signature against account signers<br/>Check nonce freshness (≤ 5 min old)<br/>Check home_domain matches server config
    BE->>BE: Upsert profile record for G...<br/>Stamp last_login_at

    Note over U,SN: 2FA decision (see "Two-Factor Authentication (TOTP)" below)

    alt Admin account with TOTP 2FA enabled
        BE->>BE: Issue JWT { sub: G..., role: "admin",<br/>2fa_verified: false }
        BE-->>FE: { token: "<jwt>" }
        FE-->>U: Prompt for a 6-digit TOTP code (or passkey)
        U->>FE: Enter TOTP code / approve passkey
        FE->>BE: POST /api/admin/2fa/verify { token: "123456" }
        alt TOTP valid
            BE->>BE: Issue upgraded JWT<br/>{ sub: G..., 2fa_verified: true }
            BE-->>FE: { token: "<upgraded jwt>" }
        else TOTP invalid
            BE-->>FE: 400 { error: "Invalid verification code" }
            FE-->>U: "Invalid code, try again"
        end
    else No 2FA enabled (or non-admin account)
        BE->>BE: Issue JWT { sub: G..., iat, exp: +1h }
        BE-->>FE: { token: "<jwt>" }
    end

    Note over U,SN: ── Phase 4: Authenticated Session ──────────────────────

    FE->>FE: Store JWT (httpOnly cookie recommended)
    FE-->>U: UI unlocks — user is authenticated
    FE->>BE: GET /api/profile (Authorization: Bearer <jwt>)
    BE->>BE: Verify JWT signature + expiry<br/>Extract sub (Stellar address)
    BE-->>FE: { profile data }
```

---

## Error Flows

### Invalid or Expired Challenge

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant BE as Backend API

    FE->>BE: GET /api/auth?account=G...
    BE-->>FE: { transaction: "<xdr>" }

    Note over FE,BE: User waits >5 minutes before signing

    FE->>BE: POST /api/auth { signedXdr }
    BE->>BE: Parse XDR — challenge timestamp > 5 minutes ago
    BE-->>FE: 401 { error: "challenge expired" }
    FE->>FE: Restart flow (fetch new challenge)
```

---

### Signature Verification Failure

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant BE as Backend API
    participant SN as Stellar Network

    FE->>BE: POST /api/auth { signedXdr }
    BE->>SN: Load account G...
    SN-->>BE: Account record
    BE->>BE: Verify signature — FAIL<br/>(wrong key or tampered XDR)
    BE-->>FE: 401 { error: "invalid signature" }
```

---

### Account Not Found on Network

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant BE as Backend API
    participant SN as Stellar Network

    FE->>BE: GET /api/auth?account=G...
    BE->>SN: Check account exists
    SN-->>BE: 404 Not Found
    BE-->>FE: 400 { error: "account not found on Stellar network" }
    FE-->>FE: Show "Fund your account" prompt
```

---

### Rate Limiting

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant BE as Backend API

    loop Repeated requests
        FE->>BE: GET /api/auth?account=G...
        BE->>BE: Increment rate limit counter (by IP)
    end

    FE->>BE: GET /api/auth?account=G...
    BE-->>FE: 429 { error: "Too Many Requests" }<br/>Retry-After: 60s
```

---

## Two-Factor Authentication (TOTP)

TOTP is currently an **admin** second factor; regular users authenticate with
SEP-10 only. The primary flow above branches on this: an admin with TOTP enabled
receives a JWT whose `2fa_verified` claim is `false`, and must complete a second
step before calling routes guarded by `requireAdmin2FA`. Accounts without 2FA
enabled skip the second step entirely and go straight to an authenticated session.

The second factor is provided by `speakeasy` TOTP (6-digit codes, `window: 1`).

### Enrollment (one-time setup)

```mermaid
sequenceDiagram
    autonumber
    participant U  as Admin
    participant FE as Frontend
    participant BE as Backend API
    participant DB as admin_profiles

    U->>FE: Open "Enable 2FA"
    FE->>BE: POST /api/admin/2fa/setup
    BE->>BE: generateSecret(publicKey)
    BE->>DB: Store encrypted totp_secret (totp_enabled = false)
    BE-->>FE: { qrCode (data URL), manualEntryKey }
    FE-->>U: Show QR code / manual key
    U->>FE: Scan with authenticator app, enter 6-digit code
    FE->>BE: POST /api/admin/2fa/verify { token, setup: true }
    BE->>BE: speakeasy.totp.verify(secret, token, window: 1)
    alt Code valid
        BE->>DB: totp_enabled = true, store hashed backup codes
        BE->>BE: Sign upgraded JWT { role: "admin", 2fa_verified: true }
        BE-->>FE: { token, data.backupCodes }  (shown exactly once)
    else Code invalid
        BE-->>FE: 400 { error: "Invalid verification code" }
    end
```

### Login verification (step-up)

```mermaid
sequenceDiagram
    autonumber
    participant U  as Admin
    participant FE as Frontend
    participant BE as Backend API

    Note over U,BE: SEP-10 succeeds (primary flow, phases 1-3)

    BE-->>FE: { token: "<jwt>" } (claim: 2fa_verified = false)
    FE-->>U: Prompt for the 6-digit TOTP code
    U->>FE: Enter code
    FE->>BE: POST /api/admin/2fa/verify { token: "123456" }
    alt TOTP valid
        BE-->>FE: { token: "<upgraded jwt>" } (2fa_verified = true)
        FE->>BE: Retry admin calls with the upgraded token
    else TOTP invalid or locked
        BE-->>FE: 400 { error: "Invalid verification code" }
    end
```

### How the server enforces 2FA

`requireAdmin2FA` (`backend/src/middleware/auth.js`) guards admin-only routes:

1. Non-admin callers pass through — this middleware never affects regular users.
2. Admins with no TOTP configured (`totp_enabled = false`) pass through.
3. Otherwise **at least one** of the following must hold:
   - the JWT carries `2fa_verified: true` (session step-up), **or**
   - the request supplies a valid `X-2FA-Token: <6-digit-code>` header (stateless per-request verification).

If neither holds the response is `403 { "error": "2FA required", "requires2FA": true }`
and the client must complete the step-up. `POST /api/admin/2fa/verify` returns the
upgraded token; `POST /api/admin/2fa/disable` turns 2FA off with a valid TOTP code
or a single-use backup code.

### Recovery

Enabling 2FA returns ten single-use backup codes, shown exactly once. If the
authenticator device is lost, the user disables 2FA with
`POST /api/admin/2fa/disable { "backupCode": "..." }`. Failed TOTP attempts
increment `totp_attempts` and lock verification after repeated failures.

### TOTP vs WebAuthn

| | TOTP (`speakeasy`) | WebAuthn passkey |
|---|---|---|
| Secret storage | Shared secret, encrypted server-side | Public key only; private key stays on the device |
| Phishing resistance | Code can be relayed by a proxy | Origin-bound — not relayable |
| Hardware | Any authenticator app | Platform authenticator or security key |
| Recovery | 10 single-use backup codes | Other registered passkeys |
| Scope today | Admin accounts | Any account |

Either factor can satisfy the "second step" in the primary flow.

---

## WebAuthn (Passkey) Flow

WebAuthn (passkeys) is the phishing-resistant **alternative to TOTP** for the
second step of authentication. It can act as a second factor or as a standalone
authentication method, using a platform authenticator (Touch ID, Windows Hello)
or a hardware security key. Where TOTP stores a shared secret on the server,
WebAuthn stores only a **public key** — the private key never leaves the user's
device — and each assertion is bound to the site's origin, so it cannot be
relayed by a phishing proxy.

```mermaid
sequenceDiagram
    autonumber
    participant U   as User
    participant B   as Browser / Authenticator
    participant FE  as Frontend
    participant BE  as Backend API

    Note over U,BE: ── Registration (one-time setup) ──────────────────────────────

    FE->>BE: POST /api/webauthn/register/begin { publicKey }
    BE->>BE: Generate registration challenge
    BE-->>FE: { challenge, rp, user, pubKeyCredParams }
    FE->>B: navigator.credentials.create(options)
    B->>U: Touch / biometric prompt
    U->>B: Approve
    B-->>FE: PublicKeyCredential (attestation)
    FE->>BE: POST /api/webauthn/register/finish { credential }
    BE->>BE: Verify attestation, store credential_id + public key
    BE-->>FE: { success: true }

    Note over U,BE: ── Authentication ─────────────────────────────────────────────

    FE->>BE: POST /api/webauthn/login/begin { publicKey }
    BE->>BE: Generate assertion challenge
    BE-->>FE: { challenge, allowCredentials, timeout }
    FE->>B: navigator.credentials.get(options)
    B->>U: Touch / biometric prompt
    U->>B: Approve
    B-->>FE: PublicKeyCredential (assertion)
    FE->>BE: POST /api/webauthn/login/finish { credential, publicKey }
    BE->>BE: Verify assertion signature + counter<br/>Update credential counter (replay protection)
    BE->>BE: Issue JWT
    BE-->>FE: { token: "<jwt>" }
    FE-->>U: Authenticated
```

---

## Token Lifecycle

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  Token lifecycle (1-hour default)                                │
 │                                                                  │
 │  t=0          t=55min           t=60min          t=?             │
 │  │            │                 │                │               │
 │  ├── issued ──┤── proactive ────┤── expired ─────┤── re-auth ───►│
 │  │            │   refresh       │   (server 401)  │              │
 │  │            │   window        │                 │              │
 │  └────────────┴─────────────────┴─────────────────┴──────────────┘
```

### Token Claims

```json
{
  "sub": "GABC...XYZ",   // Stellar public key — the authenticated identity
  "iat": 1719273600,     // Issued-at (Unix seconds)
  "exp": 1719277200,     // Expiry (iat + 3600)
  "2fa_verified": true   // Admin claim: true once the TOTP step-up completed
}
```

### Token Storage

| Storage | Security | Recommended |
|---|---|---|
| `httpOnly` cookie | CSRF-resistant, XSS-safe | **Yes (production)** |
| `localStorage` | Accessible to JS — XSS risk | No |
| `sessionStorage` | Clears on tab close | Acceptable for dev |

### Refreshing a Token

The backend does not issue refresh tokens. When the JWT expires, the client silently repeats the SEP-10 flow (Freighter can sign without user interaction if the user previously approved):

```typescript
async function refreshToken(): Promise<string> {
  const account = await freighter.getPublicKey();
  const { transaction } = await fetchChallenge(account);
  const signedXdr = await freighter.signTransaction(transaction);
  const { token } = await verifyChallenge(signedXdr);
  return token;
}
```

---

## API Specification

### `GET /api/auth`

Request a SEP-10 challenge transaction.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account` | `string` | Yes | Stellar public key (`G...`) |

**Response `200`:**
```json
{
  "transaction": "<base64-encoded unsigned XDR>"
}
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "account required" }` | Missing `?account=` |
| `400` | `{ "error": "account not found on Stellar network" }` | Unfunded account |
| `429` | `{ "error": "Too Many Requests" }` | Rate limit exceeded |

---

### `POST /api/auth`

Submit the signed challenge to obtain a JWT.

**Request body:**
```json
{
  "signedXdr": "<base64-encoded signed XDR>"
}
```

**Response `200`:**
```json
{
  "token": "<jwt>"
}
```

For an **admin** account that has TOTP enabled, the JWT is still issued, but its
`2fa_verified` claim is `false` until the step-up in
`POST /api/admin/2fa/verify` succeeds. Admin routes guarded by
`requireAdmin2FA` then answer `403 { "error": "2FA required", "requires2FA": true }`
until the upgraded token is used (or the `X-2FA-Token` header is supplied).
Accounts without 2FA receive a fully usable token immediately.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "signedXdr required" }` | Missing body field |
| `401` | `{ "error": "invalid signature" }` | Bad signature or tampered XDR |
| `401` | `{ "error": "challenge expired" }` | Challenge older than 5 minutes |
| `401` | `{ "error": "invalid home domain" }` | Server/client domain mismatch |

---

### `POST /api/admin/2fa/setup`

Begin TOTP enrollment. Returns a QR code (data URL) and the manual entry key.
Requires admin access; returns `400` if 2FA is already enabled.

### `POST /api/admin/2fa/verify`

Verify a 6-digit TOTP code. On first enrollment (`setup: true`) it enables 2FA and
returns the backup codes; on later calls it performs the login step-up.

**Request body:**
```json
{
  "token": "123456",
  "setup": true
}
```

**Response `200`:**
```json
{
  "success": true,
  "token": "<upgraded jwt>",
  "data": { "backupCodes": ["A1B2C3", "..."] }
}
```

**Error `400`:** `{ "error": "Invalid verification code" }`

### `POST /api/admin/2fa/disable`

Disable 2FA. Requires a valid `token` (TOTP code) or `backupCode`.

### `GET /api/admin/2fa/status`

Returns `{ "success": true, "data": { "totp_enabled": true } }`.

### `X-2FA-Token` header

Stateless alternative to the step-up JWT: send the current 6-digit code as
`X-2FA-Token` on any `requireAdmin2FA`-guarded request.

### WebAuthn endpoints

| Method & path | Purpose |
|---|---|
| `POST /api/webauthn/register/begin` | Start passkey registration (auth required) |
| `POST /api/webauthn/register/finish` | Complete registration, store the credential |
| `POST /api/webauthn/login/begin` | Start passkey authentication |
| `POST /api/webauthn/login/finish` | Verify the assertion and issue a JWT |
| `GET /api/webauthn/credentials` | List the caller's registered passkeys |
| `DELETE /api/webauthn/credentials/:id` | Remove a passkey |

---

### Using the JWT

Include the token in all authenticated requests:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

The backend middleware (`backend/src/middleware/auth.js`) verifies the signature and extracts `sub` (the Stellar address) for use as the authenticated identity.

---

## Frontend Integration

```tsx
// frontend/lib/auth.ts
import { signTransaction, getPublicKey } from "@stellar/freighter-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function login(): Promise<string> {
  // 1. Get the user's public key from Freighter
  const publicKey = await getPublicKey();

  // 2. Request a SEP-10 challenge from the backend
  const challengeRes = await fetch(`${API_URL}/api/auth?account=${publicKey}`);
  if (!challengeRes.ok) {
    const { error } = await challengeRes.json();
    throw new Error(error ?? "Failed to fetch challenge");
  }
  const { transaction } = await challengeRes.json();

  // 3. Ask Freighter to sign the challenge XDR
  const signedXdr = await signTransaction(transaction, {
    networkPassphrase: "Test SDF Network ; September 2015",
  });

  // 4. Send the signed XDR to the backend
  const loginRes = await fetch(`${API_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedXdr }),
  });

  if (!loginRes.ok) {
    const { error } = await loginRes.json();
    throw new Error(error ?? "Authentication failed");
  }

  const { token } = await loginRes.json();
  return token;
}

/**
 * Admin step-up: call this once the user has entered a 6-digit TOTP code.
 * Returns an upgraded JWT whose `2fa_verified` claim satisfies requireAdmin2FA.
 */
export async function verifyTotp(token: string, code: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/admin/2fa/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token: code }),
  });

  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Invalid 2FA code");
  }

  const { token: upgraded } = await res.json();
  return upgraded;
}

export function logout(): void {
  // Clear the stored JWT
  document.cookie = "token=; Max-Age=0; path=/";
}
```

---

## Backend Implementation

**Files:**
- `backend/src/routes/auth.js` — challenge/response endpoints
- `backend/src/middleware/auth.js` — JWT verification middleware
- `backend/src/services/authTokens.js` — JWT generation and management

**Challenge generation** (`GET /api/auth`):

```js
// Simplified from backend/src/routes/auth.js
import { TransactionBuilder, Keypair, Networks, Operation, Asset } from "@stellar/stellar-sdk";

function buildChallengeXdr(clientPublicKey, homeDomain, timeout = 300) {
  const serverKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY);
  const now = Math.floor(Date.now() / 1000);

  const tx = new TransactionBuilder(
    { id: serverKeypair.publicKey(), sequence: "-1", accountId: serverKeypair.publicKey() },
    { fee: "100", networkPassphrase: Networks.TESTNET }
  )
    .addOperation(
      Operation.manageData({
        name: `${homeDomain} auth`,
        value: crypto.randomBytes(48).toString("base64"), // nonce
        source: clientPublicKey,
      })
    )
    .setTimeBounds(now, now + timeout)
    .build();

  tx.sign(serverKeypair);
  return tx.toXDR();
}
```

**Signature verification** (`POST /api/auth`):

```js
import { TransactionBuilder, Networks, Keypair } from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";

async function verifyChallenge(signedXdr, server) {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

  // 1. Check timebounds (anti-replay)
  const { minTime, maxTime } = tx.timeBounds;
  const now = Math.floor(Date.now() / 1000);
  if (now < minTime || now > maxTime) throw new Error("challenge expired");

  // 2. Extract client address from the manage_data operation's source
  const op = tx.operations[0];
  const clientAddress = op.source;

  // 3. Load account from Horizon and verify the signature
  const account = await server.loadAccount(clientAddress);
  const signerMap = Object.fromEntries(account.signers.map(s => [s.key, s.weight]));
  // ... signature verification against signerMap ...

  // 4. Issue JWT
  return jwt.sign({ sub: clientAddress }, process.env.JWT_SECRET, { expiresIn: "1h" });
}
```

**JWT verification middleware:**

```js
// backend/src/middleware/auth.js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "no token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    // req.user.sub === Stellar public key
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}
```

---

## Security Model

### Threat Mitigations

| Threat | Mitigation |
|---|---|
| **Replay attack** — attacker re-submits a previously signed XDR | Time-bounded challenge (5-minute expiry). Once submitted, the nonce cannot be reused. |
| **MITM / XDR tampering** | XDR is base64-encoded and signed; any modification invalidates the signature. |
| **JWT theft via XSS** | Store JWT in an `httpOnly` cookie inaccessible to JavaScript. |
| **CSRF against cookie-stored JWT** | Use `SameSite=Strict` or `SameSite=Lax` cookie attribute. |
| **Brute-force challenge requests** | Rate limiting: max 20 challenge requests per IP per minute. |
| **Compromised account** | Attacker with the private key can authenticate. Mitigation is the same as for any blockchain account — use a hardware wallet and protect the seed phrase. |
| **Multi-sig accounts** | Supported — Stellar allows multiple signers; the server verifies cumulative signer weight meets the account's threshold. |

### JWT Properties

| Property | Value |
|---|---|
| Algorithm | `HS256` |
| Secret | `JWT_SECRET` env var (≥ 32 random bytes) |
| Expiry | 1 hour |
| Claims | `sub` (Stellar address), `iat`, `exp`, optionally `mfa: true` |

---

## Common Questions

### Why not use OAuth or passwords?

**Password-less** — users never create or share a secret with the app. **No credential storage** — the only secret lives in the user's wallet. **Blockchain-native** — the identity is a public Stellar address usable on-chain and in the smart contract.

### What is XDR?

XDR (External Data Representation) is Stellar's binary serialization format. The challenge transaction is serialized to XDR, Base64-encoded for HTTP transport, signed client-side, and verified server-side.

### What if Freighter is not installed?

The frontend checks for Freighter (`window.freighter`) before calling `getPublicKey()`. If absent, it shows a "Install Freighter" prompt linking to the browser extension.

### Can I use a different wallet?

Any wallet that can sign a Stellar transaction XDR (e.g., Albedo, Rabet, xBull) works. Freighter is the primary supported integration. The backend is wallet-agnostic — it only sees the signed XDR.

### Does the backend store private keys?

No. The backend only stores the public key (Stellar address) as the user identifier. The server keypair used to build the challenge is stored as `STELLAR_SECRET_KEY` in environment variables, but this key has no funds and is used solely to sign the challenge XDR.

### How do I test authentication in development?

Use the Stellar Laboratory to generate a testnet keypair, fund it with Friendbot, and call `GET /api/auth?account=<testnet-public-key>` to get a challenge. You can sign it programmatically with `stellarsdk.Keypair.fromSecret(...)`.

```js
import { Keypair, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

const keypair = Keypair.fromSecret("S...");
const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
tx.sign(keypair);
const signedXdr = tx.toEnvelope().toXDR("base64");
```

---

**Implementation files**

- SEP-10 challenge/response: `backend/src/routes/auth.js`
- JWT verification and 2FA enforcement: `backend/src/middleware/auth.js`
- Token issuance, refresh, and rotation: `backend/src/services/authTokens.js`
- Admin TOTP 2FA: `backend/src/routes/admin2fa.js`, `backend/src/services/twoFactorService.js`
- WebAuthn passkeys: `backend/src/routes/webauthn.js`, `backend/src/services/webauthnService.js`
- Rate limiting: `backend/src/middleware/rateLimiter.js`
