# API Reference — Stellar MarketPay

Base URL: `http://localhost:4000`

All responses: `{ "success": true, "data": {...} }` or `{ "success": false, "error": "..." }`

Interactive reference: **`/api/docs`** (Swagger UI, generated from the OpenAPI 3.0 spec in [`backend/docs/openapi.yaml`](../backend/docs/openapi.yaml)). Regenerate with `npm run generate-openapi` in `backend/`.

## Authentication Schemes
| Scheme | How | Used by |
|--------|-----|---------|
| JWT Bearer | `Authorization: Bearer <token>` or `jwt` cookie, obtained via `/api/auth` challenge-response | Most endpoints |
| Developer API Key | `x-api-key` header | `/api/public/*` |

---

## Health & Utility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status check (Postgres, Redis, Horizon; 503 when any is down) |
| GET | `/api/health/db` | Connection pool stats for monitoring |
| GET | `/api/rate-limit` | Get current rate limit usage |

---

## Authentication
Stellar wallet-based challenge/response (SEP-10 style).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth` | Get authentication challenge transaction |
| POST | `/api/auth` | Authenticate with signed challenge transaction |
| GET | `/api/auth/csrf-token` | Issue a CSRF token for double-submit protection |

---

## Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs (`?status=open&category=...&limit=50&include_expired=false`) |
| GET | `/api/jobs/:id` | Get single job |
| GET | `/api/jobs/client/:publicKey` | Jobs posted by a client |
| POST | `/api/jobs` | Create a new job |
| POST | `/api/jobs/:id/view` | Increment view count for a job |
| PATCH | `/api/jobs/:id/extend` | Extend job deadline (Client only) |

### POST /api/jobs
```json
{
  "title": "Build a Soroban escrow contract",
  "description": "We need a Rust developer...",
  "budget": "500.0000000",
  "category": "Smart Contracts",
  "skills": ["Rust", "Soroban", "Stellar"],
  "clientAddress": "GABC...XYZ",
  "deadline": "2025-12-31"
}
```

---

## Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/applications/job/:jobId` | All applications for a job |
| GET | `/api/applications/freelancer/:publicKey` | A freelancer's applications |
| POST | `/api/applications` | Submit a proposal |
| POST | `/api/applications/:id/accept` | Client accepts a proposal |

### POST /api/applications
```json
{
  "jobId": "uuid-here",
  "freelancerAddress": "GXYZ...ABC",
  "proposal": "I have 5 years of Rust experience...",
  "bidAmount": "450.0000000"
}
```

---

## Profiles

`/api/freelancers/*` is an alias of this router.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profiles` | List profiles |
| GET | `/api/profiles/:publicKey` | Get a user profile |
| POST | `/api/profiles` | Create or update a profile |
| PUT | `/api/profiles/:publicKey` | Update own profile |
| GET | `/api/profiles/:publicKey/stats` | Profile statistics |
| GET | `/api/profiles/:publicKey/earnings` | Freelancer earnings history |
| GET | `/api/profiles/:publicKey/spending` | Client spending analytics |
| GET | `/api/profiles/:publicKey/client-reputation` | Client reputation |
| GET | `/api/profiles/:publicKey/response-time` | Freelancer response time |
| GET | `/api/profiles/:publicKey/endorsements` | Skill endorsements |
| POST | `/api/profiles/:publicKey/endorse` | Endorse a skill |
| POST | `/api/profiles/:publicKey/availability` | Update availability status |
| GET | `/api/profiles/:publicKey/encryption-key` | NaCl encryption public key (public lookup) |
| PUT | `/api/profiles/:publicKey/encryption-key` | Store X25519 encryption public key |
| GET | `/api/profiles/:publicKey/price-alerts` | Price alert preferences |
| POST | `/api/profiles/:publicKey/price-alerts` | Update price alert preferences |
| DELETE | `/api/profiles/:publicKey/data` | GDPR deletion request (30-day grace period) |

---

## Onboarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/onboarding/:publicKey` | Get onboarding progress for a user |
| PATCH | `/api/onboarding` | Update onboarding progress |

---

