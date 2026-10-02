# CDN Caching Configuration

> Part of [Issue #820](https://github.com/Emmy123222/Stellar-MarketPay-/issues/820)
> — Add CDN caching for static assets and Next.js build output

## Overview

This document describes the CDN caching strategy and edge network configuration for Stellar MarketPay.
The frontend is a Next.js application served behind an Nginx reverse proxy with an edge CDN (Cloudflare or Vercel Edge Network).

Proper caching ensures:
1. **Low TTFB (Time to First Byte):** Globally distributed CDN edge nodes cache and serve immutable assets closer to users.
2. **Reduced Origin Load:** Origin servers only process dynamic requests, reducing CPU and bandwidth overhead.
3. **Cache Invalidation Safety:** Content-hashed static assets are safe to cache forever (`immutable`), while HTML pages and dynamic APIs are never cached stale.

---

## Cache Headers Strategy

| Resource Pattern | Cache Header | TTL | Rationale |
|---|---|---|---|
| `/_next/static/*` (hashed bundles/CSS) | `public, max-age=31536000, immutable` | 1 year | Content-hashed filenames guarantee uniqueness; never change |
| Static media (`*.ico`, `*.png`, `*.jpg`, `*.svg`, `*.webp`, `*.woff2`) | `public, max-age=31536000, immutable` | 1 year | Versioned and content-hashed asset files |
| Profile pages (`/profile/*`) | `public, max-age=3600` | 1 hour | Semi-static user profiles |
| HTML pages (`/*`) | `no-cache, no-store, must-revalidate` | 0s | Users immediately receive fresh application deployments |
| API routes (`/api/*`) | `no-cache, no-store, must-revalidate` | 0s | Dynamic data requiring authentication and fresh responses |
| Service Worker (`/sw.js`) | `no-cache, no-store, must-revalidate` | 0s | Service workers control caching and must never be cached stale |

---

## Configuration

### Next.js (`frontend/next.config.mjs`)

Cache headers are configured in Next.js via the `headers()` function in `frontend/next.config.mjs`:

```javascript
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        ...securityHeaders,
        {
          key: 'Link',
          value: '</_next/static/css/app/layout.css>; rel=preload; as=style, </_next/static/chunks/webpack.js>; rel=preload; as=script, </_next/static/chunks/framework.js>; rel=preload; as=script',
        },
        // HTML pages should not be cached by CDNs so users always get fresh content
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      ],
    },
    {
      source: '/_next/static/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
    {
      source: '/profile/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=3600' },
      ],
    },
    // Static assets (fonts, images, favicon) with long-lived immutable cache
    {
      source: '/(.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|otf))',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
    // Service worker must never be cached
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
    // API routes should not be cached
    {
      source: '/api/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      ],
    },
  ];
}
```

### Nginx Reverse Proxy (`infra/nginx.conf`)

For self-hosted or Docker-based deployments, Nginx can directly serve static assets with matching headers:

```nginx
location /_next/static/ {
    alias /var/www/stellar-marketpay/.next/static/;
    expires 365d;
    add_header Cache-Control "public, immutable";
}
```

### Cloudflare Configuration

When proxying traffic through Cloudflare:

1. **Page Rule for Static Assets:**
   - **URL:** `*stellar-marketpay.com/_next/static/*`
   - **Cache Level:** *Cache Everything*
   - **Edge Cache TTL:** *1 year*
   - **Browser Cache TTL:** *Respect Existing Headers*
2. **Page Rule for HTML & APIs:**
   - **URL:** `*stellar-marketpay.com/*`
   - **Cache Level:** *Bypass* when `Cache-Control` includes `no-cache` / `no-store`.
3. **Speed & Compression:**
   - Enable **Auto Minify** for JavaScript, CSS, and HTML under *Speed → Optimization*.
   - Enable **Brotli** compression.
   - Enable **HTTP/2** and **HTTP/3 (with QUIC)**.

### Vercel Edge Network Configuration

If deployed directly to Vercel:

1. The Vercel Edge Network automatically reads and respects origin `Cache-Control` headers from `next.config.mjs`.
2. Static chunks under `/_next/static/` are cached indefinitely across Vercel's global edge network.
3. No manual edge rules are necessary.

---

## Verification & Validation

Use `curl -I` to verify response headers from deployed or local endpoints:

```bash
# 1. Hashed static bundle (must return 1-year immutable cache)
curl -I https://stellar-marketpay.com/_next/static/chunks/main.js
# Expected response headers:
# HTTP/2 200
# cache-control: public, max-age=31536000, immutable

# 2. Static image or font asset
curl -I https://stellar-marketpay.com/favicon.ico
# Expected response headers:
# HTTP/2 200
# cache-control: public, max-age=31536000, immutable

# 3. HTML Document (must require revalidation)
curl -I https://stellar-marketpay.com/
# Expected response headers:
# HTTP/2 200
# cache-control: no-cache, no-store, must-revalidate

# 4. Service Worker (must require revalidation)
curl -I https://stellar-marketpay.com/sw.js
# Expected response headers:
# HTTP/2 200
# cache-control: no-cache, no-store, must-revalidate
# service-worker-allowed: /

# 5. API Route (must never be stored)
curl -I https://stellar-marketpay.com/api/health
# Expected response headers:
# HTTP/2 200
# cache-control: no-cache, no-store, must-revalidate
```

---

## Architecture Diagram

```
┌──────────────────┐
│   End User       │
│  (Browser)       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  CDN Edge Network (Cloudflare / Vercel)  │
│  - Static Chunks: Cache Hit (Immutable)  │
│  - HTML / APIs: Cache Bypass             │
└────────┬─────────────────────────────────┘
         │ Cache Miss / Bypass
         ▼
┌──────────────────────────────────────────┐
│  Nginx Reverse Proxy                     │
│  - HTTP/2 Multiplexing                   │
│  - Brotli / Gzip Compression             │
└────────┬─────────────────────────────────┘
         │
         ├───▶ Next.js Frontend Server
         └───▶ Express Backend Server
```
