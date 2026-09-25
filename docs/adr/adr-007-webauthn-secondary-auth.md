# ADR-007: WebAuthn as Secondary Authentication

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, Security Team

## Context

Stellar MarketPay uses SEP-10 (wallet signature) as the primary authentication mechanism (see ADR-004). While this is secure and blockchain-native, high-value accounts (admins, high-earning freelancers, large clients) need additional security against:

- Wallet private key theft or compromise
- Device loss or theft
- Phishing attacks that trick users into signing malicious transactions
- Unauthorized access from stolen JWT tokens

Traditional 2FA methods (SMS, TOTP) don't prove device possession and can be intercepted. We need a second factor that:

- Proves physical device possession
- Cannot be phished or intercepted
- Works across browsers and devices
- Requires no additional apps or hardware (optional)
- Integrates seamlessly with SEP-10 flow

## Decision

We will implement **WebAuthn (Web Authentication)** as an **optional secondary authentication factor** for sensitive operations, with the following architecture:

### WebAuthn Flow

**Registration** (one-time setup):
1. User completes SEP-10 authentication
2. User opts into 2FA in settings
3. Browser prompts for biometric (Face ID, Touch ID, Windows Hello) or security key
4. WebAuthn credential created and public key stored in database
5. 2FA enabled for account

**Authentication** (subsequent logins):
1. User completes SEP-10 authentication (primary factor)
2. Server checks if 2FA is enabled for account
3. If enabled, server issues WebAuthn challenge
4. User provides biometric or security key
5. Server verifies signature
6. Full JWT token issued

### Implementation

#### Database Schema

```sql
CREATE TABLE webauthn_credentials (
  id UUID PRIMARY KEY,
  user_address VARCHAR(56) NOT NULL,
  credential_id TEXT NOT NULL UNIQUE, -- Base64-encoded credential ID
  public_key TEXT NOT NULL,           -- Base64-encoded public key
  counter BIGINT NOT NULL DEFAULT 0,  -- Signature counter (replay protection)
  transports TEXT[],                  -- [usb, nfc, ble, internal]
  device_name VARCHAR(255),           -- "MacBook Pro Touch ID"
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  FOREIGN KEY (user_address) REFERENCES users(stellar_address)
);

CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_address);
CREATE INDEX idx_webauthn_credential ON webauthn_credentials(credential_id);
```

#### Registration Endpoint

