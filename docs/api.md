# API Reference — Stellar MarketPay

Comprehensive REST API and WebSocket reference for the Stellar MarketPay backend.

All routes documented here match the active routes mounted in [`backend/src/server.js`](../backend/src/server.js).

---

## Overview & Interactive Documentation

The Stellar MarketPay API provides OpenAPI 3.0 specification support with Swagger UI for interactive testing and exploration:

- **Interactive Swagger UI**: `http://localhost:4000/api/docs`
- **OpenAPI JSON Spec**: `http://localhost:4000/api/docs/json`
- **OpenAPI Spec File**: Located at [`backend/docs/openapi.yaml`](../backend/docs/openapi.yaml)
- **Regenerate Spec**: Run `npm run generate-openapi` within the `backend/` directory.

### Base URL
- **Local Development**: `http://localhost:4000`
- **Production**: `https://api.stellarmarketpay.com`

### Standard Response Envelope
All API endpoints return standard JSON envelopes:

```json
// Success Response (2xx)
{
  "success": true,
  "data": { ... }
}

// Error Response (4xx, 5xx)
{
  "success": false,
  "error": "Error message explanation",
  "code": "OPTIONAL_ERROR_CODE"
}
```

### Rate Limiting & Headers
Standard global rate limits apply (150 requests per 15-minute window per IP, unless stricter route limits apply). Responses include standard rate-limiting headers:
- `X-RateLimit-Limit`: Maximum allowed requests within the active window.
- `X-RateLimit-Remaining`: Remaining request allowance in the current window.
- `X-RateLimit-Reset`: Timestamp when the window resets.

---

## Authentication Schemes

| Scheme | Format / Header | Description |
|---|---|---|
| **JWT Bearer Token** | `Authorization: Bearer <token>` or `jwt` HTTP cookie | Obtained via `/api/auth` wallet challenge-response. Used for authenticated client and freelancer actions. |
| **CSRF Token** | `x-csrf-token` header | Issued by `/api/auth/csrf-token` for double-submit cookie CSRF mitigation. |

---

## 1. Health & System Status

System health checks and indexer status monitoring.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Server and dependency status check (Postgres, Redis, Horizon; returns 503 if unhealthy) |
| GET | `/health/db` | Database connection pool statistics for health monitoring |
| GET | `/api/indexer/health` | Status and sync health of the background Stellar contract event indexer service |

---

## 2. Authentication (`/api/auth`)

Stellar wallet challenge-response authentication (SEP-10 style).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/csrf-token` | Issue a CSRF token for request protection |
| GET | `/api/auth` | Request a SEP-10 style challenge transaction for wallet signing |
| POST | `/api/auth` | Authenticate using signed challenge transaction; issues JWT token |
| POST | `/api/auth/refresh` | Refresh access token using active session |
| POST | `/api/auth/logout` | Clear authenticated session and cookies |

---

## 3. Jobs (`/api/jobs`)

Job management, search, lifecycle, drafts, and bulk actions.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/jobs` | List jobs (`?status=open&category=...&limit=50&include_expired=false`) |
| GET | `/api/jobs/:id` | Retrieve single job by ID |
| GET | `/api/jobs/client/:publicKey` | Retrieve jobs posted by a specific client |
| GET | `/api/jobs/recommended/:publicKey` | Get recommended jobs for a freelancer |
| GET | `/api/jobs/:id/timeline` | Get job lifecycle history and timeline events |
| GET | `/api/jobs/:id/invoice` | Generate invoice for completed job |
| POST | `/api/jobs` | Create a new job posting |
| PATCH | `/api/jobs/:id` | Update job details (Client only) |
| DELETE | `/api/jobs/:id` | Soft-delete a job (Client only) |
| POST | `/api/jobs/:id/view` | Increment view counter for a job |
| POST | `/api/jobs/:id/invite` | Send invitation to a freelancer |
| GET | `/api/jobs/:id/invitations` | List all invitations sent for a job |
| PATCH | `/api/jobs/:id/escrow` | Link on-chain Soroban escrow contract ID |
| POST | `/api/jobs/:id/boost` | Boost job ranking with promotional placement |
| GET | `/api/jobs/:id/analytics` | View analytics for a job posting |
| PATCH | `/api/jobs/:id/extend` | Extend job application deadline |
| POST | `/api/jobs/:id/referral` | Attach referral attribution to job |
| POST | `/api/jobs/:id/report` | Report job for moderation |
| POST | `/api/jobs/:id/dispute` | Escalate job to dispute resolution |
| POST | `/api/jobs/:id/resolve` | Resolve job dispute |
| GET | `/api/jobs/feed.rss` | RSS 2.0 job feed for syndication |
| GET | `/api/jobs/feed.atom` | Atom job feed for syndication |
| GET | `/api/jobs/drafts` | List saved job drafts for authenticated client |
| POST | `/api/jobs/drafts` | Save a job posting draft |
| GET | `/api/jobs/drafts/:id` | Retrieve single job draft |
| PUT | `/api/jobs/drafts/:id` | Update job draft |
| DELETE | `/api/jobs/drafts/:id` | Delete job draft |
| GET | `/api/jobs/suggest` | Search keyword and skill suggestions autocomplete |
| POST | `/api/jobs/batch` | Batch create multiple job postings |
| POST | `/api/jobs/bulk-cancel` | Bulk cancel multiple active jobs |
| POST | `/api/jobs/bulk-extend` | Bulk extend deadlines across jobs |
| POST | `/api/jobs/bulk-boost` | Bulk boost visibility for multiple jobs |

