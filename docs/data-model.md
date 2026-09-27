# Stellar MarketPay — Database Data Model & Entity Relationship (ER) Reference

Stellar MarketPay uses **PostgreSQL 15+** with the `pg_trgm` extension for trigram full-text search. The canonical database schema is maintained in `backend/src/db/schema.sql` and versioned migration scripts in `backend/src/db/migrations/`.

> [!IMPORTANT]
> **Schema Sync Requirement**: Contributors creating new database migrations (`V__*.up.sql` / `V__*.down.sql`) or modifying `backend/src/db/schema.sql` **must update this document and the Mermaid ER diagram** as part of their pull request to ensure architectural documentation remains in sync with the database.

---

## Table of Contents

- [Entity Relationship (ER) Diagram](#entity-relationship-er-diagram)
- [Data Dictionary & Table Reference](#data-dictionary--table-reference)
  - [Core Marketplace Entities](#core-marketplace-entities)
  - [Escrows, Milestones & Conversions](#escrows-milestones--conversions)
  - [Messaging & Collaboration](#messaging--collaboration)
  - [Ratings, Reputation & Proofs](#ratings-reputation--proofs)
  - [Time Tracking & Billing](#time-tracking--billing)
  - [Referrals & Growth](#referrals--growth)
  - [Security, Auth & Notifications](#security-auth--notifications)
  - [System & Audit Trail](#system--audit-trail)
- [Cardinality Legend](#cardinality-legend)

---

## Entity Relationship (ER) Diagram

```mermaid
erDiagram
    CATEGORIES ||--o{ CATEGORIES : "parent_of"
    CATEGORIES ||--o{ JOBS : "categorizes"
    PROFILES ||--o{ JOBS : "creates (client)"
    PROFILES ||--o{ JOBS : "assigned (freelancer)"
    PROFILES ||--o{ APPLICATIONS : "submits"
    JOBS ||--o{ APPLICATIONS : "receives"
    JOBS ||--|| ESCROWS : "funded_by"
    JOBS ||--o{ JOB_SKILLS : "requires"
    SKILLS ||--o{ JOB_SKILLS : "classified_in"
    JOBS ||--o{ PROGRESS_UPDATES : "tracks"
    PROFILES ||--o{ PROGRESS_UPDATES : "authors"
    JOBS ||--o{ RATINGS : "reviewed_in"
    PROFILES ||--o{ RATINGS : "rates (rater)"
    PROFILES ||--o{ RATINGS : "rated (target)"
    JOBS ||--o{ MESSAGES : "contains"
    PROFILES ||--o{ MESSAGES : "sends"
    PROFILES ||--o{ MESSAGES : "receives"
    PROFILES ||--o{ PRIVATE_MESSAGES : "encrypts_to (sender)"
    PROFILES ||--o{ PRIVATE_MESSAGES : "decrypts_from (recipient)"
    PROFILES ||--o{ REFERRALS : "refers (referrer)"
    PROFILES ||--o{ REFERRALS : "referred (referee)"
    REFERRALS ||--o{ REFERRAL_PAYOUTS : "triggers"
    JOBS ||--o{ REFERRAL_PAYOUTS : "pays_from"
    JOBS ||--o{ DISPUTE_EVIDENCE : "submits_for"
    PROFILES ||--o{ DISPUTE_EVIDENCE : "uploads"
    JOBS ||--o{ TIME_ENTRIES : "logs_for"
    PROFILES ||--o{ TIME_ENTRIES : "records"
    JOBS ||--o{ TIME_INVOICES : "billed_under"
    PROFILES ||--o{ TIME_INVOICES : "issues (freelancer)"
    PROFILES ||--o{ TIME_INVOICES : "pays (client)"
    JOBS ||--o{ JOB_INVITATIONS : "invites_to"
    PROFILES ||--o{ JOB_INVITATIONS : "sends_invite"
    PROFILES ||--o{ JOB_INVITATIONS : "receives_invite"
    PROFILES ||--o{ WEBAUTHN_CREDENTIALS : "authenticates"
    PROFILES ||--o| REPUTATION_SCORES : "maintains"
    PROFILES ||--o{ SKILL_CERTIFICATES : "earns"
    PROFILES ||--o{ USDC_AUTO_CONVERSIONS : "converts_for"
    JOBS ||--o{ USDC_AUTO_CONVERSIONS : "settles_from"
    PROFILES ||--o{ NOTIFICATION_QUEUE : "delivers_to"
    PROFILES ||--o| ONBOARDING_PROGRESS : "tracks"
    PROFILES ||--o{ REFRESH_TOKENS : "owns"

    PROFILES {
        text public_key PK
        text display_name
        text bio
        text_array skills
        jsonb portfolio_items
        jsonb availability
        text role
        integer completed_jobs
        numeric total_earned_xlm
        numeric rating
        integer reputation_points
        integer referral_count
        text email
        text encryption_public_key
        boolean auto_convert_usdc
        integer auto_convert_slippage_bps
        timestamptz deleted_at
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORIES {
        serial id PK
        text slug UK
        text name
        integer parent_id FK
    }

    JOBS {
        uuid id PK
        text title
        text description
        numeric budget
        text currency
        text category
        integer category_id FK
        text status
        text visibility
        text client_address FK
        text freelancer_address FK
        text escrow_contract_id
        integer applicant_count
        timestamptz deadline
        text timezone
        text_array screening_questions
        jsonb milestones
        boolean boosted
        timestamptz boosted_until
        timestamptz deleted_at
        timestamptz created_at
        timestamptz updated_at
    }

    SKILLS {
        serial id PK
        text slug UK
        text display_name
        text category
    }

    JOB_SKILLS {
        uuid job_id PK_FK
        integer skill_id PK_FK
    }

    APPLICATIONS {
        uuid id PK
        uuid job_id FK
        text freelancer_address FK
        text proposal
        numeric bid_amount
        text currency
        text status
        jsonb screening_answers
        text bid_commitment
        text bid_nonce
        boolean bid_revealed
        numeric revealed_bid_amount
        timestamptz accepted_at
        timestamptz created_at
    }

    ESCROWS {
        uuid id PK
        uuid job_id FK_UK
        text contract_id
        numeric amount_xlm
        jsonb milestones
        text status
        timestamptz released_at
        timestamptz timeout_at
        timestamptz next_billing_date
        timestamptz created_at
        timestamptz updated_at
    }

    RATINGS {
        uuid id PK
        uuid job_id FK
        text rater_address FK
        text rated_address FK
        integer stars
        text review
        timestamptz created_at
    }

    SKILL_CERTIFICATES {
        uuid id PK
        text public_key FK
        text skill
        integer score
        text certificate_hash UK
        text ipfs_cid
        text tx_hash
        timestamptz issued_at
    }

    MESSAGES {
        uuid id PK
        uuid job_id FK
        text sender_address FK
        text receiver_address FK
        text content
        boolean read
        timestamptz created_at
    }

    PRIVATE_MESSAGES {
        uuid id PK
        text sender_address FK
        text recipient_address FK
        text sender_public_key
        text recipient_public_key
        text nonce UK
        text cipher_text
        timestamptz created_at
    }

    SCOPE_SESSIONS {
        text session_id PK
        text content
        jsonb cursors
        boolean finalized
        text finalized_hash
        jsonb finalized_payload
        timestamptz expires_at
        timestamptz created_at
        timestamptz updated_at
    }

    DISPUTE_EVIDENCE {
        uuid id PK
        uuid job_id FK
        text uploader_address FK
        text file_name
        integer file_size
        text mime_type
        text ipfs_cid
        boolean pinned
        timestamptz created_at
    }

    TIME_ENTRIES {
        uuid id PK
        uuid job_id FK
        text freelancer_address FK
        integer duration_minutes
        text description
        integer milestone_index
        timestamptz started_at
        timestamptz created_at
    }

    TIME_INVOICES {
        uuid id PK
        uuid job_id FK
        text freelancer_address FK
        text client_address FK
        integer total_minutes
        numeric hourly_rate_xlm
        numeric total_amount_xlm
        text status
        uuid_array entry_ids
        text contract_tx_hash
        timestamptz created_at
        timestamptz updated_at
    }

    REFERRALS {
        uuid id PK
        text referrer_address FK
        text referee_address FK
        uuid job_id FK
        text status
        numeric payout_amount
        timestamptz paid_at
        timestamptz created_at
    }

    REFERRAL_PAYOUTS {
        uuid id PK
        uuid referral_id FK
        text referrer_address FK
        text referee_address FK
        uuid job_id FK
        numeric amount_xlm
        text contract_tx_hash
        timestamptz created_at
    }

    JOB_INVITATIONS {
        uuid id PK
        uuid job_id FK
        text client_address FK
        text freelancer_address FK
        text status
        timestamptz created_at
    }

    WEBAUTHN_CREDENTIALS {
        uuid id PK
        text public_key FK
        text credential_id UK
        text credential_name
        text public_key_cose
        bigint counter
        text_array transports
        timestamptz created_at
    }

    REPUTATION_SCORES {
        text user_id PK_FK
        numeric score
        integer completed_jobs
        numeric dispute_rate
        numeric avg_response_hours
        numeric avg_rating
        integer rating_count
        numeric referral_quality
        timestamptz updated_at
    }

    USDC_AUTO_CONVERSIONS {
        uuid id PK
        text user_address FK
        uuid job_id FK
        integer milestone_index
        numeric source_amount_xlm
        numeric quoted_usdc
        numeric dest_min_usdc
        numeric received_usdc
        numeric exchange_rate
        text tx_hash
        text status
        text error
        timestamptz created_at
        timestamptz completed_at
    }

    ONBOARDING_PROGRESS {
        text public_key PK_FK
        integer current_step
        jsonb completed_steps
        boolean dismissed
        boolean completed
        timestamptz updated_at
    }

    NOTIFICATION_QUEUE {
        uuid id PK
        text recipient_address FK
        text notification_type
        text event_type
        uuid job_id FK
        jsonb payload
        text status
        integer retry_count
        text error_message
        timestamptz sent_at
        timestamptz next_retry_at
        timestamptz created_at
    }

    REFRESH_TOKENS {
        bigserial id PK
        text token_hash UK
        uuid family_id
        text public_key FK
        jsonb payload
        timestamptz expires_at
        timestamptz used_at
        timestamptz revoked_at
        timestamptz created_at
    }

    AUDIT_LOG {
        uuid id PK
        text actor_address
        text action
        text entity_type
        text entity_id
        jsonb old_value
        jsonb new_value
        timestamptz created_at
    }
```

---

## Data Dictionary & Table Reference

### Core Marketplace Entities

#### `profiles`

The primary identity entity. Each row represents a user keyed directly by their Stellar ed25519 public key (`G...` address).

- **Primary Key:** `public_key` (`TEXT`)
- **Key Relationships:**
  - `1 : N` with `jobs` (as `client_address` and `freelancer_address`)
  - `1 : N` with `applications` (as `freelancer_address`)
  - `1 : 1` with `reputation_scores` (as `user_id`)
  - `1 : 1` with `onboarding_progress` (as `public_key`)
  - `1 : N` with `ratings` (as `rater_address` and `rated_address`)
- **Key Constraints:**
  - `role` IN (`'client'`, `'freelancer'`, `'both'`)
  - Soft deletion supported via `deleted_at IS NOT NULL`

#### `categories`

Hierarchical taxonomy for job categorization and classification.

- **Primary Key:** `id` (`SERIAL`)
- **Key Relationships:**
  - `1 : N` self-referential (`parent_id` $\rightarrow$ `categories.id`)
  - `1 : N` with `jobs` (`category_id` $\rightarrow$ `categories.id`)
- **Unique Constraints:** `slug`

#### `jobs`

Represents client job postings, budget constraints, deliverables, and lifecycle states.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:**
  - `client_address` $\rightarrow$ `profiles.public_key` (`NOT NULL`)
  - `freelancer_address` $\rightarrow$ `profiles.public_key` (`NULLABLE`)
  - `category_id` $\rightarrow$ `categories.id` (`NULLABLE`)
- **Key Relationships:**
  - `1 : 1` with `escrows` (`escrows.job_id`)
  - `1 : N` with `applications` (`applications.job_id`)
  - `M : N` with `skills` through `job_skills`
  - `1 : N` with `progress_updates`
  - `1 : N` with `time_entries` and `time_invoices`
- **Key Constraints:**
  - `status` IN (`'open'`, `'in_progress'`, `'completed'`, `'cancelled'`, `'disputed'`)
  - `visibility` IN (`'public'`, `'private'`, `'invite_only'`)

#### `skills` & `job_skills`

Normalized catalog of industry skills and many-to-many junction linking required skills to jobs.

- **`skills` PK:** `id` (`SERIAL`), Unique: `slug`
- **`job_skills` Composite PK:** `(job_id, skill_id)`
  - `job_id` $\rightarrow$ `jobs.id` (`ON DELETE CASCADE`)
  - `skill_id` $\rightarrow$ `skills.id` (`ON DELETE CASCADE`)

#### `applications`

Freelancer job proposals, pricing bids, sealed commitment hashes, and screening answers.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:**
  - `job_id` $\rightarrow$ `jobs.id`
  - `freelancer_address` $\rightarrow$ `profiles.public_key`
- **Key Constraints:**
  - `UNIQUE (job_id, freelancer_address)` prevents duplicate bids
  - Commit–reveal sealed bidding fields: `bid_commitment`, `bid_nonce`, `bid_revealed`, `revealed_bid_amount`

---

### Escrows, Milestones & Conversions

#### `escrows`

Off-chain representation and tracking layer for on-chain Soroban escrow smart contracts.

- **Primary Key:** `id` (`UUID`)
- **Foreign Key:** `job_id` $\rightarrow$ `jobs.id` (`UNIQUE`)
- **Key Fields:**
  - `contract_id`: Soroban contract instance address (`C...`)
  - `amount_xlm`: Escrowed amount in XLM
  - `milestones`: Structured JSONB array containing milestone descriptions, percentages, and release statuses
  - `status`: `'funded'` \| `'released'` \| `'refunded'` \| `'timeout_refunded'` \| `'disputed'`

#### `usdc_auto_conversions`

Records automated path payments (XLM $\rightarrow$ USDC via Stellar DEX) executed upon escrow release for opted-in freelancers.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:**
  - `user_address` $\rightarrow$ `profiles.public_key`
  - `job_id` $\rightarrow$ `jobs.id`
- **Unique Constraint:** `(user_address, job_id, COALESCE(milestone_index, -1))`

---

### Messaging & Collaboration

#### `messages`

Plaintext on-platform job discussion and negotiation thread messages.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:**
  - `job_id` $\rightarrow$ `jobs.id` (`ON DELETE CASCADE`)
  - `sender_address` $\rightarrow$ `profiles.public_key`
  - `receiver_address` $\rightarrow$ `profiles.public_key`

#### `private_messages`

End-to-end encrypted private communications utilizing libsodium / TweetNaCl box encryption (`curve25519-xsalsa20-poly1305`).

- **Primary Key:** `id` (`UUID`)
- **Unique Constraint:** `nonce` (enforces single-use nonce uniqueness)
- **Foreign Keys:** `sender_address`, `recipient_address` $\rightarrow$ `profiles.public_key`

#### `scope_sessions`

Real-time collaborative document editor sessions for Statement of Work (SOW) drafting.

- **Primary Key:** `session_id` (`TEXT`)
- **Key Columns:** `content` (max 512KB), `cursors` (JSONB), `finalized_hash`, `expires_at`

---

### Ratings, Reputation & Proofs

#### `ratings`

Bilateral post-job reviews and star ratings.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:**
  - `job_id` $\rightarrow$ `jobs.id`
  - `rater_address` $\rightarrow$ `profiles.public_key`
  - `rated_address` $\rightarrow$ `profiles.public_key`
- **Unique Constraint:** `(job_id, rater_address)` (strictly one review per user per job)
- **Constraint:** `stars BETWEEN 1 AND 5`, `char_length(review) <= 200`

#### `reputation_scores`

Synthesized multi-dimensional reliability and trust score calculated from past performance.

- **Primary Key:** `user_id` $\rightarrow$ `profiles.public_key`
- **Key Metrics:**
  - `score`: Composite score (0.00–100.00)
  - `dispute_rate`: Percentage of disputed escrows (0.0000–1.0000)
  - `avg_response_hours`: Mean response latency
  - `referral_quality`: Success rate of referred participants

#### `skill_certificates`

Cryptographically verified proof-of-competency certificates minted upon assessment completion.

- **Primary Key:** `id` (`UUID`)
- **Unique Constraint:** `certificate_hash`
- **Foreign Key:** `public_key` $\rightarrow$ `profiles.public_key`

---

### Time Tracking & Billing

#### `time_entries`

Granular hourly work logs submitted by freelancers for hourly contracts.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:** `job_id` $\rightarrow$ `jobs.id`, `freelancer_address` $\rightarrow$ `profiles.public_key`
- **Constraint:** `duration_minutes > 0 AND duration_minutes <= 1440` (max 24h per entry)

#### `time_invoices`

Aggregated billing invoices for time entries submitted to clients for settlement.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:** `job_id` $\rightarrow$ `jobs.id`, `freelancer_address`, `client_address` $\rightarrow$ `profiles.public_key`
- **Constraint:** `status IN ('pending', 'approved', 'rejected')`

---

### Referrals & Growth

#### `referrals`

Tracks affiliate and invitation relationships between referrers and new platform users.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:** `referrer_address`, `referee_address` $\rightarrow$ `profiles.public_key`, `job_id` $\rightarrow$ `jobs.id`
- **Unique Constraint:** `(referrer_address, referee_address)`

#### `referral_payouts`

Audit log of on-chain 2% referral bonus releases paid upon escrow completion.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:** `referral_id` $\rightarrow$ `referrals.id`, `job_id` $\rightarrow$ `jobs.id`

---

### Security, Auth & Notifications

#### `webauthn_credentials`

FIDO2 / WebAuthn passkey credentials for cryptographic passwordless authentication.

- **Primary Key:** `id` (`UUID`)
- **Unique Constraint:** `credential_id`
- **Foreign Key:** `public_key` $\rightarrow$ `profiles.public_key` (`ON DELETE CASCADE`)

#### `refresh_tokens`

Cryptographically hashed and rotated JWT refresh token family records.

- **Primary Key:** `id` (`BIGSERIAL`)
- **Unique Constraint:** `token_hash`
- **Foreign Key:** `public_key` $\rightarrow$ `profiles.public_key`
- **Replay Protection:** `family_id` enables invalidation of entire compromised token families upon reuse detection.

#### `notification_queue`

Centralized asynchronous delivery queue supporting in-app notifications, transactional emails, and webhooks.

- **Primary Key:** `id` (`UUID`)
- **Foreign Keys:** `recipient_address` $\rightarrow$ `profiles.public_key`, `job_id` $\rightarrow$ `jobs.id`
- **Retry Mechanism:** `retry_count`, `next_retry_at` with exponential backoff.

#### `onboarding_progress`

Multi-step onboarding wizard progress checkpoints and hydration state.

- **Primary Key:** `public_key` $\rightarrow$ `profiles.public_key`
- **Columns:** `current_step`, `completed_steps` (`JSONB`), `dismissed`, `completed`

---

### System & Audit Trail

#### `audit_log`

Immutable append-only audit trail logging all sensitive state mutations (escrow releases, dispute filings, admin actions).

- **Primary Key:** `id` (`UUID`)
- **Columns:** `actor_address`, `action`, `entity_type`, `entity_id`, `old_value` (`JSONB`), `new_value` (`JSONB`), `created_at`

#### `ledger_timestamps`

Maps Stellar ledger sequence numbers to UTC close timestamps for deterministic date resolution.

- **Primary Key:** `ledger` (`INTEGER`)

---

## Cardinality Legend

| Notation | Relationship Meaning |
| -------- | -------------------- |
| `        |                      | --           |                             | `                          | Exactly one to exactly one |
| `        |                      | --o          | `                           | Exactly one to zero or one |
| `        |                      | --o{`        | Exactly one to zero or many |
| `}       | --o{`                | Many to many |
