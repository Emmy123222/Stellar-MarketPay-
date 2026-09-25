# Security Header Policy

Stellar MarketPay aims for an **A rating** on [securityheaders.com](https://securityheaders.com). This document describes the security headers we set, where they are configured, and how to verify them.

## Required Headers

The following headers must be present on every HTTP response served by the application:

| Header | Value | Purpose |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforces HTTPS for one year, includes subdomains, and opts into HSTS preload. |
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing responses into unintended content types. |
| `X-Frame-Options` | `SAMEORIGIN` | Allows the page to be framed only by the same origin, mitigating clickjacking. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Sends the full referrer on same-origin requests and only the origin on cross-origin requests. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()` | Disables access to sensitive browser features and interest-cohort tracking. |

In addition, a `Content-Security-Policy` is also configured to mitigate XSS and data injection attacks.

## Where Headers Are Configured

Headers are configured at three layers for defense-in-depth:

### 1. Next.js Frontend

- **Static/default headers**: `frontend/next.config.mjs` applies the security headers to all routes via the `headers()` configuration.
- **Runtime CSP with nonce**: `frontend/middleware.ts` sets a per-request `Content-Security-Policy` header with a random nonce for inline script protection.
- **Shared CSP directives**: `frontend/lib/csp.ts` contains the canonical CSP directives used by both the middleware and the Next.js config.

### 2. Express Backend

- `backend/src/server.js` uses [Helmet](https://helmetjs.github.io/) to set security headers on all API responses, including HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy.

### 3. Nginx Reverse Proxy

- `infra/nginx.conf` adds the same headers on the edge for all responses served through Nginx. This ensures the headers are present even if an upstream service omits them.

## Verification

### Local Check

Start the frontend and run the helper script from the repository root:

```bash
./scripts/check-security-headers.sh http://localhost:3000
```

You can also check any deployed URL:

```bash
./scripts/check-security-headers.sh https://stellar-marketpay.com
```

### CI Check

The GitHub Actions workflow in `.github/workflows/security-headers.yml` builds the frontend, starts the production server, and runs the curl-based header check on every push and pull request to `main`.

## Notes

- The `preload` directive in `Strict-Transport-Security` signals intent to be included in browser HSTS preload lists. Submit the domain to [hstspreload.org](https://hstspreload.org) once this header is live in production.
- `X-XSS-Protection` is retained in the Nginx configuration for legacy browser support but is not required for an A rating.
- If the application needs to embed third-party content via iframes or allow camera/microphone access in the future, update the `Permissions-Policy` and `frame-src` CSP directive accordingly, and document the change here.