### POST /api/jobs Payload Example
```json
{
  "title": "Build a Soroban escrow contract",
  "description": "We need an experienced Rust/Soroban developer...",
  "budget": "500.0000000",
  "category": "Smart Contracts",
  "skills": ["Rust", "Soroban", "Stellar"],
  "clientAddress": "GABC...XYZ",
  "deadline": "2026-12-31"
}
```

---

## 4. Applications (`/api/applications`)

Proposals, bids, and hiring workflows.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/applications/job/:jobId` | Retrieve all proposals submitted for a job |
| GET | `/api/applications/freelancer/:publicKey` | Retrieve applications submitted by a freelancer |
| POST | `/api/applications` | Submit a proposal / bid for a job |
| POST | `/api/applications/job/:jobId/close-bidding` | Close bidding period on a job |
| POST | `/api/applications/:id/reveal` | Reveal sealed bid proposal |
| POST | `/api/applications/:id/accept` | Client accepts proposal and awards job |
| GET | `/api/applications/:id/history` | Proposal edit and review history |
| DELETE | `/api/applications/:id` | Withdraw proposal (Freelancer only) |
| POST | `/api/applications/bulk-update` | Bulk update proposal statuses |

### POST /api/applications Payload Example
```json
{
  "jobId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "freelancerAddress": "GXYZ...ABC",
  "proposal": "I have 4 years of Rust and Soroban smart contract development experience...",
  "bidAmount": "450.0000000"
}
```

---

## 5. Profiles (`/api/profiles`)

Freelancer and client profile management.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/profiles` | List public profiles with pagination and search |
| GET | `/api/profiles/:publicKey` | Get profile details for a Stellar public key |
| POST | `/api/profiles` | Create a new user profile |
| PUT | `/api/profiles/:publicKey` | Update existing profile details |
| PATCH | `/api/profiles/:publicKey` | Partially update profile |
| GET | `/api/profiles/:publicKey/stats` | Profile statistics (jobs completed, ratings) |
| GET | `/api/profiles/:publicKey/response-time` | Average response time metrics |
| GET | `/api/profiles/:publicKey/notifications` | Profile notifications |
| POST | `/api/profiles/:publicKey/notifications` | Trigger notification to user |
| PATCH | `/api/profiles/:publicKey/notificationPreferences` | Update notification preferences |
| POST | `/api/profiles/:publicKey/availability` | Update freelancer availability status |
| GET | `/api/profiles/:publicKey/price-alerts` | Retrieve user price alert settings |
| POST | `/api/profiles/:publicKey/price-alerts` | Update user price alert settings |
| GET | `/api/profiles/:publicKey/endorsements` | Skill endorsements received by user |
| POST | `/api/profiles/:publicKey/endorse` | Endorse a skill for a freelancer |
| GET | `/api/profiles/:publicKey/spending` | Client total spend and history analytics |
| GET | `/api/profiles/:publicKey/client-reputation` | Client reputation metrics |
| POST | `/api/profiles/:publicKey/block` | Block communication from another user |
| DELETE | `/api/profiles/:publicKey/block/:address` | Unblock a user address |
| GET | `/api/profiles/:publicKey/earnings` | Freelancer earnings history |
| POST | `/api/profiles/:publicKey/portfolio` | Add portfolio showcase item |
| POST | `/api/profiles/:publicKey/portfolio-files` | Upload media files for portfolio |
| DELETE | `/api/profiles/:publicKey/portfolio/:itemId` | Remove portfolio item |
| GET | `/api/profiles/:publicKey/encryption-key` | Lookup user X25519 public encryption key |
| PUT | `/api/profiles/:publicKey/encryption-key` | Register or update X25519 public key |
| POST | `/api/profiles/migrate` | Migrate legacy profile data |
| DELETE | `/api/profiles/:publicKey/data` | GDPR account data deletion request |

