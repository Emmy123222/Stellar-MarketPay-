# Troubleshooting Guide

This guide covers common issues you may encounter when developing, deploying, or integrating with Stellar MarketPay.

## Table of Contents

- [Frontend Issues](#frontend-issues)
  - [Freighter Not Detected](#freighter-not-detected)
  - [NEXT_PUBLIC_CONTRACT_ID Not Set](#next_public_contract_id-not-set)
  - [CORS Errors](#cors-errors)
  - [WebSocket Disconnects](#websocket-disconnects)
- [Backend Issues](#backend-issues)
  - [PostgreSQL Migration Failure](#postgresql-migration-failure)
  - [Redis Connection Refused](#redis-connection-refused)
  - [Soroban RPC Timeout](#soroban-rpc-timeout)
  - [IPFS Upload Failure](#ipfs-upload-failure)
- [CI/CD Issues](#cicd-issues)
  - [Workflow Failures (Missing Secrets)](#workflow-failures-missing-secrets)
- [Network Issues](#network-issues)
  - [Wrong Stellar Network](#wrong-stellar-network)
  - [Transaction Submission Failed](#transaction-submission-failed)

---

## Frontend Issues

### Freighter Not Detected

**Symptom**:
```
Error: Freighter wallet not detected
Error: window.freighter is undefined
```

**Cause**:
1. Freighter browser extension is not installed
2. Extension is disabled
3. Wrong browser (Freighter only supports Chrome, Firefox, Edge, Brave)
4. Code runs before extension loads

**Fix**:

#### 1. Install Freighter

Visit [https://freighter.app](https://freighter.app) and install for your browser.

#### 2. Check Extension is Enabled

- Chrome: `chrome://extensions` → Enable "Freighter"
- Firefox: `about:addons` → Enable "Freighter"
- Edge: `edge://extensions` → Enable "Freighter"

#### 3. Wait for Extension to Load

```typescript
// ❌ Bad: Runs immediately
if (window.freighter) {
  // May not be loaded yet
}

// ✅ Good: Wait for load
useEffect(() => {
  const checkFreighter = async () => {
    // Give extension time to inject
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (window.freighter) {
      setFreighterAvailable(true);
    } else {
      showToast('Please install Freighter wallet', 'error');
    }
  };
  
  checkFreighter();
}, []);
```

#### 4. Add Polite Prompt

```typescript
// components/ConnectWallet.tsx
{!freighterAvailable && (
  <div className="alert alert-warning">
    Freighter wallet not detected. 
    <a href="https://freighter.app" target="_blank" rel="noopener">
      Install Freighter
    </a>
  </div>
)}
```

**Related Files**:
- `frontend/components/ConnectWallet.tsx`
- `frontend/lib/stellar.ts`

---

### NEXT_PUBLIC_CONTRACT_ID Not Set

**Symptom**:
```
Error: Contract ID is not configured
Error: NEXT_PUBLIC_CONTRACT_ID is undefined
Contract method calls fail with "Invalid contract ID"
```

**Cause**:
The `NEXT_PUBLIC_CONTRACT_ID` environment variable is missing or not set correctly in `frontend/.env.local`.

**Fix**:

#### 1. Check Environment File

```bash
cd frontend
cat .env.local
```

You should see:
```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

#### 2. Get Contract ID

If you haven't deployed the contract yet:

```bash
cd contracts
# Build contract
make build

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source YOUR_SECRET_KEY

# Output: CXXXXXXX... (copy this)
```

See [docs/contract-deployment.md](./contract-deployment.md) for full instructions.

#### 3. Set Contract ID

```bash
cd frontend
echo "NEXT_PUBLIC_CONTRACT_ID=CXXXXXXX..." >> .env.local
```

#### 4. Restart Dev Server

```bash
# Kill old server (Ctrl+C)
npm run dev
```

**Note**: Environment variables starting with `NEXT_PUBLIC_` are embedded at build time. You must restart the dev server after changing them.

#### 5. Use Mock Mode (Development)

For frontend development without a deployed contract:

```env
# frontend/.env.local
NEXT_PUBLIC_USE_CONTRACT_MOCK=true
NEXT_PUBLIC_CONTRACT_ID=mock-contract-id
```

**Related Files**:
- `frontend/.env.local`
- `frontend/lib/contractClient.ts`
- `docs/contract-deployment.md`

---

### CORS Errors

**Symptom**:
```
Access to fetch at 'http://localhost:4000/api/jobs' from origin 'http://localhost:3000' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

**Cause**:
1. Backend `ALLOWED_ORIGINS` doesn't include frontend URL
2. Backend not running
3. Wrong API URL in frontend config

**Fix**:

#### 1. Check Backend CORS Config

```bash
cd backend
cat .env
```

Should contain:
```env
ALLOWED_ORIGINS=http://localhost:3000
```

For multiple origins:
```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://stellarmarketpay.com
```

#### 2. Check Frontend API URL

```bash
cd frontend
cat .env.local
```

Should match backend:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

#### 3. Restart Backend

```bash
cd backend
# Kill old process
npm run dev
```

#### 4. Verify Backend is Running

```bash
curl http://localhost:4000/health
```

Should return:
```json
{"status":"healthy","database":{"status":"ok"},...}
```

#### 5. Production Deployment

In production, set:

```env
# Backend .env
ALLOWED_ORIGINS=https://stellarmarketpay.com,https://www.stellarmarketpay.com
```

**Related Files**:
- `backend/src/config/cors.js`
- `backend/.env`
- `frontend/.env.local`

---

### WebSocket Disconnects

**Symptom**:
```
WebSocket connection to 'ws://localhost:4000/ws' failed
WebSocket disconnected, reconnecting...
Real-time updates not working
```

**Cause**:
1. Backend WebSocket server not running
2. Firewall blocking WebSocket connections
3. Network instability
4. JWT token expired

**Fix**:

#### 1. Check Backend WebSocket

```bash
# Test WebSocket endpoint
wscat -c "ws://localhost:4000/ws?token=YOUR_JWT"
```

Install `wscat` if needed:
```bash
npm install -g wscat
```

#### 2. Check JWT Token

```typescript
// Frontend: Verify token is valid
const token = localStorage.getItem('jwt');
if (!token) {
  console.error('No JWT token found');
  // Re-authenticate
}

// Check expiry
const payload = JSON.parse(atob(token.split('.')[1]));
const expired = payload.exp * 1000 < Date.now();
if (expired) {
  console.log('Token expired, re-authenticating...');
  // Trigger SEP-10 flow
}
```

#### 3. Add Reconnection Logic

```typescript
// lib/websocket.ts
class WebSocketClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  
  connect(token: string) {
    this.ws = new WebSocket(`ws://localhost:4000/ws?token=${token}`);
    
    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(`Reconnecting in ${delay}ms...`);
        setTimeout(() => this.connect(token), delay);
      } else {
        console.error('Max reconnection attempts reached');
        showToast('Unable to connect to server', 'error');
      }
    };
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('✅ WebSocket connected');
    };
  }
}
```

#### 4. Check Firewall

Some corporate firewalls block WebSocket. Test with:

```bash
# Ping the endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  http://localhost:4000/ws?token=test
```

#### 5. Use WSS in Production

In production, use secure WebSocket:

```typescript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${protocol}//${API_HOST}/ws?token=${token}`;
```

**Related Files**:
- `backend/src/websocket/server.js`
- `frontend/lib/websocket.ts`
- `docs/websocket-scope-protocol.md`

---

## Backend Issues

### PostgreSQL Migration Failure

**Symptom**:
```
Error: relation "jobs" does not exist
Error: column "escrow_status" does not exist
Migration failed: syntax error at or near "..."
```

**Cause**:
1. Database not created
2. Migrations not run
3. Wrong database credentials
4. PostgreSQL not running

**Fix**:

#### 1. Check PostgreSQL is Running

```bash
# Linux/Mac
psql --version
pg_isready

# Check if server is running
sudo systemctl status postgresql
```

#### 2. Create Database

```bash
# Connect as postgres user
psql -U postgres

# Create database and user
CREATE DATABASE stellarwork;
CREATE USER stellarwork WITH PASSWORD 'stellarwork_dev';
GRANT ALL PRIVILEGES ON DATABASE stellarwork TO stellarwork;
\q
```

#### 3. Verify Database URL

```bash
cd backend
cat .env
```

Should match:
```env
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
```

#### 4. Test Connection

```bash
psql "postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork"
```

Should connect without errors.

#### 5. Run Migrations

```bash
cd backend
npm run migrate
```

Output should show:
```
✅ Running migration V1__initial_schema.up.sql
✅ Running migration V2__admin_2fa_and_drafts.up.sql
...
✅ All migrations completed
```

#### 6. Verify Tables

```bash
psql "postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork" -c "\dt"
```

Should list tables: `jobs`, `applications`, `users`, `escrows`, etc.

#### 7. Rollback if Needed

```bash
cd backend
npm run migrate:rollback
```

**Related Files**:
- `backend/src/db/migrate.js`
- `backend/src/db/migrations/*.sql`
- `backend/.env`

---

### Redis Connection Refused

**Symptom**:
```
Error: Redis connection refused
Error: connect ECONNREFUSED 127.0.0.1:6379
Rate limiting not working
Sessions lost on restart
```

**Cause**:
1. Redis not installed
2. Redis not running
3. Wrong Redis host/port
4. Redis password incorrect

**Fix**:

#### 1. Install Redis

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

**macOS**:
```bash
brew install redis
brew services start redis
```

**Docker**:
```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

#### 2. Check Redis is Running

```bash
redis-cli ping
```

Should return: `PONG`

#### 3. Verify Redis Config

```bash
cd backend
cat .env
```

Should contain:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

#### 4. Test Connection

```bash
redis-cli -h localhost -p 6379
```

Or with password:
```bash
redis-cli -h localhost -p 6379 -a your_password
```

#### 5. Check Redis Logs

```bash
# Linux
sudo journalctl -u redis -n 50

# macOS
brew services info redis

# Docker
docker logs redis
```

#### 6. Update Backend Config

```javascript
// backend/src/config/redis.js
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis reconnecting in ${delay}ms...`);
    return delay;
  },
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});
```

**Related Files**:
- `backend/src/config/redis.js`
- `backend/.env`
- `docs/ADR-008-redis-session-cache.md`

---

### Soroban RPC Timeout

**Symptom**:
```
Error: Request timeout after 30000ms
Error: Failed to fetch contract data
Soroban RPC endpoint not responding
```

**Cause**:
1. Soroban RPC endpoint down
2. Network connectivity issues
3. Wrong RPC URL
4. Rate limiting

**Fix**:

#### 1. Check RPC URL

```bash
cd frontend
cat .env.local
```

Should be:
```env
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

#### 2. Test RPC Endpoint

```bash
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getHealth"
  }'
```

Should return:
```json
{"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}
```

#### 3. Check Stellar Status

Visit [https://status.stellar.org](https://status.stellar.org) for network status.

#### 4. Use Backup RPC

```typescript
// lib/stellar.ts
const RPC_ENDPOINTS = [
  'https://soroban-testnet.stellar.org',
  'https://rpc-testnet.stellar.org', // Backup
  'https://soroban-testnet.stellar.community', // Alternative
];

async function callRPC(method: string, params: any[]) {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        timeout: 10000,
      });
      
      if (response.ok) return await response.json();
    } catch (error) {
      console.warn(`RPC endpoint ${endpoint} failed:`, error);
    }
  }
  throw new Error('All RPC endpoints failed');
}
```

#### 5. Increase Timeout

```typescript
// lib/contractClient.ts
const server = new SorobanRpc.Server(RPC_URL, {
  timeout: 60000, // 60 seconds (default: 30000)
});
```

**Related Files**:
- `frontend/lib/stellar.ts`
- `frontend/lib/contractClient.ts`
- `frontend/.env.local`

---

### IPFS Upload Failure

**Symptom**:
```
Error: Failed to upload file to IPFS
Error: Pinata API key invalid
Error: Request failed with status 401
```

**Cause**:
1. Pinata API keys not set
2. Invalid API keys
3. Pinata account suspended
4. File too large
5. Network issues

**Fix**:

#### 1. Check API Keys

```bash
cd frontend
cat .env.local
```

Should contain:
```env
NEXT_PUBLIC_PINATA_API_KEY=your_api_key
PINATA_API_SECRET=your_api_secret
PINATA_JWT=your_jwt_token
```

#### 2. Verify API Keys

```bash
curl -X GET https://api.pinata.cloud/data/testAuthentication \
  -H "pinata_api_key: YOUR_API_KEY" \
  -H "pinata_secret_api_key: YOUR_API_SECRET"
```

Should return:
```json
{"message":"Congratulations! You are communicating with the Pinata API!"}
```

#### 3. Regenerate Keys

1. Go to [https://pinata.cloud/keys](https://pinata.cloud/keys)
2. Click "Revoke" on old key
3. Click "New Key"
4. Select permissions: `pinFileToIPFS`, `pinJSONToIPFS`
5. Copy new keys to `.env.local`

#### 4. Check File Size

```typescript
// lib/pinata.ts
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

if (file.size > MAX_FILE_SIZE) {
  throw new Error('File too large (max 50MB)');
}
```

#### 5. Check Pinata Storage Quota

Visit [https://pinata.cloud/dashboard](https://pinata.cloud/dashboard) to check:
- Storage used vs limit
- Bandwidth used vs limit

Free tier: 1GB storage, 10GB bandwidth/month

#### 6. Test Upload

```bash
curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "pinata_api_key: YOUR_API_KEY" \
  -H "pinata_secret_api_key: YOUR_API_SECRET" \
  -F "file=@./test.jpg"
```

**Related Files**:
- `frontend/lib/pinata.ts`
- `frontend/components/DisputeEvidenceUpload.tsx`
- `docs/PINATA_IPFS_SETUP.md`

---

## CI/CD Issues

### Workflow Failures (Missing Secrets)

**Symptom**:
```
Error: DATABASE_URL secret not found
Error: Cannot deploy without CONTRACT_ID
GitHub Actions workflow fails at deploy step
```

**Cause**:
Required secrets not configured in GitHub repository settings.

**Fix**:

#### 1. Add Repository Secrets

1. Go to GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

#### 2. Required Secrets

Add these secrets:

```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=your-secret-key-min-32-chars
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=CXXXXXXX...
ALLOWED_ORIGINS=https://stellarmarketpay.com
REDIS_HOST=your-redis-host
REDIS_PASSWORD=your-redis-password
PINATA_API_KEY=your-pinata-key
PINATA_API_SECRET=your-pinata-secret
```

#### 3. Verify Secrets in Workflow

```yaml
# .github/workflows/deploy-production.yml
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  JWT_SECRET: ${{ secrets.JWT_SECRET }}
  CONTRACT_ID: ${{ secrets.CONTRACT_ID }}
```

#### 4. Test Workflow Locally

```bash
# Install act (GitHub Actions local runner)
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Run workflow locally
act -j deploy -s DATABASE_URL="postgresql://..." -s JWT_SECRET="..."
```

#### 5. Check Workflow Logs

1. Go to **Actions** tab in GitHub
2. Click on failed workflow
3. Expand failed job
4. Look for error messages

**Related Files**:
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/check-openapi-docs.yml`

---

## Network Issues

### Wrong Stellar Network

**Symptom**:
```
Error: Account not found
Error: Transaction failed with TX_BAD_SEQ
Freighter shows different network than expected
```

**Cause**:
Freighter wallet is on mainnet but app is configured for testnet (or vice versa).

**Fix**:

#### 1. Check Freighter Network

1. Open Freighter extension
2. Click settings gear icon
3. Check current network (Mainnet / Testnet)

#### 2. Match App Configuration

```bash
cd frontend
cat .env.local
```

For testnet:
```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

For mainnet:
```env
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org
```

#### 3. Verify Network in Code

```typescript
// lib/stellar.ts
import { Networks } from '@stellar/stellar-sdk';

const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET;

console.log('Using network:', network);
```

#### 4. Get Testnet XLM

If using testnet, fund account:

```bash
# Visit Friendbot
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

Or use: [https://laboratory.stellar.org/#account-creator?network=test](https://laboratory.stellar.org/#account-creator?network=test)

**Related Files**:
- `frontend/lib/stellar.ts`
- `frontend/.env.local`
- `docs/README.md` (Testnet setup section)

---

### Transaction Submission Failed

**Symptom**:
```
Error: Transaction submission failed
Error: tx_bad_seq
Error: tx_insufficient_balance
```

**Cause**:
1. Insufficient XLM balance
2. Wrong sequence number
3. Transaction expired
4. Network congestion

**Fix**:

#### 1. Check Account Balance

```typescript
const account = await server.loadAccount(publicKey);
console.log('XLM Balance:', account.balances.find(b => b.asset_type === 'native')?.balance);
```

Or visit: `https://stellar.expert/explorer/testnet/account/YOUR_PUBLIC_KEY`

#### 2. Refresh Account Before Transaction

```typescript
// ❌ Bad: Account might be stale
const account = await server.loadAccount(publicKey);
// ... (long delay)
const transaction = new TransactionBuilder(account, {...});

// ✅ Good: Refresh right before building
const account = await server.loadAccount(publicKey);
const transaction = new TransactionBuilder(account, {...})
  .addOperation(...)
  .setTimeout(180)
  .build();
```

#### 3. Add Retries for tx_bad_seq

```typescript
async function submitWithRetry(transaction: Transaction, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await server.submitTransaction(transaction);
      return result;
    } catch (error) {
      if (error.response?.data?.extras?.result_codes?.transaction === 'tx_bad_seq') {
        console.log('Sequence number error, retrying...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Rebuild with fresh sequence
        const account = await server.loadAccount(publicKey);
        transaction = new TransactionBuilder(account, {...}).build();
        transaction.sign(keypair);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

#### 4. Check Transaction in Explorer

```typescript
const txHash = transaction.hash().toString('hex');
console.log(`View transaction: https://stellar.expert/explorer/testnet/tx/${txHash}`);
```

**Related Files**:
- `frontend/lib/stellar.ts`
- `frontend/lib/contractClient.ts`

---

## Getting Help

If this guide doesn't resolve your issue:

1. **Search Issues**: [github.com/stellar-marketpay/issues](https://github.com/stellar-marketpay/issues)
2. **Open Issue**: Use issue templates in `.github/ISSUE_TEMPLATE/`
3. **Discussion**: [github.com/stellar-marketpay/discussions](https://github.com/stellar-marketpay/discussions)
4. **Documentation**: Check [docs/](.) for more guides
5. **Stellar Discord**: [https://discord.gg/stellar](https://discord.gg/stellar)

---

**Last Updated**: 2026-05-28