```typescript
// POST /api/auth/webauthn/register
router.post('/auth/webauthn/register', authenticateJWT, async (req, res) => {
  const userAddress = req.user.publicKey;
  
  // Generate registration options
  const options = await generateRegistrationOptions({
    rpName: 'Stellar MarketPay',
    rpID: 'stellarmarketpay.com',
    userID: userAddress,
    userName: userAddress,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Prefer built-in (Face ID, etc.)
      requireResidentKey: false,
      userVerification: 'required',
    },
  });
  
  // Store challenge in session/cache
  await redis.setex(`webauthn:${userAddress}`, 300, options.challenge);
  
  res.json({ options });
});

// POST /api/auth/webauthn/register/verify
router.post('/auth/webauthn/register/verify', authenticateJWT, async (req, res) => {
  const userAddress = req.user.publicKey;
  const { credential, deviceName } = req.body;
  
  // Retrieve challenge
  const challenge = await redis.get(`webauthn:${userAddress}`);
  
  // Verify registration response
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: 'https://stellarmarketpay.com',
    expectedRPID: 'stellarmarketpay.com',
  });
  
  if (!verification.verified) {
    return res.status(400).json({ error: 'Verification failed' });
  }
  
  // Store credential
  await db.query(
    `INSERT INTO webauthn_credentials 
     (user_address, credential_id, public_key, counter, device_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userAddress,
      verification.registrationInfo.credentialID,
      verification.registrationInfo.credentialPublicKey,
      0,
      deviceName || 'Unknown Device',
    ]
  );
  
  res.json({ success: true, message: '2FA enabled' });
});
```

#### Authentication Endpoint

```typescript
// POST /api/auth (modified to include WebAuthn check)
router.post('/api/auth', async (req, res) => {
  const { signedXdr } = req.body;
  
  // Verify SEP-10 signature (primary factor)
  const { clientAccountId } = await verifySEP10Challenge(signedXdr);
  
  // Check if 2FA is enabled
  const credentials = await db.query(
    'SELECT id FROM webauthn_credentials WHERE user_address = $1 LIMIT 1',
    [clientAccountId]
  );
  
  if (credentials.rows.length === 0) {
    // No 2FA, issue full JWT
    const token = jwt.sign({ sub: clientAccountId }, JWT_SECRET, {
      expiresIn: '1h',
    });
    return res.json({ token });
  }
  
  // 2FA enabled, issue partial JWT
  const partialToken = jwt.sign(
    { sub: clientAccountId, partial: true },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
  
  res.json({
    requiresWebAuthn: true,
    partialToken,
  });
});

// POST /api/auth/webauthn/authenticate
router.post('/auth/webauthn/authenticate', async (req, res) => {
  const { partialToken, credential } = req.body;
  
  // Verify partial JWT
  let payload;
  try {
    payload = jwt.verify(partialToken, JWT_SECRET);
    if (!payload.partial) throw new Error('Not a partial token');
  } catch {
    return res.status(401).json({ error: 'Invalid partial token' });
  }
  
  const userAddress = payload.sub;
  
  // Get user's credentials
  const credentials = await db.query(
    'SELECT * FROM webauthn_credentials WHERE user_address = $1',
    [userAddress]
  );
  
  // Generate authentication challenge
  const challenge = await redis.get(`webauthn_auth:${userAddress}`);
  
  // Verify authentication response
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: 'https://stellarmarketpay.com',
    expectedRPID: 'stellarmarketpay.com',
    authenticator: {
      credentialID: credentials.rows[0].credential_id,
      credentialPublicKey: credentials.rows[0].public_key,
      counter: credentials.rows[0].counter,
    },
  });
  
  if (!verification.verified) {
    return res.status(401).json({ error: 'WebAuthn verification failed' });
  }
  
  // Update counter (replay protection)
  await db.query(
    'UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2',
    [verification.authenticationInfo.newCounter, credentials.rows[0].id]
  );
  
  // Issue full JWT
  const token = jwt.sign({ sub: userAddress }, JWT_SECRET, {
    expiresIn: '1h',
  });
  
  res.json({ token });
});
```

## Rationale

### Why WebAuthn?

- **Phishing-Resistant**: Origin-bound credentials cannot be used on phishing sites
- **No Shared Secrets**: Public key cryptography, server never sees private key
- **Device-Bound**: Credentials tied to physical device
- **Built-In Support**: Modern browsers support natively (94%+ global coverage)
- **Hardware Backing**: Uses TPM, Secure Enclave, or dedicated hardware
- **No Additional Apps**: No need for authenticator apps like Google Authenticator
- **Biometric Support**: Face ID, Touch ID, Windows Hello work seamlessly
- **Open Standard**: W3C standard, not proprietary

### Why Not Alternatives?

#### TOTP (Time-Based One-Time Password)

- **Pros**: Widely supported, works offline
- **Cons**: Can be phished, requires app installation, shared secret, clock sync issues

#### SMS 2FA

- **Pros**: Universal phone support
- **Cons**: SIM swapping attacks, phishing, network dependency, poor UX

#### Email 2FA

- **Pros**: No additional setup
- **Cons**: Email compromise, slow, poor UX

#### Hardware Tokens (U2F/FIDO)

- **Pros**: Very secure, phishing-resistant
- **Cons**: Requires purchasing hardware ($20-50), can be lost, poor adoption

#### Backup Codes

- **Pros**: Recovery mechanism
- **Cons**: Not a primary auth method, can be stolen if stored insecurely

## Consequences

### Positive

- ✅ **Phishing-Resistant**: Credentials bound to domain origin
- ✅ **Device-Proof**: Requires physical device possession
- ✅ **No App Required**: Built into browser/OS
- ✅ **Fast UX**: Biometric auth in < 2 seconds
- ✅ **Hardware-Backed**: Uses Secure Enclave or TPM
- ✅ **Replay Protection**: Signature counter prevents replay
- ✅ **Privacy-Preserving**: No tracking across sites
- ✅ **Open Standard**: Future-proof W3C spec

### Negative

- ❌ **Device Lock-In**: Credentials tied to single device (can register multiple)
- ❌ **Browser Support**: Requires modern browser (94%+ coverage)
- ❌ **No Cross-Device**: Each device needs separate registration
- ❌ **Recovery Complexity**: Lost device = lost 2FA (need backup codes)
- ❌ **User Education**: Some users unfamiliar with biometric auth
- ❌ **Optional Only**: Cannot force users to enable (adoption challenge)

## Implementation Details

### Frontend Integration

```typescript
// components/Enable2FA.tsx
import { startRegistration } from '@simplewebauthn/browser';

