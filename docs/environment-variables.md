# Environment Variables

This page is the single reference for runtime configuration in Stellar MarketPay.
Variables are grouped by layer. Every variable found via `process.env.*` in the
codebase is listed, along with its type, default, required status, and example.

---

## Backend (`backend/.env`)

### Required (startup fails without these)

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `DATABASE_URL` | `string` | — | PostgreSQL connection string used by the API and migrations. | Must be a valid PostgreSQL URL. Startup crashes if unset (`requireEnv`). | `postgresql://user:pass@localhost:5432/marketpay` |
| `JWT_SECRET` | `string` | — | Signing key for auth tokens. | Must be a non-empty string. Startup crashes if unset (`process.exit(1)` in `auth.js`). | `4c9d0f7d6f4f4c0f8d1b3b...` |
| `CSRF_SECRET` | `string` | `JWT_SECRET` (dev) / — (prod) | HMAC secret for signing `csrf-token` double-submit cookies. | **Required in production** — startup crashes if unset (`process.exit(1)` in `csrf.js`). Falls back to `JWT_SECRET` in dev/CI only. | `random-hmac-secret` |

### Network & Stellar

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `STELLAR_NETWORK` | `string` | `testnet` | Network selector for auth, Soroban RPC, and contract behavior. | Must be `testnet` or `mainnet` (enforced by `requireChoice`). | `testnet` |
| `HORIZON_URL` | `string` | `https://horizon-testnet.stellar.org` | Horizon endpoint used by the indexer, escrow service, faucet, gas estimator, and account cache. | — | `https://horizon.stellar.org` |
| `SOROBAN_RPC_URL` | `string` | `https://rpc-testnet.stellar.org` (or `https://rpc.mainnet.stellar.org` based on `STELLAR_NETWORK`) | Soroban RPC endpoint for contract interactions. | — | `https://rpc.mainnet.stellar.org` |
| `STELLAR_RPC_URL` | `string` | — | Fallback Soroban RPC URL (used when `SOROBAN_RPC_URL` is not set). | — | `https://rpc-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | `string` | `Test SDF Network ; September 2015` | Network passphrase for Soroban transaction construction. | Overrides the auto-detected passphrase. | `Public Global Stellar Network ; September 2015` |
| `CONTRACT_ID` | `string` | — | Soroban escrow contract ID used by the backend indexer. | Must be a deployed contract address. Falls back to `ESCROW_CONTRACT_ID`. | `C...` |
| `ESCROW_CONTRACT_ID` | `string` | — | Legacy alias for `CONTRACT_ID`; kept for backward compatibility. | — | `C...` |
| `DISPUTE_CONTRACT_ID` | `string` | — | Soroban dispute-evidence contract ID (preferred over `ESCROW_CONTRACT_ID`). | — | `C...` |
| `ARBITRATOR_REGISTRY_CONTRACT_ID` | `string` | — | Contract ID for the arbitrator registry. | — | `C...` |
| `NEXT_PUBLIC_CONTRACT_ID` | `string` | — | Fallback contract ID read by backend during dispute evidence resolution. | — | `C...` |
| `PLATFORM_WALLET_ADDRESS` | `string` | — | Stellar address of the platform fee wallet. | — | `GABC...` |
| `HOME_DOMAIN` | `string` | `localhost:4000` | SEP-10 home domain used in challenge transactions. | — | `marketpay.io` |
| `SERVER_PRIVATE_KEY` | `string` | Random per boot | Stellar keypair secret used to build SEP-10 challenge transactions. | Should be set in production so challenge transactions are deterministic. | `S...` |

### Server

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `PORT` | `number` | `4000` | HTTP port for the Express API. | — | `4000` |
| `NODE_ENV` | `string` | `development` | Runtime environment. | Affects CORS strictness, CSRF fallback, cookie security, error detail, GraphQL introspection, and faucet rate limiting. | `production` |
| `ALLOWED_ORIGINS` | `string` (comma-sep) | `http://localhost:3000` (dev) / empty (prod) | Comma-separated CORS allowlist. | Each origin must be a valid URL origin. In production with no value, all cross-origin requests are denied. | `http://localhost:3000,https://app.example.com` |
| `TRUSTED_PROXY_IPS` | `string` (comma-sep) | — | Comma-separated IPs/CIDRs trusted to set `X-Forwarded-For` for client IP resolution. | — | `10.0.0.0/8,172.16.0.1` |
| `LOG_LEVEL` | `string` | `info` | Pino log level. | — | `debug` |
| `METRICS_SECRET` | `string` | — | Bearer token required to access `GET /metrics`. When unset, the endpoint is public. | — | `my-secret-token` |
| `RATE_LIMIT_SCALE` | `number` | `1` | Multiplier applied to every rate-limit `max` value. Useful in load-test environments. | Must be >= 1. | `1000` |
| `API_RATE_LIMITS_JSON` | `string` (JSON) | — | JSON object overriding per-endpoint API key rate limits. Shape matches the defaults in `config/apiRateLimits.js`. | Parsed at startup; logs a warning on invalid JSON. | `{"public_jobs": 120}` |
| `FAUCET_RATE_LIMIT` | `number` | `20` (dev) / `5` (prod) | Max faucet requests per minute per IP. | — | `10` |

