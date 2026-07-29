# feat(realtime-bid-comparison): Wire RealtimeBidComparison to WebSocket server

## Summary

`RealtimeBidComparison` existed as a component but had its WebSocket logic embedded inline and was missing several key behaviours: the `application:withdrawn` event was never handled, there was no fallback when the socket disconnected, no optimistic updates on accept/reject, and no user-facing notification when new proposals arrived while the tab was hidden. This change fully wires the component to the WebSocket server and implements all missing features.

---

## What Changed

### Backend — `backend/src/routes/applications.js`

- `POST /:id/accept` now broadcasts an `application:accepted` event after a proposal is accepted, so all connected clients can update the status badge immediately without a page refresh
- `DELETE /:id` now broadcasts an `application:withdrawn` event after a freelancer withdraws, so all connected clients can animate and remove the card in real time

### New Hook — `frontend/hooks/useRealtimeBids.ts`

Extracted all real-time state management out of the component into a dedicated hook. Responsibilities:

| Concern | Behaviour |
|---------|-----------|
| WebSocket connection | Connects to `/ws/realtime`, auto-reconnects every 3 s on close |
| `new_bid` event | Appends card, highlights it for 3 s, increments `newProposalsCount` when tab is hidden |
| `application:withdrawn` | Fades card out (400 ms) then removes it from state |
| `application:accepted` | Updates status to `"accepted"` in local state |
| Fallback polling | Starts a 30 s interval when WebSocket closes; stops immediately on reconnect |
| Optimistic mutations | `optimisticAccept` / `optimisticReject` update status before the server responds |

### Component — `frontend/components/RealtimeBidComparison.tsx`

- Replaced inline WebSocket code with `useRealtimeBids` hook
- Cards now animate out on withdrawal (`opacity-0 scale-95` CSS transition)
- Accept button triggers optimistic update before calling `onAcceptApplication`
- "X new proposals" button appears in the header when proposals arrive in a hidden tab — clicking it scrolls to the newest card and resets the counter
- Toast notification fired via existing `useToast` when new proposals arrive while the tab is hidden
- Connection status footer now shows "polling every 30 s" when WebSocket is disconnected

---

## Acceptance Criteria Coverage

| Criterion | Status |
|-----------|--------|
| `application:new` triggers append to proposal list | ✅ |
| `application:withdrawn` removes card with fade animation | ✅ |
| Optimistic update on client's own accept | ✅ |
| Fallback polling every 30 s if WebSocket disconnected | ✅ |
| "X new proposals" toast with scroll-to-new button | ✅ |
