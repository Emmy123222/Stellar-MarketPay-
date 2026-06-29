# Accessibility Follow-Up Issues

## Moderate Violations (Non-blocking)

### 1. Color Contrast — Secondary Text
- **Files**: Multiple components (`EditProfileForm.tsx`, `ApplicationForm.tsx`, `JobFiltersPanel.tsx`)
- **Issue**: `text-amber-700` and `text-amber-600` on dark backgrounds may have borderline contrast (~3.5:1) for small text
- **Fix**: Increase to `text-amber-500` or larger font size for WCAG AA compliance
- **Priority**: Medium — affects readability of secondary/helper text

### 2. Missing Landmark Roles
- **Files**: `pages/_app.tsx`, various page components
- **Issue**: Some pages lack `<main>`, `<nav>`, `<aside>` landmarks consistently
- **Fix**: Ensure all pages use semantic HTML5 landmark elements
- **Priority**: Medium — affects screen reader navigation

### 3. Focus Indicators on Custom Buttons
- **Files**: `components/WalletConnect.tsx`, `components/BulkJobActionBar.tsx`
- **Issue**: Custom-styled buttons may not have visible focus outlines on keyboard navigation
- **Fix**: Add `focus-visible:ring-2 focus-visible:ring-market-400` to all interactive elements
- **Priority**: Medium — affects keyboard-only users

## Minor Violations (Low priority)

### 4. Redundant Link Text
- **Files**: `pages/jobs/index.tsx`, `pages/freelancers/index.tsx`
- **Issue**: "View details" or "Learn more" repeated across multiple cards
- **Fix**: Use `aria-label` with unique context (e.g., `aria-label="View ${job.title}"`)
- **Priority**: Low — affects screen reader UX

### 5. Missing `<title>` on Modals
- **Files**: `components/ShareJobModal.tsx`, `components/FeeEstimationModal.tsx`
- **Issue**: Modal dialogs lack `<title>` elements or `aria-labelledby`
- **Fix**: Add `aria-labelledby` pointing to modal heading
- **Priority**: Low — most screen readers handle `role="dialog"` well

### 6. Touch Target Size
- **Files**: `components/NotificationBell.tsx`, `components/JobCard.tsx`
- **Issue**: Some interactive elements may be smaller than 44x44px minimum
- **Fix**: Ensure all clickable elements meet WCAG 2.5.8 target size
- **Priority**: Low — affects mobile/touch users

### 7. Missing `lang` Attribute Updates
- **Files**: `pages/_document.tsx`
- **Issue**: Page language is hardcoded to `en`; no dynamic language switching
- **Fix**: Not applicable unless i18n is implemented
- **Priority**: Low — English-only app

---

**Generated**: 2026-06-28
**Audit Tool**: axe-core via @axe-core/playwright
**Standard**: WCAG 2.1 AA
