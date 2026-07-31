# Accessibility Implementation Guide

## Overview

Stellar MarketPay implements WCAG 2.1 Level AA accessibility standards with comprehensive support for:

- ✅ **Color Contrast**: All text meets minimum 4.5:1 (normal) or 3:1 (large text) contrast ratios
- ✅ **High Contrast Mode**: Built-in high contrast theme with maximum visibility
- ✅ **Windows High Contrast Mode**: Full support for `forced-colors` media queries
- ✅ **Keyboard Navigation**: Enhanced focus indicators and complete keyboard accessibility
- ✅ **Automated Testing**: axe-core integration in both E2E and unit tests

---

## Theme System

### Available Themes

1. **Light Mode** (Default for light OS preference)
   - Background: `#fafaf8`
   - Text: `#1c1917` (15.8:1 contrast)
   - Muted text: `#57534e` (7.1:1 contrast)

2. **Dark Mode** (Default for dark OS preference)
   - Background: `#0c0a06`
   - Text: `#fef3c7` (14.1:1 contrast)
   - Muted text: `#d4b896` (7.8:1 contrast)

3. **High Contrast Mode** (For users with low vision)
   - Background: `#000000`
   - Text: `#ffffff` (21:1 contrast)
   - All interactive elements have 2px borders
   - Enhanced 3px focus indicators

### Theme Toggle

Users can switch themes via:
- **UI**: Click the floating theme button (bottom-left corner)
- **Keyboard**: Press `Shift + T` to cycle through themes
- **Persistence**: Selection is saved to `localStorage` as `smp_theme`

### Automatic Detection

The application automatically detects and respects:
- `prefers-color-scheme`: System light/dark preference
- `prefers-contrast: more`: System high contrast preference

---

## Color Contrast Standards

### WCAG 2.1 AA Requirements

| Element Type | Minimum Ratio | Implementation |
|-------------|---------------|----------------|
| Normal text (< 18pt) | 4.5:1 | All body text, labels, descriptions |
| Large text (≥ 18pt) | 3:1 | Headings, large UI elements |
| UI components | 3:1 | Borders, focus indicators, icons |
| Graphical objects | 3:1 | Charts, badges, status indicators |

### Color Variables

All colors are defined as CSS custom properties in `styles/globals.css`:

```css
:root {
  --text:         #1c1917;  /* 15.8:1 on white */
  --text-muted:   #57534e;  /* 7.1:1 on white */
  --text-subtle:  #78716c;  /* 4.6:1 on white */
  --gold:         #b45309;  /* 4.5:1 on white */
}

html.dark {
  --text:         #fef3c7;  /* 14.1:1 on #0c0a06 */
  --text-muted:   #d4b896;  /* 7.8:1 on #0c0a06 */
  --text-subtle:  #8a7655;  /* 4.6:1 on #0c0a06 */
  --gold:         #fbbf24;  /* 9.2:1 on #0c0a06 */
}

html.high-contrast {
  --text:         #ffffff;  /* 21:1 on black */
  --text-muted:   #e0e0e0;  /* 14.6:1 on black */
  --text-subtle:  #b0b0b0;  /* 9.7:1 on black */
  --gold:         #ffdd44;  /* 12.8:1 on black */
}
```

---

## Windows High Contrast Mode

### Forced Colors Support

The application respects Windows High Contrast Mode using the `forced-colors` media query:

```css
@media (forced-colors: active) {
  /* Ensure borders remain visible */
  .card, button, input {
    border: 1px solid CanvasText;
  }

  /* Enhanced focus indicators */
  *:focus-visible {
    outline: 3px solid Highlight !important;
    outline-offset: 2px !important;
  }

  /* Buttons use system colors */
  .btn-primary, .btn-secondary {
    border: 2px solid ButtonText;
    forced-color-adjust: none;
  }
}
```

### System Color Keywords

When forced colors are active, the following system colors are used:
- `CanvasText`: For borders and text
- `Highlight`: For focus indicators
- `ButtonText`: For button borders

---

## Automated Testing

### E2E Tests (Playwright + axe-core)

Located in: `tests/e2e/accessibility.spec.ts`

Tests run on 20+ pages across all theme modes:
```bash
npm run test:e2e -- accessibility
```

Features:
- Scans all pages for WCAG 2.1 AA violations
- Specific color contrast checks
- Tests light, dark, and high contrast themes
- Fails CI on critical or serious violations