### Database

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `DATABASE_POOL_MIN` | `number` | `2` | Minimum database pool connections. | — | `2` |
| `DATABASE_POOL_MAX` | `number` | `10` | Maximum database pool connections. | — | `20` |
| `DATABASE_POOL_SIZE` | `number` | `10` | Legacy alias for `DATABASE_POOL_MAX` (lower precedence). | — | `10` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `number` | `30000` | Time (ms) after which idle connections are closed. | — | `30000` |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `number` | `5000` | Time (ms) to wait for a new connection from the pool. | — | `5000` |
| `DATABASE_ENCRYPTION_KEY` | `string` | — | Key used by `pgp_sym_encrypt`/`pgp_sym_decrypt` to protect sensitive profile fields at rest. | Must be at least 16 characters when set. Throws at runtime otherwise. | `a-16-char-key-min` |
| `ENCRYPTION_KEY` | `string` | `JWT_SECRET` | Fallback key for general-purpose encryption (e.g., `utils/encryption.js`). | — | `random-secret` |
| `POOL_ALERT_WEBHOOK_URL` | `string` | — | Webhook URL called when the database pool is exhausted for >10 seconds. | — | `https://hooks.slack.com/...` |

### Authentication & Security

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `CSRF_SECRET` | `string` | `JWT_SECRET` (dev) / — (prod) | HMAC secret for signing `csrf-token` double-submit cookies. | **Required in production** — startup crashes if unset. Falls back to `JWT_SECRET` in dev. | `random-hmac-secret` |
| `SIGNED_URL_SECRET` | `string` | `JWT_SECRET` or `change-me-in-production` | Secret used to sign IPFS file access URLs. | — | `my-signing-secret` |
| `STELLAR_SERVICE_SECRET` | `string` | — | Stellar service keypair secret for backend-to-contract calls (timeout refund, admin ops). | Must be a valid Ed25519 secret key. Throws if invalid. | `S...` |
| `STELLAR_SERVICE_ALLOWED_IPS` | `string` (comma-sep) | — | IPs allowed to use the Stellar service key for contract operations. | — | `10.0.0.1,10.0.0.2` |

### WebAuthn

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `WEBAUTHN_RP_ID` | `string` | `localhost` | WebAuthn Relying Party ID. | — | `app.marketpay.io` |
| `WEBAUTHN_RP_NAME` | `string` | `Stellar MarketPay` | WebAuthn Relying Party display name. | — | `Stellar MarketPay` |
| `WEBAUTHN_ORIGIN` | `string` | `http://localhost:3000` | WebAuthn allowed origin. | — | `https://app.marketpay.io` |

### Email (SMTP)

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `SMTP_HOST` | `string` | — | SMTP host for email notifications (weekly digest, job alerts, verification). | Required when email features are enabled. | `smtp.mailgun.org` |
| `SMTP_PORT` | `number` | `587` | SMTP port. | — | `587` |
| `SMTP_USER` | `string` | — | SMTP username. | Required when email features are enabled. | `postmaster@example.com` |
| `SMTP_PASS` | `string` | — | SMTP password. | Required when email features are enabled. | `secret` |
| `SMTP_FROM` | `string` | `SMTP_USER` | Sender address for outbound mail. | — | `noreply@example.com` |

