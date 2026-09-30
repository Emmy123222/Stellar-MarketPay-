# Web Push Notifications Setup Guide

This guide explains how to configure and use Web Push notifications in the Stellar MarketPay application.

## Overview

Web Push notifications allow users to receive notifications even when the browser tab is closed. This includes:
- New job applications
- Escrow releases
- Dispute notifications
- Job invitations
- Direct messages

## Backend Setup

### 1. Generate VAPID Keys

VAPID (Voluntary Application Server Identification) keys are required for Web Push. Generate them using:

```bash
cd backend
node -e "const webpush = require('web-push'); const vapid = webpush.generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + vapid.publicKey); console.log('VAPID_PRIVATE_KEY=' + vapid.privateKey);"
```

### 2. Environment Variables

Add the generated keys to your `.env` file:

```env
VAPID_PUBLIC_KEY=<your-generated-public-key>
VAPID_PRIVATE_KEY=<your-generated-private-key>
VAPID_SUBJECT=mailto:notifications@your-domain.com
```

### 3. Database Migration

Run the migration to create the `push_subscriptions` table:

```bash
npm run migrate
```

This creates a table to store user push subscriptions with:
- `user_address`: User's Stellar public key
- `endpoint`: Push service endpoint
- `auth_key`: Subscription authentication key
- `p256dh_key`: Subscription encryption key
- `is_active`: Active/inactive status

### 4. API Endpoints

The following endpoints are automatically available:

#### GET `/api/notifications/vapid-public-key`
Returns the VAPID public key for client-side subscription.

**Response:**
```json
{
  "success": true,
  "data": {
    "publicKey": "BCQF5Hec61hD9m4C4NA93DrmrXAT5NbMk..."
  }
}
```

#### POST `/api/notifications/push-subscribe`
Saves a user's push subscription.

**Request:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

#### POST `/api/notifications/push-unsubscribe`
Removes a push subscription.

**Request:**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

## Frontend Setup

### 1. Service Worker

The Service Worker (`public/sw.src.js`) handles:
- **Push events**: Receives and displays notifications
- **Notification clicks**: Opens the appropriate page when notification is clicked

### 2. usePushNotifications Hook

Use the `usePushNotifications` hook in your components:

```typescript
import { usePushNotifications } from "@/hooks/usePushNotifications";

function MyComponent() {
  const { isSupported, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();

  return (
    <button onClick={subscribe}>
      {isSubscribed ? "Disable Push" : "Enable Push"}
    </button>
  );
}
```

### 3. PushNotificationPrompt Component

Show a prompt after user's first job action:

```typescript
import { useState } from "react";
import PushNotificationPrompt from "@/components/PushNotificationPrompt";

function JobPage() {
  const [actionTaken, setActionTaken] = useState(false);

  const handleApplyForJob = async () => {
    // Apply for job...
    setActionTaken(true); // Triggers prompt
  };

  return (
    <>
      <PushNotificationPrompt
        trigger={actionTaken}
        onDismiss={() => setActionTaken(false)}
      />
      {/* Job content */}
    </>
  );
}
```

### 4. NotificationPreferencesPanel Component

Add the preferences panel to your settings/preferences page:

```typescript
import NotificationPreferencesPanel from "@/components/NotificationPreferencesPanel";

function SettingsPage() {
  return (
    <div>
      <h2>Notification Settings</h2>
      <NotificationPreferencesPanel />
    </div>
  );
}
```

## Sending Notifications from Backend

The notification service automatically sends push notifications for important events.

### Events That Trigger Push Notifications

- `APPLICATION_RECEIVED`: New application received
- `APPLICATION_ACCEPTED`: Application was accepted
- `APPLICATION_REJECTED`: Application was rejected
- `ESCROW_RELEASED`: Payment released
- `DISPUTE_OPENED`: Dispute was opened
- `JOB_INVITED`: Invited to a job
- `NEW_MESSAGE`: New message received

### Example: Sending a Push Notification

```javascript
const { sendPushNotificationForEvent } = require("@/services/notificationService");

await sendPushNotificationForEvent(userAddress, {
  type: "APPLICATION_RECEIVED",
  title: "New Application",
  body: "John Doe applied for your job",
  jobId: "job-123",
  linkPath: "/jobs/job-123"
});
```

## Browser Compatibility

Web Push is supported in:
- Chrome/Edge 50+
- Firefox 44+
- Opera 37+

Safari and other browsers will gracefully degrade (hook returns `isSupported: false`).

## Troubleshooting

### Push Notifications Not Showing

1. Check browser notification permissions (not blocked)
2. Verify VAPID keys are set in `.env`
3. Check browser console for errors
4. Ensure Service Worker is registered: `navigator.serviceWorker.ready`

### Subscription Not Saving

1. Verify user is authenticated
2. Check network tab for 401/403 errors
3. Ensure `/api/notifications/push-subscribe` endpoint is working
4. Check database for `push_subscriptions` table

### Expired Subscriptions

The system automatically handles expired push endpoints (410/404 errors) by marking them as inactive in the database. Users can re-subscribe at any time.

## Security Considerations

- VAPID keys are sensitive - keep `VAPID_PRIVATE_KEY` secret
- Subscriptions are tied to user addresses and can't be shared
- Endpoints are unique per device and won't expose user data
- All communication uses HTTPS in production

## Performance

- Push subscriptions are queried efficiently with indexed lookups
- Notifications are sent asynchronously without blocking
- Failed sends are logged but don't interrupt the flow
- Expired subscriptions are automatically cleaned up