---

## 6. Escrow & Milestones (`/api/escrow`)

Soroban smart contract escrow operations and milestone management.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/escrow/create` | Record initialization of on-chain escrow |
| GET | `/api/escrow/:jobId` | Retrieve escrow state and locked balance for a job |
| POST | `/api/escrow/:jobId/release` | Client releases full escrow balance to freelancer |
| POST | `/api/escrow/:jobId/partial_release` | Release partial amount of escrow |
| POST | `/api/escrow/:jobId/release-milestone` | Release payment for an approved milestone |
| POST | `/api/escrow/:jobId/reject-milestone` | Reject submitted milestone deliverable |
| POST | `/api/escrow/:jobId/dispute-milestone` | Open dispute on milestone |
| POST | `/api/escrow/:jobId/refund` | Refund escrow balance back to client |
| POST | `/api/escrow/:jobId/timeout-refund` | Trigger refund when milestone or deadline expires |
| POST | `/api/escrow/:jobId/recurring` | Configure recurring escrow disbursement |
| GET | `/api/escrow/:jobId/recurring` | Check recurring escrow schedule |
| POST | `/api/escrow/:jobId/recurring/cancel` | Cancel recurring escrow |
| POST | `/api/escrow/verify-freelancer` | Verify freelancer wallet signature |
| POST | `/api/escrow/:jobId/extend` | Propose escrow deadline extension |
| POST | `/api/escrow/:jobId/extend/approve` | Accept proposed escrow deadline extension |
| POST | `/api/escrow/:jobId/deliverable-hash` | Record SHA-256 deliverable hash in escrow |
| POST | `/api/escrow/:jobId/milestones/:milestoneIndex/proof` | Submit milestone completion deliverable proof |
| POST | `/api/escrow/:jobId/milestones/:milestoneIndex/proof/anchor` | Anchor deliverable proof to Stellar ledger |

---

## 7. Ratings & Reviews (`/api/ratings`)

Feedback submitted following completed jobs.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/ratings/:publicKey` | Retrieve reviews and ratings received by a user |
| POST | `/api/ratings` | Submit rating and feedback for completed job |

---

## 8. Progress Updates (`/api/progress`)

Deliverable status checkpoints during active contracts.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/progress/:jobId` | Retrieve progress update logs for a job |
| POST | `/api/progress` | Submit a progress milestone update |

---

## 9. Contract Events (`/api/events`)

Indexed on-chain events from the Soroban contract.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events/:jobId` | Retrieve indexed Soroban contract events for a job |

---

## 10. Statistics & Price History (`/api/stats`)