### URLs & Base URLs

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `BASE_URL` | `string` | `http://localhost:3000` | Base URL used in RSS/Atom feed links. | — | `https://marketpay.io` |
| `FRONTEND_URL` | `string` | `http://localhost:3000` | Frontend origin embedded in email notification links (digest, alerts, invitations). | — | `https://app.marketpay.io` |
| `API_BASE_URL` | `string` | `http://localhost:4000` | Backend origin used in digest email unsubscribe links and Swagger docs. | — | `https://api.marketpay.io` |

### IPFS / Pinata

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `PINATA_API_KEY` | `string` | — | Pinata API key for IPFS uploads. | — | `pinata-key` |
| `PINATA_SECRET_KEY` | `string` | — | Pinata secret key for IPFS uploads. | — | `pinata-secret` |
| `PINATA_API_URL` | `string` | `https://api.pinata.cloud` | Override for the Pinata API base URL. | — | `https://api.pinata.cloud` |

### Web Push (VAPID)

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` | `string` | — | VAPID public key for Web Push notifications. | Both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` must be set to enable push. | `B...` |
| `VAPID_PRIVATE_KEY` | `string` | — | VAPID private key for Web Push notifications. | — | `...` |
| `VAPID_SUBJECT` | `string` | `mailto:notifications@stellar-marketpay.com` | VAPID contact subject (mailto: or URL). | — | `mailto:admin@marketpay.io` |

### Admin

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `ADMIN_WALLET_ADDRESSES` | `string` (comma-sep) | — | Comma-separated Stellar addresses granted admin privileges (dispute rate-limit bypass, notification admin). | — | `GABC...,GDEF...` |
| `ADMIN_PUBLIC_KEY` | `string` | — | Single admin Stellar public key for dispute resolution (`/api/jobs/:id/resolve`). | — | `GABC...` |
| `ADMIN_PUBLIC_KEYS` | `string` (comma-sep) | — | Comma-separated admin public keys for skill assessments and audit log access. | — | `GABC...,GDEF...` |
| `ADMIN_EMAIL` | `string` (comma-sep) | — | Comma-separated admin email addresses receiving the weekly PDF report. | — | `admin@marketpay.io` |

### S3 (Admin Reports)

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `S3_ENDPOINT` | `string` | — | S3-compatible endpoint URL (e.g., AWS S3 or MinIO). | If set, `forcePathStyle` is enabled (required for MinIO). | `https://s3.amazonaws.com` |
| `S3_BUCKET` | `string` | `marketpay-reports` | S3 bucket for weekly admin report PDFs. | — | `marketpay-reports` |
| `S3_REGION` | `string` | `us-east-1` | S3 region. | — | `us-west-2` |
| `S3_ACCESS_KEY` | `string` | — | S3 access key ID. | Required for S3 storage. | `AKIA...` |
| `S3_SECRET_KEY` | `string` | — | S3 secret access key. | Required for S3 storage. | `...` |

### Redis

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `REDIS_URL` | `string` | `redis://localhost:6379` | Redis connection string used by cache service and queue. | — | `redis://:password@host:6379` |
| `REDIS_HOST` | `string` | `127.0.0.1` | Redis host (used by `utils/queue.js` when `REDIS_URL` is an object). | — | `10.0.0.5` |
| `REDIS_PORT` | `number` | `6379` | Redis port (used by `utils/queue.js` when `REDIS_URL` is an object). | — | `6379` |

### TSS Turrets

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `TURRET_URL` | `string` | `https://tss.stellar.org` | TSS turret base URL. | — | `https://tss.stellar.org` |
| `TURRET_API_KEY` | `string` | — | TSS turret API key. | — | `turrets-api-key` |

### AI / Claude

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `CLAUDE_API_KEY` | `string` | — | Anthropic Claude API key for proposal scoring and job description analysis. | Required when AI scoring features are enabled. Throws at runtime if unset. | `sk-ant-...` |

### Miscellaneous

| Variable | Type | Default | Description | Validation | Example |
|---|---|---|---|---|---|
| `GITHUB_TOKEN` | `string` | — | GitHub personal access token for the contributors endpoint (increases API rate limit). | — | `ghp_...` |
| `npm_package_version` | `string` | `1.0.0` | npm-provided package version, exposed on the `/health` endpoint. | Read-only; set by npm. | `1.2.3` |

### CI-only variables

These variables are only read in test files and are not required at runtime:

