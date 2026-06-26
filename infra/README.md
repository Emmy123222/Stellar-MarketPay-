# CDN Setup Documentation

## Environment Variables
- `NEXT_PUBLIC_CDN_URL` – Base URL for static assets served via CDN.
- `IMAGE_CDN_URL` – Base URL for profile image CDN (can be same as above).

## Configuration
The Next.js configuration (`frontend/next.config.mjs`) now uses `assetPrefix` and a custom image loader that references these variables. Cache‑Control headers are added for immutable hashed assets and a shorter TTL for profile images.

## Deployment Steps
1. Deploy a CDN (e.g., Cloudflare) pointing to the Vercel/Next.js deployment.
2. Set the environment variables in your hosting platform.
3. Verify that asset URLs include the CDN prefix and that the correct `Cache‑Control` headers are present.