### Unit Tests (Jest + jest-axe)

Located in: `__tests__/accessibility.test.tsx`

Tests component-level accessibility:
```bash
npm test -- accessibility.test
```

Features:
- Component isolation testing
- Theme-specific contrast validation
- Form, button, and card accessibility
- Fast feedback during development

---

## Component Guidelines

### Buttons

All buttons include:
- Minimum 44×44px touch target
- Visible focus indicators (2px ring)
- High contrast mode support
- ARIA labels where needed

```tsx
<button 
  className="btn-primary"
  aria-label="Submit form"
>
  Submit
</button>
```

### Form Fields

All inputs include:
- Associated `<label>` with `htmlFor`
- Placeholder text with 4.5:1 contrast
- Clear focus indicators
- Error states with ARIA attributes

```tsx
<label htmlFor="email" className="label">
  Email Address
</label>
<input
  id="email"
  type="email"
  className="input-field"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby={hasError ? "email-error" : undefined}
/>
```

### Focus Indicators

All interactive elements have visible focus states:

- **Normal mode**: 2px ring with offset
- **High contrast mode**: 3px ring with 3px offset
- **Forced colors mode**: 3px system Highlight color

```css
*:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

html.high-contrast *:focus-visible {
  outline: 3px solid var(--gold) !important;
  outline-offset: 3px !important;
}
```

---

## Best Practices

### Do's ✅

- Use semantic HTML elements
- Provide text alternatives for images
- Ensure minimum 4.5:1 contrast for text
- Test with keyboard navigation only
- Include skip links for main content
- Use ARIA labels for icon-only buttons
- Test with screen readers
- Respect user's system preferences

### Don'ts ❌

- Don't use color alone to convey information
- Don't rely solely on hover states
- Don't use light text on light backgrounds
- Don't disable outline styles globally
- Don't use `opacity` to meet contrast requirements
- Don't auto-play media without controls
- Don't use small touch targets (< 44px)

---

## Manual Testing Checklist

### Keyboard Navigation
- [ ] All interactive elements are reachable with Tab
- [ ] Focus order is logical and intuitive
- [ ] Focus indicators are clearly visible
- [ ] Modal dialogs trap focus appropriately
- [ ] Escape key closes modals and menus

### Screen Reader Testing
- [ ] All images have alt text
- [ ] Form fields have associated labels
- [ ] Error messages are announced
- [ ] Dynamic content updates are announced
- [ ] Heading hierarchy is logical

### Visual Testing
- [ ] Text is readable at 200% zoom
- [ ] Layout doesn't break at 400% zoom (text only)
- [ ] No horizontal scrolling at standard zoom
- [ ] Content is readable in Windows High Contrast Mode
- [ ] Focus indicators visible in all themes

---

## Resources

### WCAG 2.1 Guidelines
- [WCAG 2.1 Level AA](https://www.w3.org/WAI/WCAG21/quickref/?currentsidebar=%23col_customize&levels=aaa)
- [Contrast Ratio Calculator](https://contrast-ratio.com/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Testing Tools
- [axe DevTools Browser Extension](https://www.deque.com/axe/devtools/)
- [WAVE Web Accessibility Evaluation Tool](https://wave.webaim.org/)
- [Lighthouse Accessibility Audit](https://developers.google.com/web/tools/lighthouse)

### Screen Readers
- **Windows**: NVDA (free), JAWS
- **macOS**: VoiceOver (built-in)
- **Mobile**: TalkBack (Android), VoiceOver (iOS)

---

## Continuous Improvement

### Reporting Issues

If you discover an accessibility issue:
1. Check if it's already reported in GitHub Issues
2. Provide specific details (browser, OS, assistive technology)
3. Include steps to reproduce
4. Note WCAG criterion if applicable

### Contributing

When submitting PRs:
1. Run accessibility tests: `npm test && npm run test:e2e`
2. Verify keyboard navigation works
3. Check color contrast in all themes
4. Test with a screen reader if possible
5. Update this documentation if needed

---

## Compliance Statement

Stellar MarketPay strives to meet WCAG 2.1 Level AA standards. While we've implemented comprehensive accessibility features and automated testing, full compliance requires manual validation with assistive technologies and expert accessibility review.

**Last Updated**: 2024
**Contact**: For accessibility concerns, please open a GitHub issue or contact the development team.