## Escrow

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/escrow/:jobId/release` | Client releases payment to freelancer |
| POST | `/api/escrow/:jobId/partial_release` | Release part of the funded amount |
| POST | `/api/escrow/:jobId/release-milestone` | Release an approved milestone |
| POST | `/api/escrow/:jobId/reject-milestone` | Reject a milestone deliverable |
| POST | `/api/escrow/:jobId/dispute-milestone` | Open a dispute over a milestone |
| POST | `/api/escrow/:jobId/refund` | Refund the client |
| POST | `/api/escrow/:jobId/timeout-refund` | Automatic refund after timeout |
| GET | `/api/escrow/:jobId` | Get escrow state for a job |
| POST | `/api/escrow/:jobId/recurring` | Set up a recurring escrow |
| GET | `/api/escrow/:jobId/recurring` | Get recurring escrow schedule |
| POST | `/api/escrow/:jobId/recurring/cancel` | Cancel a recurring escrow |
| POST | `/api/escrow/verify-freelancer` | Verify freelancer funding signature |

### POST /api/escrow/:jobId/release
```json
{ "clientAddress": "GABC...XYZ" }
```

---

## Ratings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ratings/:publicKey` | List ratings for a user |
| POST | `/api/ratings` | Submit a rating for a completed job |

---

## Progress

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/progress/:jobId` | Get progress updates for a job |
| POST | `/api/progress` | Add a progress update |

---

## Messages

Message bodies are end-to-end encrypted; see [messaging-encryption.md](messaging-encryption.md).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages/job/:jobId` | Get messages for a job thread |
| POST | `/api/messages/job/:jobId` | Send a message in a job thread |
| POST | `/api/messages/job/:jobId/attachments` | Upload an encrypted file attachment |
| GET | `/api/messages/unread-count` | Total unread message count |
| PATCH | `/api/messages/:messageId/tx-hash` | Attach on-chain tx hash to a message |

---

## Insights

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/insights` | Platform-wide analytics summary |
| GET | `/api/insights/categories` | Category insights |
| GET | `/api/insights/skills` | Skill demand insights |
| GET | `/api/insights/trends/pay` | Pay trends over time |
| GET | `/api/insights/competitive` | Competitive job listings |

---

## Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Platform-wide metrics |
| GET | `/api/stats/categories` | Top job categories |
| GET | `/api/stats/trends/jobs` | Job posting trends |
| GET | `/api/stats/trends/escrow` | Escrow volume trends |
| GET | `/api/stats/xlm-price-history` | 7-day XLM/USD price history |

---

## Notifications

Push notifications use VAPID web push; see [WEB_PUSH_SETUP.md](WEB_PUSH_SETUP.md).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List in-app notifications |
| PATCH | `/api/notifications/:id/read` | Mark a notification as read |
| PATCH | `/api/notifications/read-all` | Mark all notifications as read |
| GET | `/api/notifications/preferences` | Get notification preferences |
| PATCH | `/api/notifications/preferences` | Update notification preferences |
| GET | `/api/notifications/vapid-public-key` | VAPID public key for push subscriptions |
| POST | `/api/notifications/push-subscribe` | Save a push subscription |
| POST | `/api/notifications/push-unsubscribe` | Remove a push subscription |
| GET | `/api/notifications/unsubscribe` | Unsubscribe from weekly digest (HTML page, no auth) |
| GET | `/api/notifications/failed-webhooks` | List failed webhooks (admin only) |
| POST | `/api/notifications/failed-webhooks/:id/retry` | Retry a failed webhook (admin only) |

---

## WebAuthn (Passkeys)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webauthn/register-options` | Get registration options |
| POST | `/api/webauthn/register-verify` | Verify and store a credential |
| POST | `/api/webauthn/login-options` | Get login options |
| POST | `/api/webauthn/login-verify` | Verify authentication, issue JWT |
| GET | `/api/webauthn/credentials` | List registered passkeys |
| DELETE | `/api/webauthn/credentials/:id` | Remove a passkey |
| GET | `/api/webauthn/admin/credentials` | Admin: list credentials for any user |
| DELETE | `/api/webauthn/admin/credentials/:id` | Admin: revoke a passkey |

---

## Disputes

