# API Reference — Stellar MarketPay

Base URL: `http://localhost:4000`

All responses: `{ "success": true, "data": {...} }` or `{ "success": false, "error": "..." }`

---

## Health
`GET /health` — Server status check.

---

## Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs (`?status=open&category=...&limit=50`) |
| GET | `/api/jobs/:id` | Get single job |
| GET | `/api/jobs/client/:publicKey` | Jobs posted by a client |
| POST | `/api/jobs` | Create a new job |

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profiles/:publicKey` | Get a user profile |
| POST | `/api/profiles` | Create or update a profile |

---

## Escrow

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/escrow/:jobId/release` | Client releases payment to freelancer |
| GET | `/api/escrow/:jobId` | Get escrow state for a job |

### POST /api/escrow/:jobId/release
```json
{ "clientAddress": "GABC...XYZ" }
```

---

## Job Statuses

| Status | Meaning |
|--------|---------|
| `open` | Accepting applications |
| `in_progress` | Freelancer hired, work underway |
| `completed` | Escrow released, job done |
| `cancelled` | Cancelled by client |
