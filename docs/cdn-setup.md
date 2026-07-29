# CDN Caching Configuration

> Part of [Issue #820](https://github.com/Emmy123222/Stellar-MarketPay-/issues/820)
> — Add CDN caching for static assets and Next.js build output

## Overview

This document describes the CDN caching strategy for Stellar MarketPay.
The frontend is a Next.js application served behind an Nginx reverse proxy
with an optional CDN (Cloudflare or Vercel Edge Network).

## Cache Headers

| Resource Pattern | Cache Header | Duration | Rationale |
|---|---|---|---|
| `/_next/static/*` (hashed assets) | `public, max-age=31536000, immutable` | 1 year | Content-hashed filenames never change |
| `/static/*` | `public, max-age=31536000, immutable` | 1 year | Static assets with unique URLs |
| Images (`*.png`, `*.jpg`, etc.) | `public, max-age=31536000, immutable` | 1 year | Versioned or content-hashed |
| HTML pages | `no-cache, no-store, must-revalidate` | 0 | Fresh content on every request |
| API responses (`/api/*`) | `no-cache, no-store, must-revalidate` | 0 | Dynamic data |
| Service Worker (`/sw.js`) | `no-cache, no-store, must-revalidate` | 0 | Must always be current |
| Profile pages | `public, max-age=3600` | 1 hour | Semi-static user profiles |

## Configuration

### Next.js (`next.config.mjs`)

Cache headers are set via the Next.js `headers()` function in `next.config.mjs`.
Hashed static assets (`/_next/static/*`) use `immutable` caching — they are
fingerprinted by content hash so they never need revalidation.

### Nginx

The `infra/nginx.conf` file includes additional cache headers for static files
served directly by Nginx:

```nginx
location /_next/static/ {
    alias /var/www/stellar-marketpay/.next/static/;
    expires 365d;
    add_header Cache-Control "public, immutable";
}
```

### CDN: Cloudflare

When deploying behind Cloudflare:

1. **Cache rules**: Create a page rule for `*stellar-marketpay.com/_next/static/*`
   with **Cache Level: Cache Everything** and **Edge Cache TTL: 1 year**.
2. **HTML exclusion**: Add a cache rule for `*stellar-marketpay.com/*` with
   **Cache Level: Bypass** when the response `Cache-Control` header includes
   `no-cache`.
3. **Auto Minify**: Enable JavaScript, CSS, and HTML minification.
4. **Brotli**: Enable **Brotli** compression in the Cloudflare dashboard
   (Speed → Optimization → Brotli).

### CDN: Vercel Edge Network

If deployed on Vercel:

1. The Vercel Edge Network automatically respects `Cache-Control` headers.
2. Static assets in `/_next/static/` are served from the Vercel CDN with
   `public, max-age=31536000, immutable`.
3. No additional configuration is required — Vercel handles CDN caching
   automatically based on response headers.

## Verification

Use `curl` to verify cache headers:

```bash
# Hashed static asset (should be immutable)
curl -I https://stellar-marketpay.com/_next/static/css/app.layout.css
# Expect: cache-control: public, max-age=31536000, immutable

# HTML page (should not be cached)
curl -I https://stellar-marketpay.com/
# Expect: cache-control: no-cache, no-store, must-revalidate

# API response
curl -I https://stellar-marketpay.com/api/health
# Expect: cache-control: no-cache, no-store, must-revalidate
```

## CDN Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   End User   │────▶│   CDN Edge   │────▶│  Nginx Reverse   │
│  (Browser)   │     │ (Cloudflare/ │     │      Proxy       │
└──────────────┘     │   Vercel)    │     ├──────────────────┤
                     └──────────────┘     │ Next.js (Frontend)│
                                           │ Express  (Backend)│
                                           └──────────────────┘
```

- Static assets are served from CDN edge caches worldwide.
- HTML pages and API responses bypass the CDN cache and are always fresh.
- Brotli compression is negotiated via `Accept-Encoding` header.
- The `Vary: Accept-Encoding` header ensures CDNs cache both compressed
  and uncompressed variants.