Evidence files are stored on IPFS; see [ADR-006](adr/ADR-006-ipfs-dispute-evidence.md) if present or [dispute_resolution_logic.md](dispute_resolution_logic.md).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/disputes/:jobId` | Dispute details and evidence list |
| POST | `/api/disputes/:jobId/evidence` | Upload dispute evidence file |
| GET | `/api/disputes/:jobId/evidence/:id/url` | Generate signed URL for evidence access |
| GET | `/api/disputes/:jobId/onchain-cids` | Chain-attested evidence CID list |

---

## Verification

Email, phone, and ID verification.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/verification/:publicKey` | Verification status for a user |
| POST | `/api/verification/email` | Send email verification link |
| POST | `/api/verification/email/confirm` | Confirm email verification with token |
| POST | `/api/verification/phone` | Send phone verification OTP |
| POST | `/api/verification/phone/confirm` | Confirm phone verification with OTP |
| POST | `/api/verification/id/submit` | Submit ID verification for admin review |

---

## Saved Searches

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/saved-searches` | List saved searches (max 10) |
| POST | `/api/saved-searches` | Save a new search |
| PATCH | `/api/saved-searches/:id` | Update notification preferences |
| DELETE | `/api/saved-searches/:id` | Delete a saved search |

---

## Price Alerts

XLM price alerts (rate limited to 10 req/min).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/price-alerts` | List active alerts for authenticated user |
| POST | `/api/price-alerts` | Create an alert (`{ condition: "above"\|"below", threshold, oneTime? }`) |
| DELETE | `/api/price-alerts/:id` | Delete an alert |

---

## DAO Governance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dao/proposals` | List DAO proposals |
| GET | `/api/dao/proposals/:id` | Proposal details |
| POST | `/api/dao/proposals` | Create a proposal (`funding`, `parameter_change`, `arbitrator_election`) |
| POST | `/api/dao/proposals/:id/vote` | Cast a vote |
| POST | `/api/dao/proposals/:id/execute` | Execute a passed proposal (admin only) |
| GET | `/api/dao/arbitrators` | List arbitrators and top panel |
| GET | `/api/dao/arbitrators/:publicKey` | Arbitrator profile |
| POST | `/api/dao/arbitrators` | Register as an arbitrator |
| POST | `/api/dao/arbitrators/:publicKey/vote` | Vote for an arbitrator |
| GET | `/api/dao/treasury` | Treasury summary |

---

## Proposal Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/proposal-templates` | List templates for authenticated freelancer |
| POST | `/api/proposal-templates` | Create a template |
| PATCH | `/api/proposal-templates/:id` | Update a template |
| DELETE | `/api/proposal-templates/:id` | Delete a template |

---

## NFT Certificates

Proof-of-work certificates minted on job completion.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nft/job/:jobId` | Certificate for a job |
| GET | `/api/nft/freelancer/:publicKey` | Certificates earned by a freelancer |
| POST | `/api/nft/mint-completion-certificate` | Record a minted certificate |

---

## Certificates & Assessments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/certificates/:id` | Certificate by ID |
| GET | `/api/certificates/user/:publicKey` | All certificates for a user |
| GET | `/api/assessments/:skill` | Assessment questions for a skill |
| POST | `/api/assessments/:skill/submit` | Submit assessment answers |
| GET | `/api/assessments/results/:publicKey` | Assessment results (public) |

---

## AI Scorer

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/score-job` | Score a job description using AI |

---

## Time Entries & Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/time-entries/job/:jobId` | Time entries for a job |
| POST | `/api/time-entries` | Log a time entry |
| POST | `/api/time-entries/invoice` | Generate invoice from time entries |
| GET | `/api/time-entries/job/:jobId/invoices` | Invoices for a job |
| PATCH | `/api/time-entries/invoice/:invoiceId/review` | Client approves or rejects an invoice |

---

## Invitations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/invitations` | Pending invitations for authenticated freelancer |
| POST | `/api/invitations/:id/accept` | Accept (auto-creates application) |
| PATCH | `/api/invitations/:id/decline` | Decline |

---

## Referrals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/referrals/info` | Referral bonus info (public) |
| GET | `/api/referrals/:publicKey` | Referral stats and history |
| POST | `/api/referrals/register` | Register a referral |

---

## Contract Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/:jobId` | Indexed contract events for a job |

---

## Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions/export` | Export transaction history as CSV |

---

## Gas Estimate

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gas-estimate` | Current Soroban fee estimate tiers |
| POST | `/api/gas-estimate/refresh` | Force-refresh cached estimates |

---

## Tokens

Stellar token (SAC) registry and balances.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tokens` | List supported tokens (cached 1h) |
| GET | `/api/tokens/popular` | Popular tokens |
| GET | `/api/tokens/search` | Search tokens by name or symbol |
| GET | `/api/tokens/:contractId/metadata` | Token metadata |
| GET | `/api/tokens/:contractId/balance/:publicKey` | Token balance for an account |
| POST | `/api/tokens/validate` | Validate a token contract ID |