Platform metrics and market data.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stats` | Platform-wide summary statistics |
| GET | `/api/stats/trends/jobs` | Historical job posting trend metrics |
| GET | `/api/stats/trends/escrow` | Escrow volume transaction trends |
| GET | `/api/stats/categories` | Distribution of jobs across categories |
| GET | `/api/stats/xlm-price-history` | 7-day XLM/USD price history from feed |

---

## 11. Contributors (`/api/contributors`)

Repository and ecosystem contributor recognition.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/contributors` | List top open-source contributors |
| POST | `/api/contributors/refresh` | Force-refresh contributor GitHub statistics |

---

## 12. Verification (`/api/verification`)

Identity, email, and phone validation.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/verification/:publicKey` | Check user verification tier and status |
| POST | `/api/verification/email` | Send email verification token |
| POST | `/api/verification/email/confirm` | Confirm email verification token |
| POST | `/api/verification/phone` | Send SMS verification code |
| POST | `/api/verification/phone/confirm` | Verify phone SMS code |
| POST | `/api/verification/id/submit` | Submit identity documents for verification review |

---

## 13. NFT Certificates (`/api/nft`)

On-chain proof-of-work completion certificates.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nft/job/:jobId` | Get completion certificate metadata for a job |
| GET | `/api/nft/freelancer/:publicKey` | List certificates earned by a freelancer |
| POST | `/api/nft/mint-completion-certificate` | Record a newly minted job certificate |

---

## 14. AI Scorer (`/api/ai-scorer` & `/api/ai`)

