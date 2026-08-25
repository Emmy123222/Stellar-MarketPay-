# Database Schema

Stellar MarketPay uses **PostgreSQL 15+** with the `pg_trgm` extension for full-text trigram search. The canonical schema lives at `backend/src/db/schema.sql` and is applied idempotently on every backend startup via `migrate.js`.

---

## Table of Contents

1. [ERD Diagram](#erd-diagram)
2. [Core Tables](#core-tables)
   - [profiles](#profiles)
   - [jobs](#jobs)
   - [skills / job_skills](#skills--job_skills)
   - [applications](#applications)
   - [escrows](#escrows)
3. [Messaging](#messaging)
   - [messages](#messages)
   - [private_messages](#private_messages)
   - [scope_sessions](#scope_sessions)
4. [Reputation & Ratings](#reputation--ratings)
   - [ratings](#ratings)
   - [skill_certificates](#skill_certificates)
5. [Analytics & Engagement](#analytics--engagement)
   - [job_views](#job_views)
   - [progress_updates](#progress_updates)
6. [Time Tracking & Billing](#time-tracking--billing)
   - [time_entries](#time_entries)
   - [time_invoices](#time_invoices)
7. [Referrals](#referrals)
   - [referrals](#referrals-1)
   - [referral_payouts](#referral_payouts)
8. [Notifications](#notifications)
   - [notifications](#notifications-1)
   - [notification_preferences](#notification_preferences)
9. [Auth & Security](#auth--security)
   - [webauthn_credentials](#webauthn_credentials)
10. [Disputes](#disputes)
    - [dispute_evidence](#dispute_evidence)
11. [Invitations](#invitations)
    - [job_invitations](#job_invitations)
12. [System Tables](#system-tables)
    - [ledger_timestamps](#ledger_timestamps)
    - [idempotency_keys](#idempotency_keys)
    - [health_checks](#health_checks)
    - [platform_metrics](#platform_metrics)
13. [Indexes](#indexes)
14. [Migration History](#migration-history)

---

## ERD Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                    PROFILES (hub)                                         │
│  public_key PK │ display_name │ bio │ skills[] │ role │ rating │ reputation_points │ ...  │
└──────────────────────────────────────────────────────────────────────────┬────────────────┘
         │ FK: client_address                                              │ FK: various
         │ FK: freelancer_address                                          │
         ▼                                                                 │
┌──────────────────────────┐          ┌──────────────────────────────────┐ │
│          JOBS            │          │         APPLICATIONS              │ │
│  id UUID PK              │◄─────────│  id UUID PK                       │ │
│  title                   │  job_id  │  job_id UUID FK                   │ │
│  description             │          │  freelancer_address FK            │ │
│  budget NUMERIC          │          │  proposal TEXT                    │ │
│  currency                │          │  bid_amount NUMERIC               │ │
│  category                │          │  status (pending/accepted/etc.)   │ │
│  status                  │          │  bid_commitment TEXT (sealed bid) │ │
│  client_address FK       │          │  screening_answers JSONB          │ │
│  freelancer_address FK   │          └──────────────────────────────────┘ │
│  escrow_contract_id      │                                               │
│  milestones JSONB        │          ┌──────────────────────────────────┐ │
│  visibility              │◄─────────│          ESCROWS                  │ │
│  job_search_vector       │  job_id  │  id UUID PK                       │ │
│  boosted BOOLEAN         │  (UNIQUE)│  job_id UUID FK UNIQUE            │ │
│  deleted_at              │          │  contract_id TEXT                 │ │
└────────────┬─────────────┘          │  amount_xlm NUMERIC               │ │
             │                        │  milestones JSONB                 │ │
             │ job_id FK              │  status (funded/released/etc.)    │ │
             │                        │  guardian_address                 │ │
  ┌──────────┴────────────────────────│  timeout_at                       │ │
  │          │            │           └──────────────────────────────────┘ │
  ▼          ▼            ▼                                                 │
┌──────┐ ┌─────────┐ ┌───────────────┐                                    │
│JOBS_ │ │PROGRESS_│ │  JOB_VIEWS    │                                    │
│SKILLS│ │UPDATES  │ │  id UUID PK   │                                    │
│job_id│ │id UUID  │ │  job_id FK    │                                    │
│skill_│ │job_id FK│ │  ip_hash      │                                    │
│id FK │ │author FK│ │  viewed_at    │                                    │
└──┬───┘ │update   │ └───────────────┘                                    │
   │     │_text    │                                                       │
   ▼     └─────────┘     ┌────────────────────────────────────────────────┘
┌──────────────┐         │
│   SKILLS     │         │ (profiles.public_key referenced by all address FKs below)
│  id SERIAL PK│         │
│  slug UNIQUE │         ▼
│  display_name│   ┌─────────────────────────┐   ┌──────────────────────────┐
│  category    │   │      RATINGS             │   │    SKILL_CERTIFICATES    │
└──────────────┘   │  id UUID PK              │   │  id UUID PK              │
                   │  job_id FK               │   │  public_key FK           │
                   │  rater_address FK        │   │  skill TEXT              │
                   │  rated_address FK        │   │  score INTEGER (0-100)   │
                   │  stars INTEGER (1-5)     │   │  certificate_hash UNIQUE │
                   │  review TEXT (≤200 chars)│   │  ipfs_cid TEXT           │
                   │  UNIQUE(job_id, rater)   │   │  tx_hash TEXT            │
                   └──────────────────────────┘   └──────────────────────────┘

┌──────────────────────────┐   ┌──────────────────────────────────────────┐
│       MESSAGES           │   │         PRIVATE_MESSAGES                 │
│  id UUID PK              │   │  id UUID PK                              │
│  job_id FK               │   │  sender_address FK                       │
│  sender_address FK       │   │  recipient_address FK                    │
│  receiver_address FK     │   │  sender_public_key TEXT                  │
│  content TEXT (≤2000)    │   │  recipient_public_key TEXT               │
│  read BOOLEAN            │   │  nonce TEXT UNIQUE                       │
└──────────────────────────┘   │  cipher_text TEXT (NaCl encrypted)       │
                               └──────────────────────────────────────────┘

┌──────────────────────────┐   ┌───────────────────────────────────────────┐
│     TIME_ENTRIES         │   │          TIME_INVOICES                    │
│  id UUID PK              │   │  id UUID PK                               │
│  job_id FK               │   │  job_id FK                                │
│  freelancer_address FK   │   │  freelancer_address FK                    │
│  duration_minutes INT    │   │  client_address FK                        │
│  description TEXT        │   │  total_minutes INT                        │
│  started_at TIMESTAMPTZ  │   │  hourly_rate_xlm NUMERIC                  │
└──────────────────────────┘   │  total_amount_xlm NUMERIC                 │
                               │  status (pending/approved/rejected)       │
                               │  entry_ids UUID[]                         │
                               └───────────────────────────────────────────┘

┌──────────────────────────┐   ┌────────────────────────────────────────┐
│       REFERRALS          │   │         REFERRAL_PAYOUTS               │
│  id UUID PK              │──►│  id UUID PK                            │
│  referrer_address FK     │   │  referral_id FK                        │
│  referee_address FK      │   │  referrer_address FK                   │
│  job_id FK (first job)   │   │  referee_address FK                    │
│  status (pending/paid)   │   │  job_id FK                             │
│  payout_amount NUMERIC   │   │  amount_xlm NUMERIC                    │
│  UNIQUE(referrer,referee)│   │  contract_tx_hash TEXT                 │
└──────────────────────────┘   └────────────────────────────────────────┘

┌──────────────────────────┐   ┌──────────────────────────────────────────┐
│      NOTIFICATIONS       │   │      NOTIFICATION_PREFERENCES            │
│  id UUID PK              │   │  id UUID PK                              │
│  user_address TEXT       │   │  user_address FK                         │
│  type TEXT               │   │  notification_type TEXT                  │
│  title TEXT              │   │  channel (email | inapp)                 │
│  body TEXT               │   │  enabled BOOLEAN                         │
│  read BOOLEAN            │   │  UNIQUE(user, type, channel)             │
│  job_id UUID (optional)  │   └──────────────────────────────────────────┘
│  link_path TEXT          │
└──────────────────────────┘

┌────────────────────────────┐   ┌──────────────────────────────────────┐
│    WEBAUTHN_CREDENTIALS    │   │        DISPUTE_EVIDENCE              │
│  id UUID PK                │   │  id UUID PK                          │
│  public_key FK             │   │  job_id FK                           │
│  credential_id TEXT UNIQUE │   │  uploader_address FK                 │
│  credential_name TEXT      │   │  file_name TEXT                      │
│  public_key_cose TEXT      │   │  file_size INTEGER                   │
│  counter BIGINT            │   │  mime_type TEXT                      │
│  transports TEXT[]         │   │  ipfs_cid TEXT                       │
└────────────────────────────┘   └──────────────────────────────────────┘

┌──────────────────────────┐   ┌──────────────────────────────────────────┐
│     JOB_INVITATIONS      │   │          SCOPE_SESSIONS                  │
│  id UUID PK              │   │  session_id TEXT PK                       │
│  job_id FK               │   │  content TEXT (collaborative doc)        │
│  client_address FK       │   │  cursors JSONB                           │
│  freelancer_address FK   │   │  finalized BOOLEAN                       │
│  status (pending/etc.)   │   │  finalized_payload JSONB                 │
│  UNIQUE(job, freelancer) │   │  expires_at TIMESTAMPTZ                  │
└──────────────────────────┘   └──────────────────────────────────────────┘
```

---

## Core Tables

### `profiles`

The central identity table. The primary key is a Stellar public key (`G...` address), eliminating the need for a separate users table.

| Column | Type | Notes |
|--------|------|-------|
| `public_key` | TEXT PK | Stellar G... address |
| `display_name` | TEXT | Optional display name |
| `bio` | TEXT | Profile bio |
| `skills` | TEXT[] | Legacy skill tags (see also `job_skills`) |
| `portfolio_items` | JSONB | Array of `{title, url, description}` |
| `portfolio_files` | JSONB | Uploaded file metadata |
| `availability` | JSONB | Availability schedule |
| `role` | TEXT | `client` \| `freelancer` \| `both` |
| `completed_jobs` | INTEGER | Denormalized count |
| `total_earned_xlm` | NUMERIC(20,7) | Cumulative earnings |
| `rating` | NUMERIC(3,2) | NULL until first rating; 1.00–5.00 |
| `reputation_points` | INTEGER | Gamification score |
| `referral_count` | INTEGER | Number of successful referrals |
| `email` | TEXT | For digest emails |
| `email_notifications_enabled` | BOOLEAN | Default true |
| `webhook_url` | TEXT | External notification endpoint |
| `webhook_secret` | TEXT | HMAC signing secret for webhooks |
| `is_kyc_verified` | BOOLEAN | KYC status |
| `did_hash` | TEXT | Decentralized Identity hash |
| `blocked_addresses` | TEXT[] | Addresses this user has blocked |
| `encryption_public_key` | TEXT | NaCl box public key for E2E messaging |
| `preferred_language` | TEXT | Default `'en'` |
| `digest_unsubscribe_token` | UUID | Unique unsubscribe token for emails |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp |
| `last_login_at` | TIMESTAMPTZ | Last successful auth |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

---

### `jobs`

The central job listing. Status transitions: `open` → `in_progress` → `completed` → (closed).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `title` | TEXT | Required |
| `description` | TEXT | Required |
| `budget` | NUMERIC(20,7) | In `currency` units |
| `currency` | TEXT | Default `'XLM'` |
| `category` | TEXT | Job category |
| `status` | TEXT | `open` \| `in_progress` \| `completed` \| `cancelled` |
| `visibility` | TEXT | `public` \| `private` \| `invite_only` |
| `client_address` | TEXT FK | Owner/poster |
| `freelancer_address` | TEXT FK | Assigned freelancer (nullable) |
| `escrow_contract_id` | TEXT | Soroban contract address |
| `applicant_count` | INTEGER | Denormalized for listing performance |
| `deadline` | TIMESTAMPTZ | Work deadline |
| `timezone` | TEXT | Client timezone |
| `screening_questions` | TEXT[] | Questions for applicants |
| `milestones` | JSONB | Array of `{title, amount, status}` |
| `dispute_reason` | TEXT | Reason if disputed |
| `dispute_description` | TEXT | Detail if disputed |
| `disputed_by` | TEXT FK | Address that raised dispute |
| `disputed_at` | TIMESTAMPTZ | When dispute was raised |
| `expires_at` | TIMESTAMPTZ | Listing expiry |
| `extended_count` | INTEGER | Number of times extended |
| `extended_until` | TIMESTAMPTZ | Current extension deadline |
| `boosted` | BOOLEAN | Promoted listing |
| `boosted_until` | TIMESTAMPTZ | Boost expiry |
| `share_count` | INTEGER | Social share counter |
| `view_count` | INTEGER | Denormalized view total |
| `tfidf_vector` | JSONB | ML recommendation vector |
| `job_search_vector` | tsvector | GENERATED — full-text search (title A, description B) |
| `bidding_closed_at` | TIMESTAMPTZ | When sealed-bid window closed |
| `deleted_at` | TIMESTAMPTZ | Soft delete |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**Constraints:** `visibility` must be one of `public`, `private`, `invite_only`.

---

### `skills` / `job_skills`

Normalized skill taxonomy. `skills` holds the canonical list; `job_skills` links jobs to skills.

**`skills`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `slug` | TEXT UNIQUE | Machine-readable identifier e.g. `react` |
| `display_name` | TEXT | Human-readable label |
| `category` | TEXT | Skill grouping |

**`job_skills`**

| Column | Type | Notes |
|--------|------|-------|
| `job_id` | UUID FK | References `jobs(id)` ON DELETE CASCADE |
| `skill_id` | INT FK | References `skills(id)` ON DELETE CASCADE |
| — | — | Composite PK `(job_id, skill_id)` |

---

### `applications`

Freelancer proposals for a job. One application per (job, freelancer) pair.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | |
| `freelancer_address` | TEXT FK | |
| `proposal` | TEXT | Proposal text |
| `bid_amount` | NUMERIC(20,7) | Proposed price |
| `currency` | TEXT | Default `'XLM'` |
| `status` | TEXT | `pending` \| `accepted` \| `rejected` \| `withdrawn` |
| `accepted_at` | TIMESTAMPTZ | When client accepted |
| `withdrawn_at` | TIMESTAMPTZ | When freelancer withdrew |
| `screening_answers` | JSONB | Answers to job screening questions |
| `bid_commitment` | TEXT | Hash for sealed-bid protocol |
| `bid_nonce` | TEXT | Nonce for sealed-bid reveal |
| `bid_revealed` | BOOLEAN | Whether bid has been revealed |
| `revealed_bid_amount` | NUMERIC(20,7) | Actual amount after reveal |
| `revealed_at` | TIMESTAMPTZ | Reveal timestamp |
| `referred_by` | TEXT FK | Referrer address (if any) |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (job_id, freelancer_address)`

---

### `escrows`

Off-chain mirror of on-chain Soroban escrow state. One escrow per job.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK UNIQUE | One escrow per job |
| `contract_id` | TEXT | Soroban contract address |
| `amount_xlm` | NUMERIC(20,7) | Total locked amount |
| `milestones` | JSONB | `[{title, amount_xlm, status}]` |
| `status` | TEXT | `funded` \| `released` \| `refunded` \| `timeout_refunded` |
| `released_at` | TIMESTAMPTZ | When funds were released |
| `timeout_at` | TIMESTAMPTZ | Ledger timeout mapped to wall-clock |
| `guardian_address` | TEXT | Multi-sig guardian (high-value jobs) |
| `high_value_threshold` | NUMERIC(20,7) | Amount above which guardian required |
| `guardian_approved` | BOOLEAN | Whether guardian approved release |
| `guardian_approved_at` | TIMESTAMPTZ | Guardian approval time |
| `release_timeout_at` | TIMESTAMPTZ | After 48h client can release unilaterally |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**State transitions:**
```
funded → released (client approves)
funded → refunded (cancelled before work)
funded → timeout_refunded (ledger timeout)
```

---

## Messaging

### `messages`

Job-scoped chat between client and freelancer. Stored in plaintext (use `private_messages` for E2E encrypted DMs).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `sender_address` | TEXT FK | |
| `receiver_address` | TEXT FK | |
| `content` | TEXT | 1–2000 characters |
| `read` | BOOLEAN | Default false |
| `created_at` | TIMESTAMPTZ | |

---

### `private_messages`

End-to-end encrypted direct messages using NaCl box (X25519-XSalsa20-Poly1305). The server never sees plaintext.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `sender_address` | TEXT FK | |
| `recipient_address` | TEXT FK | |
| `sender_public_key` | TEXT | NaCl ephemeral public key |
| `recipient_public_key` | TEXT | Recipient NaCl public key |
| `nonce` | TEXT UNIQUE | Encryption nonce (prevents replay) |
| `cipher_text` | TEXT | Encrypted payload |
| `created_at` | TIMESTAMPTZ | |

---

### `scope_sessions`

Real-time collaborative scope/contract editor sessions (WebSocket-backed).

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | TEXT PK | Shared session ID |
| `content` | TEXT | Current document content |
| `cursors` | JSONB | `{address: {line, col}}` |
| `finalized` | BOOLEAN | Locked for editing |
| `finalized_payload` | JSONB | Final agreed scope document |
| `expires_at` | TIMESTAMPTZ | TTL for cleanup |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## Reputation & Ratings

### `ratings`

Post-job reviews. One rating per rater per job.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | |
| `rater_address` | TEXT FK | Who left the review |
| `rated_address` | TEXT FK | Who was reviewed |
| `stars` | INTEGER | 1–5 (enforced by CHECK) |
| `review` | TEXT | Optional; max 200 characters |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (job_id, rater_address)` — one review per rater per job.

---

### `skill_certificates`

On-chain verifiable skill assessment certificates. Score stored at issuance; hash stored on Stellar.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `public_key` | TEXT FK | Certificate holder |
| `skill` | TEXT | Assessed skill slug |
| `score` | INTEGER | 0–100 |
| `certificate_hash` | TEXT UNIQUE | Hash of certificate content |
| `ipfs_cid` | TEXT | IPFS content ID of certificate PDF |
| `tx_hash` | TEXT | On-chain anchoring transaction |
| `issued_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (public_key, skill)` — one certificate per skill per user.

---

## Analytics & Engagement

### `job_views`

Anonymous view tracking. IP is hashed (never stored raw).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `ip_hash` | TEXT | SHA-256 of IP |
| `viewed_at` | TIMESTAMPTZ | |

---

### `progress_updates`

Freelancer progress notes posted during job execution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | |
| `author_address` | TEXT FK | |
| `update_text` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

---

## Time Tracking & Billing

### `time_entries`

Individual time log entries submitted by freelancers on hourly jobs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `freelancer_address` | TEXT FK | |
| `duration_minutes` | INTEGER | 1–1440 (CHECK constraint) |
| `description` | TEXT | Work description |
| `started_at` | TIMESTAMPTZ | Optional session start |
| `created_at` | TIMESTAMPTZ | |

---

### `time_invoices`

Aggregated invoices compiled from `time_entries`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `freelancer_address` | TEXT FK | |
| `client_address` | TEXT FK | |
| `total_minutes` | INTEGER | Sum of included entries |
| `hourly_rate_xlm` | NUMERIC(20,7) | Agreed hourly rate |
| `total_amount_xlm` | NUMERIC(20,7) | `total_minutes / 60 * hourly_rate_xlm` |
| `status` | TEXT | `pending` \| `approved` \| `rejected` |
| `entry_ids` | UUID[] | Array of included `time_entries.id` |
| `contract_tx_hash` | TEXT | On-chain payment tx (after approval) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## Referrals

### `referrals`

Tracks the referral relationship and bonus eligibility.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `referrer_address` | TEXT FK | Who referred |
| `referee_address` | TEXT FK | Who was referred |
| `job_id` | UUID FK | First job that triggered payout (nullable) |
| `status` | TEXT | `pending` \| `paid` \| `ineligible` |
| `payout_amount` | NUMERIC(20,7) | XLM paid (2% of job earnings) |
| `paid_at` | TIMESTAMPTZ | When bonus was paid |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (referrer_address, referee_address)`

---

### `referral_payouts`

Immutable audit log of every referral bonus payment.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `referral_id` | UUID FK | Parent referral row |
| `referrer_address` | TEXT FK | |
| `referee_address` | TEXT FK | |
| `job_id` | UUID FK | Job that triggered payout |
| `amount_xlm` | NUMERIC(20,7) | Amount paid |
| `contract_tx_hash` | TEXT | On-chain tx hash |
| `created_at` | TIMESTAMPTZ | |

---

## Notifications

### `notifications`

In-app notification inbox. Not user-configurable per-row — use `notification_preferences` for opt-out.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_address` | TEXT | Recipient (not FK — allows system-generated) |
| `type` | TEXT | Event type e.g. `application_accepted` |
| `title` | TEXT | Short notification title |
| `body` | TEXT | Full notification body |
| `read` | BOOLEAN | Default false |
| `job_id` | UUID | Optional link context |
| `link_path` | TEXT | Frontend route to navigate to |
| `created_at` | TIMESTAMPTZ | |

---

### `notification_preferences`

Per-user, per-type, per-channel opt-in/out settings.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_address` | TEXT FK | ON DELETE CASCADE |
| `notification_type` | TEXT | e.g. `new_application`, `message_received` |
| `channel` | TEXT | `email` \| `inapp` |
| `enabled` | BOOLEAN | Default true |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (user_address, notification_type, channel)`

---

## Auth & Security

### `webauthn_credentials`

Passkey (FIDO2/WebAuthn) credentials for secondary authentication.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `public_key` | TEXT FK | Stellar address of the credential owner |
| `credential_id` | TEXT UNIQUE | WebAuthn credential ID (base64url) |
| `credential_name` | TEXT | User-friendly name, default `'Passkey'` |
| `public_key_cose` | TEXT | COSE-encoded public key |
| `counter` | BIGINT | Signature counter (replay prevention) |
| `transports` | TEXT[] | e.g. `['usb', 'nfc', 'ble', 'internal']` |
| `created_at` | TIMESTAMPTZ | |

---

## Disputes

### `dispute_evidence`

IPFS-pinned file evidence uploaded during a dispute.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `uploader_address` | TEXT FK | |
| `file_name` | TEXT | Original filename |
| `file_size` | INTEGER | Bytes |
| `mime_type` | TEXT | e.g. `image/png` |
| `ipfs_cid` | TEXT | IPFS content identifier |
| `created_at` | TIMESTAMPTZ | |

---

## Invitations

### `job_invitations`

Direct invitations from clients to specific freelancers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK | ON DELETE CASCADE |
| `client_address` | TEXT FK | |
| `freelancer_address` | TEXT FK | |
| `status` | TEXT | `pending` \| `accepted` \| `declined` |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (job_id, freelancer_address)`

---

## System Tables

### `ledger_timestamps`

Maps Stellar ledger sequence numbers to wall-clock times. Used for timeout calculations.

| Column | Type | Notes |
|--------|------|-------|
| `ledger` | INTEGER PK | Stellar ledger sequence |
| `timestamp` | TIMESTAMPTZ | Ledger close time |

---

### `idempotency_keys`

Caches POST response bodies by caller-supplied idempotency key to prevent duplicate mutations.

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | Client-supplied key |
| `response` | JSONB | Cached response body |
| `created_at` | TIMESTAMPTZ | Used for TTL cleanup |

---

### `health_checks`

Periodic service health snapshots written by the health check cron.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `service` | TEXT | Service name e.g. `postgres`, `redis` |
| `status` | TEXT | `ok` \| `degraded` \| `down` |
| `checked_at` | TIMESTAMPTZ | |

---

### `platform_metrics`

Time-bucketed aggregated platform metrics for dashboards and analytics.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `metric_name` | TEXT | e.g. `jobs_posted`, `escrow_volume_xlm` |
| `value` | NUMERIC | Metric value |
| `granularity` | TEXT | `hourly` \| `daily` \| `weekly` |
| `bucket` | TIMESTAMPTZ | Time bucket start |
| `created_at` | TIMESTAMPTZ | |

**Constraint:** `UNIQUE (metric_name, granularity, bucket)` — upserted by aggregation jobs.

---

## Indexes

Key indexes beyond primary keys:

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| `jobs` | `jobs_search_vector_idx` | GIN | Full-text search |
| `jobs` | `jobs_title_trgm_idx` | GIN (trgm) | Fuzzy title search |
| `jobs` | `jobs_description_trgm_idx` | GIN (trgm) | Fuzzy description search |
| `jobs` | `jobs_open_public_created_idx` | B-tree (partial) | Open public job feed |
| `jobs` | `jobs_status_category_created_idx` | B-tree | Filtered listing queries |
| `jobs` | `jobs_status_category` | B-tree (partial) | Exclude deleted rows |
| `jobs` | `jobs_client_status` | B-tree | Client dashboard |
| `applications` | `applications_job_created_idx` | B-tree | Ordered application list |
| `ratings` | `ratings_rated_created_idx` | B-tree | Profile rating history |
| `notifications` | `idx_notifications_user_unread` | B-tree (partial) | Unread badge count |
| `private_messages` | `private_messages_participants_idx` | B-tree | Conversation history |
| `platform_metrics` | `platform_metrics_cleanup_idx` | B-tree (partial) | Purge old metrics |

---

## Migration History

Migrations follow a Flyway-style `V{n}__{description}.{up|down}.sql` naming convention and live in `backend/src/db/migrations/`.

| Version | Description |
|---------|-------------|
| V1 | Initial schema — profiles, jobs, applications, escrows, ratings, messages |
| V2 | Admin 2FA, job drafts |
| V3 | Contract events, indexer state, skill certificates |
| V4 | Developer API keys, audit trail, frozen wallets |
| V5 | Weekly digest fields on profiles |
| V6 | Job recommendations index, on-chain message fields |
| V7 | Job search filter composite indexes |
| V9 | Milestone escrow JSONB columns |
| V10 | In-app notifications table, sealed-bid commitment columns |
| V11 | Query optimization composite indexes |
| V12 | Profile field encryption (pgp_sym_encrypt), full-text search, idempotency metrics |
| V13 | `updated_at` triggers on all tables, API key rotation |
| V14 | Normalized `job_skills` table |

The schema is applied idempotently (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). No destructive changes are made to existing data by default.