---

## Categories & Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | Full category tree |
| GET | `/api/skills` | Skill autocomplete search |

---

## Faucet

Testnet XLM funding.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/faucet/status` | Faucet status and configuration |
| GET | `/api/faucet/check/:publicKey` | Check if an account needs funding |
| POST | `/api/faucet/fund` | Fund a testnet wallet |

---

## Turrets

Stellar Turrets for serverless contract execution.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/turrets/config` | Turret configuration |
| GET | `/api/turrets/status` | Turret service status |
| POST | `/api/turrets/estimate` | Estimate transaction fees |
| POST | `/api/turrets/submit` | Submit transaction via Turret |

---

## Contributors

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contributors` | Top GitHub contributors (cached 24h) |
| POST | `/api/contributors/refresh` | Refresh contributor cache |

---

## Scope Sessions

Collaborative scope session management.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scope/:sessionId/renew` | Extend a scope session by 24 hours |

---

## Audit Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit` | List audit logs (admin only, cursor pagination) |
| GET | `/api/audit/:jobId` | Audit logs for a specific job |

---

## Developer API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/developer/keys` | List API keys |
| POST | `/api/developer/keys` | Create a new API key |
| POST | `/api/developer/keys/:id/rotate` | Rotate an API key |
| DELETE | `/api/developer/keys/:id` | Revoke an API key |

---

## Public API

Requires `x-api-key` developer key unless noted.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/public/jobs` | List public jobs (API key required) |
| GET | `/api/public/jobs/:id` | Get public job by ID (API key required) |
| GET | `/api/public/freelancers/:publicKey` | Public freelancer profile (API key required) |
| GET | `/api/v1/public/jobs` | List public job listings (**no auth required**) |

---

## GraphQL

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/graphql` | GraphQL endpoint (queries/mutations over the same domain models) |

---

## Admin

All admin routes require admin role + 2FA (`requireAdminRole`, `requireAdmin2FA`). This list is illustrative; see `backend/src/routes/admin.js` for the authoritative set.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/2fa/setup` | Generate TOTP secret and QR code |
| POST | `/api/admin/2fa/verify` | Verify TOTP, enable 2FA, upgrade JWT |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users/:address/ban` | Ban a wallet address |
| POST | `/api/admin/users/:address/unban` | Unban a wallet address |
| POST | `/api/admin/wallets/:address/freeze` | Freeze a wallet |
| DELETE | `/api/admin/wallets/:address/freeze` | Unfreeze a wallet |
| GET | `/api/admin/wallets/frozen` | List frozen wallets |
| GET | `/api/admin/jobs` | Browse jobs |
| GET | `/api/admin/jobs/expired` | Expired jobs |
| POST | `/api/admin/jobs/:id/remove` | Remove a job |
| PATCH | `/api/admin/jobs/:jobId/cancel` | Cancel a job |
| POST | `/api/admin/jobs/:jobId/reactivate` | Reactivate a job |
| GET | `/api/admin/disputes` | All disputes |
| PATCH | `/api/admin/disputes/:jobId/resolve` | Resolve a dispute |
| GET | `/api/admin/reported-wallets` | Reported wallets |
| GET | `/api/admin/logs` | Admin action logs |
| GET | `/api/admin/audit-log` | Audit log |
| GET | `/api/admin/metrics` | Platform metrics |
| GET | `/api/admin/metrics/time-series` | Metrics time series |
| GET | `/api/admin/reports/latest` | Latest generated report |
| POST | `/api/admin/reports/generate` | Generate a report |
| GET | `/api/admin/cost-report` | Infrastructure cost report |
| POST | `/api/admin/cost-report/generate` | Generate cost report |

---

## Job Statuses

| Status | Meaning |
|--------|---------|
| `open` | Accepting applications |
| `in_progress` | Freelancer hired, work underway |
| `completed` | Escrow released, job done |
| `cancelled` | Cancelled by client |
| `expired` | Deadline passed without hiring |

---

## Rate Limit Headers
All API responses include the following headers:
- `X-RateLimit-Limit`: Maximum requests allowed in the window.
- `X-RateLimit-Remaining`: Remaining requests in the current window.
- `X-RateLimit-Reset`: Time when the limit resets (ISO 8601 format).
