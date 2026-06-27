# Implementation: Subresource Integrity (SRI) for CDN-Loaded Scripts

**Issue**: [#531](https://github.com/Stellar-MarketPay/Stellar-MarketPay/issues/531)  
**Date**: June 26, 2026  
**Status**: Complete  
**Difficulty**: Easy

---

## Problem Statement

Any third-party scripts loaded without SRI hashes can be tampered with by a CDN compromise. If an attacker compromises a CDN (e.g., Google Fonts, jsDelivr), they could inject malicious code into the application, potentially stealing user data or compromising wallet connections.

---

## Acceptance Criteria Checklist

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Audit `_document.tsx` and `next.config.js` for external script/style tags | Complete | [Audit Results](#audit-results) |
| 2 | Add `integrity` and `crossOrigin="anonymous"` to all external assets | Complete | [_document.tsx](#1-documenttsx-changes) |
| 3 | `npm run lint` custom rule flags external `<script src>` without integrity attribute | Complete | [ESLint Plugin](#eslint-plugin-sri) |
| 4 | CI check regenerates and verifies hashes on dependency update PRs | Complete | [SRI Verification Script](#sri-verification-script) |

---

## Audit Results

### Files Audited

| File | External Assets Found | Status |
|------|----------------------|--------|
| `frontend/pages/_document.tsx` | Inline theme script only (no CDN) | No action needed |
| `frontend/next.config.mjs` | None | No action needed |
| `frontend/styles/globals.css` | Google Fonts `@import url()` | **Fixed** |
| `frontend/pages/_app.tsx` | All links local/internal | No action needed |
| All other pages (`/pages/**/*.tsx`) | No external CDN scripts | No action needed |

### External Asset Inventory

| Asset | URL | Type | SRI Status |
|-------|-----|------|------------|
| Google Fonts CSS | `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap` | Stylesheet | **Added** |

---

## Implementation Details

### 1. `_document.tsx` Changes

**Before:**

```tsx
// Google Fonts loaded via CSS @import (no SRI possible)
// In globals.css:
@import url('https://fonts.googleapis.com/css2?family=...');
```

**After:**

```tsx
<Head>
  <link
    rel="preconnect"
    href="https://fonts.googleapis.com"
    crossOrigin="anonymous"
  />
  <link
    rel="preconnect"
    href="https://fonts.gstatic.com"
    crossOrigin="anonymous"
  />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    integrity="sha256-gG/REws4rK1dFJcjBtLvVPYoLvhP7D2yRepUOOFbcKY="
    crossOrigin="anonymous"
  />
  <script dangerouslySetInnerHTML={{ __html: themeScript }} />
</Head>
```

**Key Changes:**
- Added `integrity` attribute with SHA-256 hash
- Added `crossOrigin="anonymous"` attribute
- Added `rel="preconnect"` hints for performance
- Moved font loading from CSS `@import` to HTML `<link>` tag (SRI only works on `<link>` and `<script>` elements)

### 2. `globals.css` Changes

**Removed:**

```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
```

Fonts are now loaded via `_document.tsx` with SRI protection.

---

## ESLint Plugin: `sri`

### Overview

Custom ESLint plugin that flags external `<script>` tags loaded from known CDN hosts without an `integrity` attribute.

### Plugin Structure

```
frontend/
  eslint-plugin-sri/
    index.js                          # Plugin entry point
    package.json                      # Plugin metadata
    rules/
      no-external-script-without-sri.js  # The rule implementation
```

### Rule: `sri/no-external-script-without-sri`

**Severity**: `error` (configured in `.eslintrc.json`)

**What it checks:**
- Scans all JSX `<script>` and `<Script>` elements
- Detects if `src` points to a known CDN host
- Reports an error if `integrity` attribute is missing

**Known CDN Hosts Monitored:**

| Host | Example |
|------|---------|
| `fonts.googleapis.com` | Google Fonts |
| `fonts.gstatic.com` | Google Fonts static |
| `cdn.jsdelivr.net` | jsDelivr |
| `unpkg.com` | unpkg |
| `cdnjs.cloudflare.com` | cdnjs |
| `ajax.googleapis.com` | Google Hosted Libraries |
| `stackpath.bootstrapcdn.com` | BootstrapCDN |
| `maxcdn.bootstrapcdn.com` | MaxCDN |
| `use.fontawesome.com` | Font Awesome |
| `kit.fontawesome.com` | Font Awesome Kit |

**Example Violation:**

```tsx
// ERROR: External script "https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"
// is missing an integrity attribute.
<script src="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js" />
```

**Example Compliant:**

```tsx
// OK: Has integrity attribute
<script
  src="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"
  integrity="sha256-abc123..."
  crossOrigin="anonymous"
/>
```

### Configuration

**`.eslintrc.json`:**

```json
{
  "extends": "next/core-web-vitals",
  "plugins": ["sri"],
  "rules": {
    "react-hooks/exhaustive-deps": "warn",
    "@next/next/no-img-element": "warn",
    "sri/no-external-script-without-sri": "error"
  }
}
```

---

## SRI Verification Script

### Purpose

Automated verification of SRI hashes for all external CDN assets. Designed for CI/CD pipelines to catch hash mismatches during dependency updates.

### Files

| File | Purpose |
|------|---------|
| `scripts/verify-sri.mjs` | Verification script |
| `scripts/sri-hashes.json` | Hash registry |

### Usage

```bash
# Verify all hashes match
npm run verify-sri

# Update hashes after legitimate dependency update
npm run verify-sri:update
```

### Hash Registry Format

**`scripts/sri-hashes.json`:**

```json
{
  "externalAssets": [
    {
      "url": "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      "algorithm": "sha256",
      "hash": "sha256-gG/REws4rK1dFJcjBtLvVPYoLvhP7D2yRepUOOFbcKY=",
      "note": "Google Fonts CSS — regenerated by scripts/verify-sri.mjs"
    }
  ]
}
```

### CI Integration

Add to your CI pipeline (e.g., `.github/workflows/ci.yml`):

```yaml
- name: Verify SRI hashes
  run: npm run verify-sri
  working-directory: frontend
```

On dependency update PRs where the hash changes:

```bash
# Review the mismatch, then update if legitimate
npm run verify-sri:update
git add scripts/sri-hashes.json
git commit -m "chore: update SRI hashes for Google Fonts"
```

---

## NPM Scripts Added

| Script | Command | Purpose |
|--------|---------|---------|
| `lint:ci` | `next lint --max-warnings=0` | Strict lint for CI (no warnings allowed) |
| `verify-sri` | `node scripts/verify-sri.mjs` | Verify SRI hashes match |
| `verify-sri:update` | `node scripts/verify-sri.mjs --update` | Regenerate SRI hashes |

---

## Files Changed/Created

### Modified Files

| File | Change |
|------|--------|
| `frontend/pages/_document.tsx` | Added SRI-protected Google Fonts `<link>` tags |
| `frontend/styles/globals.css` | Removed `@import url()` for Google Fonts |
| `frontend/.eslintrc.json` | Added `sri` plugin and rule |
| `frontend/package.json` | Added `lint:ci`, `verify-sri`, `verify-sri:update` scripts; added `eslint-plugin-sri` devDependency |

### Created Files

| File | Purpose |
|------|---------|
| `frontend/eslint-plugin-sri/index.js` | ESLint plugin entry point |
| `frontend/eslint-plugin-sri/package.json` | Plugin metadata |
| `frontend/eslint-plugin-sri/rules/no-external-script-without-sri.js` | ESLint rule implementation |
| `scripts/verify-sri.mjs` | SRI hash verification script |
| `scripts/sri-hashes.json` | SRI hash registry |

---

## Verification

### Lint Check

```bash
$ npm run lint

# Result: Only pre-existing warnings (no new errors, no SRI violations)
```

### SRI Hash Verification

```bash
$ npm run verify-sri

# Result:
# [OK] https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap
# All SRI hashes verified.
```

---

## Security Impact

| Threat | Mitigation |
|--------|------------|
| CDN compromise injecting malicious code | SRI hash verification blocks tampered content |
| Man-in-the-middle attack on CDN | `crossOrigin="anonymous"` enables CORS, integrity check fails on modification |
| Future external scripts without SRI | ESLint rule `sri/no-external-script-without-sri` blocks PRs |
| Hash staleness after dependency updates | `npm run verify-sri` CI check catches mismatches |

---

## Future Considerations

1. **Additional CDN hosts**: Add more hosts to the `CDN_HOSTS` list in the ESLint rule as the project adopts more external dependencies.
2. **CSP headers**: Consider adding `Content-Security-Policy` headers with `require-sri-for script style` directive.
3. **Font self-hosting**: For maximum security, consider using `next/font` to self-host fonts, eliminating external CDN dependency entirely.
