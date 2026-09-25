# WebSocket Events API

The Stellar MarketPay backend emits real-time WebSocket events for bid updates, notifications, job state changes, and more. This document outlines the connection process, authentication requirement, emitted events, and their corresponding payload schemas.

## Connection and Authentication

To receive real-time events, clients must connect to the WebSocket endpoint and authenticate by providing a JWT token in the query parameters.

**Endpoint:**
`ws://<host>:<port>/ws/realtime?token=<jwt_token>`

### Example: Client-Side Usage (JavaScript)

```javascript
// Example using native WebSocket API
const token = 'your.jwt.token.here';
const ws = new WebSocket(`ws://localhost:4000/ws/realtime?token=${token}`);

ws.onopen = () => {
  console.log('Connected to WebSocket server');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Received event: ${data.event}`, data.payload);
  
  // Handle specific events
  if (data.event === 'notification:created') {
    alert(`New Notification: ${data.payload.title}`);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket Error:', error);
};

ws.onclose = () => {
  console.log('WebSocket Connection Closed');
};
```

---

## Emitted Events

Below is a list of all WebSocket events emitted by the server along with their payload schemas. Note that events are sent as stringified JSON in the format: `{ "event": "<event_name>", "payload": <payload_object> }`.

### 1. `connected`
Emitted immediately after a successful connection to confirm the channel is open.
**Payload Schema:**
```json
{
  "channel": "realtime" // e.g. "realtime"
}
```

### 2. `notification:created`
Emitted when a new in-app notification is generated for the authenticated user.
**Payload Schema:**
```json
{
  "id": 123,
  "userAddress": "GAXJ4...",
  "type": "escrow_created", // From EVENT_TYPES
  "title": "Notification Title",
  "body": "Notification Body",
  "read": false,
  "jobId": "job-uuid-1234", // Can be null
  "linkPath": "/jobs/job-uuid-1234",
  "createdAt": "2026-07-29T11:14:00Z"
}
```

### 3. `job:{jobId}:bids`
Emitted to broadcast real-time bid/application updates on a specific job. For example, `job:job-uuid-1234:bids`.
**Payload Schema:**
```json
{
  "type": "new_bid",
  "application": {
    "id": 456,
    "freelancerAddress": "GBYJ4...",
    "bidAmount": 500,
    "proposal": "Proposal text...",
    "estimatedDuration": 7,
    "createdAt": "2026-07-29T11:14:00Z",
    "status": "pending"
  },
  "jobTitle": "Job Title"
}
```

### 4. `job:invited`
Emitted when a freelancer is invited to a private/invite-only job.
**Payload Schema:**
```json
{
  "jobId": "job-uuid-1234",
  "recipientAddress": "GBYJ4...",
  "invitedAt": "2026-07-29T11:14:00Z"
}
```

### 5. `job:status-changed`
Emitted when the indexer observes an on-chain status change for a job (e.g., escrow released).
**Payload Schema:**
```json
{
  "jobId": "job-uuid-1234",
  "status": "completed",
  "txHash": "abc123hash...",
  "ledger": 12345678
}
```

### 6. `job:expiry-warning`
Emitted by the job expiry checker to warn users about jobs expiring within 3 days.
**Payload Schema:**
```json
{
  "count": 2,
  "jobs": [
    {
      "id": "job-uuid-1234",
      "title": "Expiring Job Title",
      "expiresAt": "2026-08-01T00:00:00Z"
    }
  ]
}
```

### 7. `jobs:expired`
Emitted when old jobs have been automatically expired by the system.
**Payload Schema:**
```json
{
  "count": 5,
  "timestamp": "2026-07-29T11:14:00Z"
}
```

### 8. `price:alert`
Emitted when an XLM price threshold is crossed for a user's price alert preferences.
**Payload Schema:**
```json
{
  "recipientAddress": "GAXJ4...",
  "kind": "min", // "min" or "max"
  "currentPriceUsd": 0.12,
  "threshold": 0.15,
  "triggeredAt": "2026-07-29T11:14:00Z"
}
```

### 9. `contract:event`
Emitted when a tracked Soroban contract event occurs.
**Payload Schema:**
```json
{
  "jobId": "job-uuid-1234",
  "eventType": "payment_released",
  "txHash": "abc123hash..."
}
```

### 10. `contract:transaction`
Emitted when a relevant transaction to the tracked Soroban contract happens.
**Payload Schema:**
```json
{
  "txHash": "abc123hash...",
  "contractId": "CAXJ..."
}
```

### 11. `analytics:leaderboard-updated`
Emitted when the donation leaderboard updates.
**Payload Schema:**
```json
{
  "leaderboard": [
    {
      "address": "GAXJ4...",
      "total_donated_xlm": "100.5",
      "donation_count": 5
    }
  ],
  "txHash": "abc123hash..."
}
```
