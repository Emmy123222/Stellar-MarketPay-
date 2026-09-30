# Service Keypair Setup and Rotation

**Issue #536**: Secure management of Stellar service keypair for backend-to-contract calls.

---

## Overview

The backend uses a Stellar service keypair to interact with Soroban smart contracts (e.g., `timeout_refund`, admin operations). This keypair must be protected and never hardcoded.

---

## Environment Variables

### Required

- `STELLAR_SERVICE_SECRET` - The secret key (S...) for the Stellar service account
  - **Never commit this to Git**
  - **Never expose in logs**
  - Use 32+ random characters for the secret

### Optional

- `STELLAR_SERVICE_ALLOWED_IPS` - Comma-separated list of allowed IP addresses
  - Example: `10.0.0.1,10.0.0.2`
  - If not set, IP restrictions are disabled (not recommended for production)
  - Logs warnings when service key used from unexpected IPs

---

## Local Development Setup

### 1. Generate a Test Keypair

```bash
# Using Stellar SDK
node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Public:', kp.publicKey()); console.log('Secret:', kp.secret());"
```

### 2. Add to `.env`

```env
STELLAR_SERVICE_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
STELLAR_SERVICE_ALLOWED_IPS=127.0.0.1,::1
```

### 3. Fund the Account (Testnet)

Visit [Stellar Friendbot](https://friendbot.stellar.org) with the public key to receive test XLM.

---

## Production Deployment

### Option 1: AWS Secrets Manager (Recommended)

1. **Store the secret in AWS Secrets Manager**

```bash
aws secretsmanager create-secret \
  --name stellar-marketpay/service-key \
  --secret-string '{"secret_key":"S..."}' \
  --region us-east-1
```

2. **Load in application startup**

```javascript
const AWS = require('aws-sdk');
const client = new AWS.SecretsManager({ region: 'us-east-1' });

async function loadServiceSecret() {
  const data = await client.getSecretValue({ SecretId: 'stellar-marketpay/service-key' }).promise();
  const secret = JSON.parse(data.SecretString);
  process.env.STELLAR_SERVICE_SECRET = secret.secret_key;
}
```

3. **Add to `backend/.env`**

```env
# Loaded from AWS Secrets Manager at startup
# STELLAR_SERVICE_SECRET is set programmatically
```

### Option 2: Hashicorp Vault

1. **Store the secret in Vault**

```bash
vault kv put secret/stellar-marketpay/service-key secret_key="S..."
```

2. **Load in application**

```javascript
const vault = require('node-vault')({ endpoint: 'https://vault.example.com' });

async function loadServiceSecret() {
  const data = await vault.read('secret/stellar-marketpay/service-key');
  process.env.STELLAR_SERVICE_SECRET = data.data.data.secret_key;
}
```

### Option 3: HSM (Hardware Security Module)

For maximum security, use an HSM:

- **AWS CloudHSM**: Store key in CloudHSM FIPS 140-2 Level 3 validated module
- **Azure Dedicated HSM**: Use Azure's HSM service
- **Thales Network HSM**: On-premises HSM solution

Implementation requires HSM SDK integration with Stellar SDK.

---

## Key Rotation Procedure

### 1. Generate New Keypair

```bash
node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Public:', kp.publicKey()); console.log('Secret:', kp.secret());"
```

### 2. Fund New Account

- Send XLM from old account to new account
- Or fund via Friendbot (testnet) / exchange (mainnet)

### 3. Update Secret Store

```bash
# AWS Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id stellar-marketpay/service-key \
  --secret-string '{"secret_key":"NEW_SECRET"}' \
  --region us-east-1
```

### 4. Restart Backend Services

```bash
# Kubernetes
kubectl rollout restart deployment/stellar-marketpay-backend

# Docker
docker-compose restart backend

# PM2
pm2 restart stellar-marketpay-backend
```

### 5. Verify Rotation

```bash
# Check logs for successful key loading
kubectl logs -f deployment/stellar-marketpay-backend | grep "Service keypair loaded"
```

### 6. Decommission Old Key

- Wait 24-48 hours to ensure no issues
- Remove old key from secret store
- Revoke any permissions associated with old key

---

## Testing

### Test: Contract Call Fails with Wrong Key

```javascript
const { verifyServiceKey } = require('../services/stellarServiceKey');

test('rejects wrong service key', () => {
  process.env.STELLAR_SERVICE_SECRET = 'S' + 'X'.repeat(55);
  const wrongKey = 'G' + 'A'.repeat(55);
  
  expect(verifyServiceKey(wrongKey)).toBe(false);
});
```

### Test: IP Restriction

```javascript
const { isAllowedIp } = require('../services/stellarServiceKey');

test('blocks unexpected IP', () => {
  process.env.STELLAR_SERVICE_ALLOWED_IPS = '10.0.0.1,10.0.0.2';
  
  expect(isAllowedIp('10.0.0.1')).toBe(true);
  expect(isAllowedIp('192.168.1.1')).toBe(false);
});
```

---

## Security Best Practices

1. **Never hardcode keys** - Always load from environment or secret store
2. **Use separate keys per environment** - dev, staging, production
3. **Rotate keys quarterly** - Or immediately if compromised
4. **Monitor usage** - Alert on unexpected IP usage
5. **Limit permissions** - Service key should only have necessary permissions
6. **Audit access** - Log all service key usage with IP and timestamp
7. **Use HSM for production** - Hardware-backed key storage for maximum security

---

## Troubleshooting

### Error: "Service keypair not configured"

**Cause**: `STELLAR_SERVICE_SECRET` environment variable not set

**Solution**: Add the environment variable to your `.env` file or secret store

### Error: "Invalid service secret key"

**Cause**: The secret key format is invalid or corrupted

**Solution**: Regenerate the keypair and update the secret store

### Warning: "Service key used from unexpected IP"

**Cause**: Service key used from IP not in `STELLAR_SERVICE_ALLOWED_IPS`

**Solution**: 
- Add the IP to allowed list if legitimate
- Investigate if suspicious activity
- Consider rotating the key if compromised

---

## References

- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Hashicorp Vault](https://www.vaultproject.io/)
- [AWS CloudHSM](https://aws.amazon.com/cloudhsm/)
