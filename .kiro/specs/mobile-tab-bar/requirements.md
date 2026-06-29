# Requirements Document

## Introduction

The current Navbar component is desktop-first and uses a hamburger-menu pattern on mobile. This feature replaces that pattern with a fixed bottom tab bar on mobile viewports (screens narrower than 768px), matching the ergonomic convention of native mobile apps. The tab bar provides quick access to the five primary destinations: Home, Jobs, Dashboard, Notifications, and Profile. The existing Navbar continues to serve desktop and tablet users unchanged.

## Glossary

- **MobileTabBar**: The new fixed bottom navigation component rendered exclusively on viewports narrower than 768px.
- **Tab**: A single navigation item within the MobileTabBar, consisting of an icon, a label, and an optional badge.
- **Active_Tab**: The Tab whose route matches the current page pathname.
- **Notification_Badge**: A numeric or dot indicator rendered on the Notifications Tab when unread notifications are present.
- **Viewport**: The visible display area of the browser window.
- **Router**: The Next.js client-side router used to determine the current pathname and navigate between pages.
- **Navbar**: The existing sticky top navigation bar component defined in `frontend/components/Navbar.tsx`.

---

## Requirements

### Requirement 1: Visibility and Breakpoint

**User Story:** As a mobile user, I want a bottom tab bar instead of a hamburger menu, so that primary navigation is always reachable with my thumb.

#### Acceptance Criteria

1. THE MobileTabBar SHALL render as a fixed element anchored to the bottom of the Viewport on screens narrower than 768px.
2. THE MobileTabBar SHALL be hidden on screens 768px wide or wider using the Tailwind `md:hidden` utility class.
3. WHILE the MobileTabBar is visible, THE Navbar hamburger menu toggle SHALL be hidden on the same breakpoint so the two navigation patterns do not appear simultaneously.

---

### Requirement 2: Tab Set and Routing

**User Story:** As a mobile user, I want tabs for the five core sections, so that I can reach any primary destination in one tap.

#### Acceptance Criteria

1. THE MobileTabBar SHALL contain exactly five Tabs in the following order: Home (`/`), Jobs (`/jobs`), Dashboard (`/dashboard`), Notifications (`/notifications`), and Profile (`/profile`).
2. WHEN a user taps a Tab, THE Router SHALL navigate to the corresponding route.
3. THE MobileTabBar SHALL display an icon and a text label for each Tab.

---

### Requirement 3: Active Tab Highlighting

**User Story:** As a mobile user, I want the current section's tab to be visually highlighted, so that I always know where I am.

#### Acceptance Criteria

1. WHEN the current pathname matches a Tab's route, THE Active_Tab SHALL receive a distinct visual treatment (highlighted icon and label color) that differs from inactive Tabs.
2. WHEN the Router navigates to a new route, THE MobileTabBar SHALL update the Active_Tab to reflect the new pathname without a full-page reload.
3. THE MobileTabBar SHALL apply the active style exclusively to the Tab whose route exactly matches the current pathname.

---

### Requirement 4: Notification Badge

**User Story:** As a mobile user, I want a badge on the Notifications tab when I have unread notifications, so that I don't miss activity.

#### Acceptance Criteria

1. WHEN the unread notification count is greater than zero, THE Notification_Badge SHALL be displayed on the Notifications Tab.
2. WHEN the unread notification count is zero, THE Notification_Badge SHALL not be rendered.
3. WHEN the unread notification count is between 1 and 99 inclusive, THE Notification_Badge SHALL display the numeric count.
4. WHEN the unread notification count exceeds 99, THE Notification_Badge SHALL display "99+" instead of the exact count.
5. WHEN the user navigates to the Notifications route, THE Notification_Badge SHALL be cleared.

---

### Requirement 5: Page Transition

**User Story:** As a mobile user, I want smooth transitions between pages, so that navigation feels native and there is no jarring full-page flicker.

#### Acceptance Criteria

1. WHEN the Router navigates between routes, THE MobileTabBar SHALL remain mounted and visible throughout the transition without unmounting and remounting.
2. WHEN the Router navigates between routes, THE application SHALL use Next.js client-side navigation so that no full-page browser reload occurs.

---

### Requirement 6: Accessibility

**User Story:** As a user relying on assistive technology, I want each tab to be properly labelled, so that I can navigate the application using a screen reader or keyboard.

#### Acceptance Criteria

1. THE MobileTabBar SHALL be rendered as a `<nav>` element with `aria-label="Mobile navigation"`.
2. THE MobileTabBar SHALL render each Tab as a `<button>` or `<a>` element with an `aria-label` that describes its destination (e.g., "Home", "Jobs", "Dashboard", "Notifications", "Profile").
3. WHEN a Tab is the Active_Tab, THE Tab SHALL have `aria-current="page"` set.
4. THE Notification_Badge SHALL include a visually hidden text description (e.g., via `sr-only`) that conveys the unread count to screen readers.
5. THE MobileTabBar SHALL be keyboard-navigable, allowing users to reach each Tab using the Tab key.