AI-assisted scoring for jobs and proposals.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/ai-scorer/score-job` | Evaluate quality and clarity of a job post |
| POST | `/api/ai-scorer/score-proposal` | Evaluate relevance and fit of a proposal |
| POST | `/api/ai-scorer/score` | General text scoring endpoint |

*(Also mounted at `/api/ai/*` for convenience.)*

---

## 15. Anchors (`/api/anchors`)

Stellar SEP-24 / SEP-31 anchor integrations.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/anchors` | List supported deposit/withdrawal Stellar anchors |

---

## 16. Gas & Fee Estimator (`/api/gas-estimate`)

Soroban transaction resource fee estimation.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/gas-estimate` | Current fee estimation tiers for contract calls |
| POST | `/api/gas-estimate/refresh` | Refresh cached Soroban network fee metrics |

---

## 17. Transactions (`/api/transactions`)

Transaction exports and logs.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/transactions/export` | Export wallet transaction history as CSV |

---

## 18. DAO Governance (`/api/dao`)

Community proposals, voting, and arbitration.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/dao/proposals` | List DAO governance proposals |
| GET | `/api/dao/proposals/:id` | Get details and vote counts for a proposal |
| POST | `/api/dao/proposals` | Create a new governance proposal |
| POST | `/api/dao/proposals/:id/vote` | Cast vote on an active proposal |
| POST | `/api/dao/proposals/:id/execute` | Execute a approved passed proposal |
| GET | `/api/dao/treasury` | Treasury balance and allocation summary |
| GET | `/api/dao/arbitrators` | List approved community dispute arbitrators |
| GET | `/api/dao/arbitrators/:publicKey` | Retrieve arbitrator profile and resolution records |
| POST | `/api/dao/arbitrators` | Apply for arbitrator role |
| POST | `/api/dao/arbitrators/:publicKey/vote` | Vote for an arbitrator candidate |

---

## 19. Proposal Templates (`/api/proposal-templates`)

Freelancer proposal reusable templates.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/proposal-templates` | List proposal templates for authenticated user |
| POST | `/api/proposal-templates` | Create a proposal template |
| PATCH | `/api/proposal-templates/:id` | Update proposal template |
| DELETE | `/api/proposal-templates/:id` | Delete proposal template |

---

## 20. Price Alerts (`/api/price-alerts`)

XLM/USD price threshold triggers.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/price-alerts` | List active price alerts for authenticated user |
| POST | `/api/price-alerts` | Create new price alert (`condition: "above"\|"below"`, `threshold`) |
| DELETE | `/api/price-alerts/:id` | Remove price alert |

---

## 21. Collaborative Scope Sessions (`/api/scope`)

Project scoping collaborative session management.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/scope/:sessionId` | Retrieve current scope document state |
| POST | `/api/scope` | Create a new scope session |
| PUT | `/api/scope` | Update session content |
| POST | `/api/scope/:sessionId` | Update specific session content |
| PUT | `/api/scope/:sessionId` | Update specific session content |
| POST | `/api/scope/:sessionId/renew` | Extend session expiration by 24 hours |

---

## 22. Stellar Turrets (`/api/turrets`)

Smart contract orchestration via Stellar Turrets.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/turrets/config` | Retrieve active turret configuration |
| GET | `/api/turrets/status` | Check turret network availability |
| POST | `/api/turrets/estimate` | Estimate execution fee for turret tx |
| POST | `/api/turrets/sign` | Request turret signature on transaction |
| POST | `/api/turrets/submit` | Submit transaction through turret network |

---

## 23. Referrals (`/api/referrals`)

Referral program tracking and bonus points.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/referrals/info` | Referral program bonus rules and terms |
| GET | `/api/referrals/my-stats` | Authenticated user referral statistics |
| GET | `/api/referrals/stats` | Platform-wide referral aggregate statistics |
| GET | `/api/referrals/:publicKey` | Referral points and invitees for a user |
| POST | `/api/referrals/register` | Register attribution for a referral |

---

## 24. Reputation (`/api/reputation`)

Composite on-chain and platform reputation.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/reputation/:userId` | Get composite reputation score and breakdown |

---

## 25. Auto-Convert (`/api/auto-convert`)

Automated token conversions into preferred assets.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auto-convert/settings` | Get user auto-conversion rules |
| PATCH | `/api/auto-convert/settings` | Update auto-conversion rules |
| GET | `/api/auto-convert/pending` | List pending conversion operations |
| GET | `/api/auto-convert/history` | List completed conversion records |
| POST | `/api/auto-convert/quote` | Request conversion rate quote |
| POST | `/api/auto-convert/manual` | Trigger immediate conversion |
| POST | `/api/auto-convert/:id/complete` | Mark conversion order completed |
| POST | `/api/auto-convert/:id/dismiss` | Dismiss conversion error notification |

---

## 26. Talent Pools (`/api/talent-pools`)

Client curated freelancer rosters.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/talent-pools` | List client talent pools |
| POST | `/api/talent-pools` | Create a talent pool |
| DELETE | `/api/talent-pools/:id` | Remove a talent pool |
| POST | `/api/talent-pools/:id/invite` | Add freelancer to talent pool |

---

## 27. Invitations (`/api/invitations`)

Freelancer direct job invitations.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/invitations` | List pending invitations for authenticated user |
| POST | `/api/invitations/:id/accept` | Accept invitation and create draft proposal |
| PATCH | `/api/invitations/:id/decline` | Decline invitation |
| DELETE | `/api/invitations/:token/revoke` | Revoke invitation by token |

---

## 28. Analytics (`/api/analytics`)

Platform-level category and overview metrics.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/analytics/categories` | Category volume and growth analytics |
| GET | `/api/analytics/overview` | High-level platform KPIs |

---

## 29. Global Search (`/api/search`)

Multi-entity search across jobs, profiles, and skills.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/search` | Query jobs, freelancers, and skills (`?q=...&category=...`) |

---

## 30. WebSocket Realtime Protocols

The server runs WebSocket endpoints on the same port:

### Realtime Notifications & Events (`/ws/realtime`)
- **URL**: `ws://localhost:4000/ws/realtime?token=<JWT>&room=job:<jobId>`
- **Subscribing to Rooms**:
  ```json
  { "type": "subscribe", "rooms": ["job:<jobId>", "user:<address>"] }
  ```
- **Events Emitted**:
  - `connected`: Handshake acknowledgement
  - `notification:created`: Direct user notification payload
  - `job:expiry-warning`: Broadcast when a deadline nears expiration

### Collaborative Scoping Sessions (`/ws/scope/:sessionId`)
- **URL**: `ws://localhost:4000/ws/scope/:sessionId?participantId=<id>`
- Synchronizes shared markdown documents, cursor coordinates, and finalization locks across participants.
