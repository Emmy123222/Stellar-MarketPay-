# Mobile Bottom Tab Bar

Fixed bottom navigation for mobile viewports. This document records the behaviour
contract and design decisions that were originally captured in a Kiro spec
(`.kiro/specs/mobile-tab-bar/`) and are kept here so contributors do not need the
editor tool to read them.

## Status

The component and its property tests exist, but the tab bar is **not yet mounted
in the app shell**, and the existing Navbar hamburger toggle is still the mobile
navigation path. Treat the behaviour below as the intended contract for
`MobileTabBar`; wiring it into `frontend/pages/_app.tsx` and retiring the
hamburger on mobile is outstanding work.

| Item                                            | State                                        |
| ----------------------------------------------- | -------------------------------------------- |
| `frontend/components/MobileTabBar.tsx`          | Implemented                                  |
| `frontend/components/__tests__/` property tests | Implemented                                  |
| Unit test file for the component                | Not present                                  |
| Mounted in `frontend/pages/_app.tsx`            | Not mounted                                  |
| Navbar hamburger hidden on mobile               | Still rendered (`md:hidden`) in `Navbar.tsx` |

## Behaviour contract

### Visibility and breakpoint

- Renders as a fixed element anchored to the bottom of the viewport on screens
  narrower than 768px, hidden at `md` and above via `md:hidden`.
- When mounted, the Navbar hamburger toggle must be hidden at the same
  breakpoint so both navigation patterns are never visible together.

### Tabs and routing

Five tabs, in this order:

| Tab           | Route            |
| ------------- | ---------------- |
| Home          | `/`              |
| Jobs          | `/jobs`          |
| Dashboard     | `/dashboard`     |
| Notifications | `/notifications` |
| Profile       | `/profile`       |

Each tab shows an icon and a text label, and uses `next/link` so navigation is
client-side and does not trigger a full page reload.

### Active tab

The active tab is derived from `useRouter().pathname`. Exactly one tab receives
the active styling and `aria-current="page"`, and only on an exact route match —
sub-pages such as `/jobs/123` highlight nothing.

### Notification badge

- Hidden when the unread count is `0`.
- Shows the numeric count for `1`–`99`.
- Shows `99+` above `99`.
- Clears when the user navigates to `/notifications`.
- Includes an `sr-only` description of the unread count for screen readers.

### Accessibility

- Root element is `<nav aria-label="Mobile navigation">`.
- Each tab is a link with an `aria-label` naming its destination.
- The active tab carries `aria-current="page"`.
- All tabs are reachable with the keyboard.

## Design decisions

- **Layout-level placement.** The component is meant to be a sibling of `Navbar`
  in the shared Next.js layout, so it stays mounted across route transitions and
  does not flicker.
- **Reuse the notifications API.** The badge polls the same `fetchNotifications`
  endpoint as `NotificationBell` every 30 seconds while a `publicKey` is present.
  Failures are swallowed: the badge is a non-critical enhancement and keeps its
  previous value.
- **No shared notification context.** Local state inside the tab bar is enough
  for this feature; synchronising with the desktop `NotificationBell` is out of
  scope.
- **`next/link` for every tab.** This gives client-side navigation and native
  link semantics (keyboard, middle-click, screen readers) without extra code.

## Files

- `frontend/components/MobileTabBar.tsx` — component and tab configuration.
- `frontend/components/__tests__/MobileTabBar.property.test.tsx` — property
  tests covering tab content, active-tab invariants, and badge text ranges.
- `frontend/components/Navbar.tsx` — desktop-first navigation that still owns
  the mobile hamburger until the switch-over is complete.
