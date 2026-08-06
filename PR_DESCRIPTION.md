# 🔔 XLM Price Alert System — Issue #887

## Summary

This PR wires up a complete XLM price alert system that allows users to set price thresholds (above/below) and receive in-app notifications (with optional push) when the XLM/USD price crosses their defined thresholds. One-time alerts auto-delete after triggering, making the system lightweight and non-spammy.

Closes #887

## What Was Done

### Backend

#### 1. Database Migration (`V22__price_alerts`)
- New `price_alerts` table with columns: `id` (UUID), `user_address`, `condition` (`above`/`below`), `threshold`, `one_time`, `triggered`, `triggered_at`, `created_at`
- Indexes for user lookup and untriggered alert queries
- Down migration included

#### 2. Price Alert Service (`priceAlertService.js`)
- **New CRUD functions:**
  - `createPriceAlert()` — creates an alert with validation (20-alert max per user)
  - `listPriceAlerts()` — lists all alerts for a user
  - `deletePriceAlert()` — deletes an alert by ID with ownership check
  - `cleanupTriggeredAlerts()` — utility for cleaning up stale triggered alerts
- **Enhanced `runOnce()`** — now checks both legacy `price_alert_preferences` (min/max) and the new `price_alerts` (condition/threshold) table
- **`handleNewAlertTrigger()`** — marks alert as triggered, broadcasts via WebSocket, creates in-app notification, auto-deletes one-time alerts
- **`sendPriceAlertNotification()`** — extracted helper to create in-app notifications (reduces duplication between new and legacy paths)
- **Legacy `handleTrigger()`** — updated to also create in-app notifications (was previously WebSocket-only)
- **Automatic cleanup** — stale triggered one-time alerts are purged after 1 hour

#### 3. New Price Alerts Route (`routes/priceAlerts.js`)
- `POST /api/price-alerts` — create a price alert (requires JWT auth)
- `GET /api/price-alerts` — list authenticated user's alerts
- `DELETE /api/price-alerts/:id` — delete an alert by ID
- Rate-limited (10 req/min per user)
- All endpoints protected with `verifyJWT` middleware

#### 4. Server Registration (`server.js`)
- Route registered at `/api/price-alerts`

### Frontend

#### 5. TypeScript Types (`types.ts`)
- Added `PriceAlert` interface matching backend response shape

#### 6. API Client (`api.ts`)
- `createPriceAlert()` — POST to create an alert
- `fetchPriceAlerts()` — GET to list alerts
- `deletePriceAlert()` — DELETE to remove an alert

#### 7. PriceAlertModal Component
- Clean, amber-themed modal matching the app's design system
- **Condition toggle** — "Above" / "Below" with color-coded active states (emerald for above, rose for below)
- **Threshold input** — number field with USD prefix and contextual suggestion (10% above/below current price)
- **One-time toggle** — switch with "auto-deletes after triggering" label
- **Active alerts list** — shows all user's alerts with condition, threshold, type badge, and delete button
- Loading skeleton, empty state, and error handling via `getApiErrorMessage()`

#### 8. XlmPriceWidget Integration
- "⚡ Alert" button in the widget header that opens the PriceAlertModal
- Modal receives `currentPriceUsd` from the widget's chart data for price suggestions

### User Flow
1. User opens dashboard → sees XLM price chart with "⚡ Alert" button
2. Clicks "⚡ Alert" → modal opens showing current price
3. Selects "Above" or "Below" condition → suggested threshold auto-fills
4. Adjusts threshold → optionally toggles one-time mode
5. Clicks "Create Alert" → alert saved, appears in list below
6. Background service checks price every 5 minutes → when threshold crossed → in-app notification appears
7. Push notification sent if enabled in notification preferences
8. One-time alerts auto-delete after triggering
9. Legacy min/max alert preferences continue to work (backward compatible)

## Testing
- [x] Backend lint passes (`npm run lint`)
- [x] All new endpoints follow existing patterns (JWT auth, rate limiting)
- [x] In-app notifications use existing `createInAppNotification` + push mechanism
- [x] WebSocket broadcasting uses existing `broadcast()` pattern
- [x] Backward compatible — legacy `price_alert_preferences` path unchanged
- [x] Migration has both `.up.sql` and `.down.sql`

## Screenshots (if UI change)

N/A — please review in local dev environment or Storybook.

## Type of Change
- [x] New feature
- [x] Frontend component
- [x] Smart contract change (database migration)
