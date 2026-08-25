# Implementation Plan: Mobile Tab Bar

## Overview

Introduce a fixed bottom `MobileTabBar` component for viewports narrower than 768px, wire it into the Next.js layout, hide the existing Navbar hamburger toggle on mobile, and cover all six correctness properties with unit and property-based tests.

## Tasks

- [x] 1. Install fast-check dev dependency
  - Run `npm install --save-dev fast-check` in the `frontend` directory
  - Verify `fast-check` appears in `package.json` devDependencies
  - _Requirements: (testing infrastructure)_

- [x] 2. Create MobileTabBar component
  - [x] 2.1 Implement `frontend/components/MobileTabBar.tsx`
    - Define `TABS` array with five entries: Home (`/`), Jobs (`/jobs`), Dashboard (`/dashboard`), Notifications (`/notifications`), Profile (`/profile`) — each with `href`, `label`, `ariaLabel`, and an inline SVG icon
    - Render a `<nCreate the design for theav aria-label="Mobile navigation">` root element with `md:hidden` Tailwind class and `fixed bottom-0` positioning
    - Render each tab as a Next.js `<Link>` with the tab's `aria-label`; apply active colour classes and `aria-current="page"` when `useRouter().pathname` exactly matches the tab's `href`
    - Implement `unreadCount` local state; poll `fetchNotifications` on mount and every 30 s when `publicKey` is non-null; clear `unreadCount` to `0` when pathname is `/notifications`
    - Render `NotificationBadge` on the Notifications tab: hidden when `unreadCount === 0`; shows `String(n)` for 1–99; shows `"99+"` for n > 99; includes an `sr-only` span with the count text
    - Accept `publicKey: string | null` and optional `initialUnreadCount?: number` props (the latter supports test injection)
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 2.2 Write unit tests for MobileTabBar at `frontend/components/__tests__/MobileTabBar.test.tsx`
    - Renders `<nav>` with `aria-label="Mobile navigation"` (Req 6.1)
    - Root element has `md:hidden` class (Req 1.2)
    - Renders exactly 5 tab links in order: Home, Jobs, Dashboard, Notifications, Profile (Req 2.1)
    - Each link uses Next.js `<Link>` — no bare reload-triggering `<a href>` (Req 5.2)
    - Badge absent when `unreadCount = 0` (Req 4.2)
    - Badge shows numeric count for a spot-check value in 1–99 range (Req 4.3)
    - Badge shows `"99+"` for a spot-check value above 99 (Req 4.4)
    - `aria-current="page"` is set on the active tab and absent on all others (Req 3.1, 6.3)
    - _Requirements: 1.2, 2.1, 3.1, 4.2, 4.3, 4.4, 5.2, 6.1, 6.3_

- [x] 3. Modify Navbar to hide hamburger toggle on mobile
  - [x] 3.1 Edit `frontend/components/Navbar.tsx`
    - Change the Mobile Menu Toggle `<button>` class from `md:hidden …` to `hidden …` so the hamburger is never shown (MobileTabBar handles mobile navigation entirely)
    - The mobile menu `{mobileMenuOpen && …}` panel can remain in source but will never open since the toggle is hidden; optionally remove it to reduce dead code
    - _Requirements: 1.3_

- [x] 4. Mount MobileTabBar in the layout
  - [x] 4.1 Locate the Next.js layout entry point (`frontend/pages/_app.tsx` or equivalent) and import `MobileTabBar`
    - Add `<MobileTabBar publicKey={publicKey} />` as a sibling of `<Navbar>` inside the layout, ensuring it is rendered on every page
    - Pass the authenticated `publicKey` (or `null`) down from wherever auth state lives in `_app.tsx`
    - _Requirements: 1.1, 5.1_

- [x] 5. Checkpoint — Ensure all unit tests pass
  - Run the frontend test suite and confirm no regressions; ask the user if questions arise.

- [x] 6. Write property-based tests
  - [ ]* 6.1 Write property test for Property 1: each tab renders icon, label, and aria-label
    - File: `frontend/components/__tests__/MobileTabBar.property.test.tsx`
    - Use `fc.constantFrom(...TABS)` to sample a tab; assert the rendered `<Link>` has the correct `aria-label`, contains an SVG icon, and has visible text content matching the label
    - `numRuns: 100`
    - **Property 1: Each tab renders icon, label, and aria-label**
    - **Validates: Requirements 2.3, 6.2**

  - [ ]* 6.2 Write property test for Property 2: exactly one active tab per matching pathname
    - Use `fc.constantFrom("/", "/jobs", "/dashboard", "/notifications", "/profile")` as pathname; assert exactly one link has `aria-current="page"` and its `href` matches the pathname
    - `numRuns: 100`
    - **Property 2: Exactly one active tab for any matching pathname**
    - **Validates: Requirements 3.1, 3.3, 6.3**

  - [ ]* 6.3 Write property test for Property 3: badge shows numeric count for 1–99
    - Use `fc.integer({ min: 1, max: 99 })` as `initialUnreadCount`; assert the badge text equals `String(count)`
    - `numRuns: 100`
    - **Property 3: Badge displays numeric count for counts 1–99**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 6.4 Write property test for Property 4: badge displays "99+" for counts above 99
    - Use `fc.integer({ min: 100, max: 10000 })` as `initialUnreadCount`; assert badge text is `"99+"`
    - `numRuns: 100`
    - **Property 4: Badge displays "99+" for counts above 99**
    - **Validates: Requirements 4.4**

  - [ ]* 6.5 Write property test for Property 5: badge cleared on navigation to /notifications
    - Use `fc.integer({ min: 1, max: 999 })` as `initialUnreadCount`; render with a non-notifications pathname, assert badge present; rerender with `pathname="/notifications"`, assert badge absent
    - `numRuns: 100`
    - **Property 5: Badge cleared on navigation to /notifications**
    - **Validates: Requirements 4.5**

  - [ ]* 6.6 Write property test for Property 6: sr-only text present for positive counts
    - Use `fc.integer({ min: 1, max: 10000 })` as `initialUnreadCount`; assert a `.sr-only` element exists and its text matches `/\d|99\+/`
    - `numRuns: 100`
    - **Property 6: sr-only badge text present when count is positive**
    - **Validates: Requirements 6.4**

- [x] 7. Final checkpoint — Ensure all tests pass
  - Run the full frontend test suite (unit + property-based); confirm all tests green; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `initialUnreadCount` prop is a test-only injection point; it is not required at the call site in `_app.tsx`
- Property tests require a mock `RouterContext` provider to control `pathname` without a real router
- All property tests live in the same file (`MobileTabBar.property.test.tsx`) for discoverability
- The hamburger toggle change in Task 3 is the minimal edit to `Navbar.tsx`; no other Navbar logic changes