| Variable | Type | Default | Description | Example |
|---|---|---|---|---|
| `TEST_DATABASE_URL` | `string` | `DATABASE_URL` | PostgreSQL connection string for integration tests. Falls back to `DATABASE_URL`. | `postgresql://test:test@localhost:5432/marketpay_test` |

---

## Frontend (`frontend/.env.local`)

### Public (browser) variables — `NEXT_PUBLIC_*`

| Variable | Required | Default | Description | Validation | Example |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | `http://localhost:4000` | Base URL for the backend API. | Must be a valid URL origin. | `https://api.marketpay.io` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `testnet` | Network label used by browser client and wallet flows. | `testnet` or `mainnet`. | `mainnet` |
| `NEXT_PUBLIC_HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon endpoint exposed to the browser client. | — | `https://horizon.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint used when building transactions in the browser. | — | `https://soroban-mainnet.stellar.org` |
| `NEXT_PUBLIC_CONTRACT_ID` | Yes unless mock mode | — | Soroban escrow contract ID used by the browser client. | Required when `NEXT_PUBLIC_USE_CONTRACT_MOCK` is not `true`. | `C...` |
| `NEXT_PUBLIC_USE_CONTRACT_MOCK` | No | `false` | Enables offline mock contract behavior for local dev and E2E tests. | — | `true` |
| `NEXT_PUBLIC_CDN_URL` | No | — | CDN URL used as `assetPrefix` in `next.config.mjs`. | — | `https://cdn.marketpay.io` |
| `NEXT_PUBLIC_BASE_URL` | No | `https://stellar-marketpay.com` | Base URL for referral dashboard links. | — | `https://marketpay.io` |
| `NEXT_PUBLIC_SITE_URL` | No | — | Site URL used in Open Graph image generation. | Must be a valid URL. | `https://marketpay.io` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | No | — | USDC token contract ID for testnet asset configuration. | — | `C...` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID_MAINNET` | No | — | USDC token contract ID for mainnet asset configuration. | — | `C...` |
| `NEXT_PUBLIC_ANCHOR_HOME_DOMAIN` | No | — | Anchor home domain for SEP-24/SEP-6 anchor integration. | — | `anchor.marketpay.io` |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | No | — | Treasury Stellar address for job boost payments. | — | `GABC...` |

### Server-side only (Next.js `next.config.mjs`)

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `IMAGE_CDN_URL` | No | — | Base URL for profile image CDN, configured as `images.path` in `next.config.mjs`. | `https://images.marketpay.io` |

---

## Validation Rules

| Rule | Location |
|---|---|
| Backend startup fails fast when `DATABASE_URL` or `JWT_SECRET` are missing. | `backend/src/db/pool.js`, `backend/src/middleware/auth.js` |
| `STELLAR_NETWORK` must be `testnet` or `mainnet`; startup fails if set to an invalid value. | `backend/src/server.js` (via `requireChoice`) |
| `CSRF_SECRET` is required in `NODE_ENV=production`; startup crashes if unset. | `backend/src/middleware/csrf.js` |
| `DATABASE_ENCRYPTION_KEY` must be at least 16 characters when used; runtime error otherwise. | `backend/src/services/encryptionService.js` |
| `STELLAR_SERVICE_SECRET` must be a valid Ed25519 secret key; runtime error if invalid. | `backend/src/services/stellarServiceKey.js` |
| `CLAUDE_API_KEY` is checked at runtime — API endpoints return 500 when unset and called. | `backend/src/routes/aiScorer.js`, `backend/src/services/aiService.js` |
| Frontend contract calls fail fast when `NEXT_PUBLIC_CONTRACT_ID` is missing and mock mode is disabled. | `frontend/lib/stellar.ts` |
| `CONTRACT_ID` is required by the indexer; falls back to `ESCROW_CONTRACT_ID`, then `NEXT_PUBLIC_CONTRACT_ID`. | `backend/src/services/indexerService.js`, `backend/src/services/sorobanEvidence.js` |

## Migration from Legacy Variables

The following renames are in progress. Old names still work but will be removed in a future release:

| Legacy | Replacement | Used In |
|---|---|---|
| `ESCROW_CONTRACT_ID` | `CONTRACT_ID` | `indexerService.js`, `sorobanEvidence.js` |
| `DATABASE_POOL_SIZE` | `DATABASE_POOL_MAX` | `routes/health.js` |
| `STELLAR_RPC_URL` | `SOROBAN_RPC_URL` | `sorobanEvidence.js` |