async function enable2FA() {
  // Request registration options from server
  const optionsRes = await fetch('/api/auth/webauthn/register', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const { options } = await optionsRes.json();
  
  // Prompt user for biometric/security key
  const credential = await startRegistration(options);
  
  // Send credential to server
  const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      credential,
      deviceName: navigator.userAgent.includes('Mac') ? 'MacBook Touch ID' : 'Device',
    }),
  });
  
  const { success } = await verifyRes.json();
  if (success) {
    alert('2FA enabled! You will be prompted for biometric on next login.');
  }
}
```

### Security Considerations

1. **Challenge Expiry**: Challenges expire after 5 minutes
2. **Counter Validation**: Signature counter prevents replay attacks
3. **Origin Validation**: Credentials bound to domain
4. **Attestation**: Use "none" attestation (privacy-preserving)
5. **Transport Hints**: Store transports for faster re-authentication
6. **Rate Limiting**: Limit verification attempts to prevent brute force

### Recovery Mechanism

If user loses device:

```typescript
// Generate backup codes during 2FA setup
function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    crypto.randomBytes(8).toString('hex')
  );
}

// Store hashed backup codes
const codes = generateBackupCodes();
for (const code of codes) {
  await db.query(
    'INSERT INTO backup_codes (user_address, code_hash) VALUES ($1, $2)',
    [userAddress, await bcrypt.hash(code, 10)]
  );
}

// Return plaintext codes to user (only shown once)
return { backupCodes: codes };
```

Users can use backup code to disable 2FA and re-register with new device.

### Multi-Device Support

Users can register multiple devices:

```sql
-- User has MacBook + iPhone registered
SELECT device_name, created_at FROM webauthn_credentials
WHERE user_address = 'GXXXXXX';

-- Results:
-- MacBook Pro Touch ID | 2026-05-28
-- iPhone Face ID       | 2026-05-29
```

During auth, user can choose which device to use (browser prompts).

### Admin 2FA Enforcement

For admin accounts, enforce 2FA:

```typescript
// Check if admin has 2FA enabled
const isAdmin = await db.query(
  'SELECT 1 FROM admins WHERE wallet_address = $1',
  [userAddress]
);

if (isAdmin.rows.length > 0) {
  const has2FA = await db.query(
    'SELECT 1 FROM webauthn_credentials WHERE user_address = $1',
    [userAddress]
  );
  
  if (has2FA.rows.length === 0) {
    return res.status(403).json({
      error: 'Admin accounts must enable 2FA',
      requiresSetup: true,
    });
  }
}
```

### Conditional UI

```typescript
// Show 2FA badge in user profile
{user.has2FA && (
  <span className="badge badge-success">
    🔒 2FA Enabled
  </span>
)}

// Prompt high-value users to enable 2FA
{user.totalEarnings > 10000 && !user.has2FA && (
  <div className="alert alert-info">
    Your account has high earnings. We recommend enabling 2FA for extra security.
    <button onClick={() => router.push('/settings/security')}>
      Enable 2FA
    </button>
  </div>
)}
```

## Future Considerations

### Passkeys

WebAuthn credentials can be synced across devices using passkeys (iCloud Keychain, Google Password Manager). Future versions may support this for better UX.

### Conditional UI

Show different auth prompts based on risk:

- Low risk: SEP-10 only
- Medium risk: SEP-10 + WebAuthn
- High risk: SEP-10 + WebAuthn + Email confirmation

### Biometric-Only Login

Future versions may allow WebAuthn as primary auth (skip SEP-10) for convenience.

### Enterprise SSO

For business accounts, integrate SAML/OIDC with WebAuthn as second factor.

## Related ADRs

- ADR-004: SEP-10 Authentication (primary factor)
- ADR-008: Redis for Session Storage (challenge storage)

## References

- [WebAuthn Specification](https://www.w3.org/TR/webauthn-2/)
- [SimpleWebAuthn Library](https://simplewebauthn.dev/)
- [WebAuthn Guide](https://webauthn.guide/)
- [FIDO Alliance](https://fidoalliance.org/)
- [Passkeys Documentation](https://www.passkeys.com/)
- [Browser Support](https://caniuse.com/webauthn)
