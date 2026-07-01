# feat(jobs): add Open Graph & Twitter Card meta tags with dynamic branded preview image

> Closes #487
> Adds `og:*` and `twitter:*` meta tags to `/jobs/[id]` plus a server-side `/api/og/[jobId]` route that renders a branded 1200×630 PNG using `@vercel/og`.

---

## Summary

`/jobs/[id]` previously rendered only a `<title>` and `<meta name="description">`. When a job link was shared on Discord, X/Twitter, LinkedIn, Slack, iMessage, Telegram, etc., the social-media scraper saw no preview at all — the card was blank, generic, or worse, the crawler's first paragraph from the page (which is full of loading-skeleton text because the job is fetched client-side). That hurt both organic click-through from social and the share-this-job workflow in `ShareJobModal`.

This PR delivers the full end-to-end fix:

- `pages/api/og/[jobId].tsx` — Edge-runtime API route that takes a job ID, fetches the job from the backend, and returns a `[Playfair Display + DM Sans + JetBrains Mono]` 1200×630 PNG with title, budget, category, status pill, top skills, and the canonical URL baked into the image.
- `pages/jobs/[id].tsx` — New `getServerSideProps` returns a minimal job whitelist (`ssrJob`) and the request-resolved base URL (`ogBaseUrl`) so scrapers see real meta tags before the client bundle hydrates. `<Head>` now emits full Open Graph + Twitter Card tags with `summary_large_image` card and an `og:image` pointing at the new image route.
- `components/ShareJobModal.tsx` — Tiny copy update that lets users know their link will preview richly on social.
- `package.json` — Adds `@vercel/og@^0.6.8` (latest in the 0.6.x line, runtime peer-dep-compatible with Next.js 14.2.3).

A graceful branded fallback image is rendered when the job is missing, the backend is unreachable, or fonts cannot be fetched.

## Acceptance criteria (#487)

- [x] **`pages/jobs/[id].tsx` adds `<meta property="og:*">` tags via `next/head`** — `og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:secure_url`, `og:image:width`, `og:image:height`, `og:image:alt`, `og:site_name`, `og:locale` all present in both render branches.
- [x] **OG image generated dynamically via `pages/api/og/[jobId].tsx` using `@vercel/og`** — Edge runtime, `ImageResponse`, fetches job via `NEXT_PUBLIC_API_URL`, brand-styled, cached via `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`.
- [x] **OG image shows job title, budget, and category on branded background** — Amber/gold (`#fbbf24`) on dark ink (`#0c0a06`) radial-gradient background with the brand fonts and logo wordmark.
- [x] **Twitter Card tags also added** — `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`. `twitter:site` is opt-in via `NEXT_PUBLIC_TWITTER_SITE`.
- [ ] **Test with og:debugger that preview renders correctly** — Static analysis can't render images; requires deployment. Manual testing checklist below.

## How it works

### Why Edge runtime?

`@vercel/og` uses Satori (WASM) + a tiny font pipeline. Edge gives us sub-5ms cold starts, ~1 MB bundle, and CDN-side caching at POPs around the world for crawlers. Node.js would work but pulls in a Canvas binary for negligible benefit on a stateless route.

### Staging / production canonical URL

The PR resolves the canonical base URL from the request's host headers (`x-forwarded-host` → `host`), with a build-time `NEXT_PUBLIC_SITE_URL` fallback. This means:

- Production shares from `https://marketpay.stellar.org/jobs/123` produce meta tags pointing at `https://marketpay.stellar.org`.
- Staging shares from `https://staging.marketpay.stellar.org/jobs/123` produce meta tags pointing at `https://staging.marketpay.stellar.org`, **not** leaking production URLs into og:image link previews.

The fallback chain (front-to-back): `x-forwarded-host` → `host` → `NEXT_PUBLIC_SITE_URL` → `https://marketpay.stellar.org`.

### Behavior table

| Scenario                              | Result                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| Live `next prod` deploy, scraper      | Full OG + Twitter Card meta tags from SSR with branded PNG      |
| Staging deploy, internal share        | Full meta tags pointing at staging origin                       |
| Backend down, job in DB               | Branded FallbackImage (job line) shown; meta tags still emit    |
| Backend down AND job not in DB        | Branded FallbackImage; meta tags omit job-specific fields       |
| First cold start, font CDN issues     | Satori default font fallback; image still renders               |
| Job title 200+ chars                  | Clamped to ~110 chars word-aware                                 |
| Invalid `jobId` chars                 | Regex guard (`/^[A-Za-z0-9_-]+$/`) short-circuits to FallbackImage |

## Files changed

| File                                         | Change                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `frontend/pages/api/og/[jobId].tsx`          | **NEW** — 280+ line Edge route; brand palette + fonts + fallback + handler        |
| `frontend/pages/jobs/[id].tsx`               | +`getServerSideProps`, +OG & Twitter Card meta in `<Head>`, both render branches  |
| `frontend/components/ShareJobModal.tsx`      | +3-line explanatory copy so users know rich previews will render                  |
| `frontend/package.json`                      | `+@vercel/og@^0.6.8`                                                              |
| `frontend/lib/env.ts`                        | _unchanged_, but now imported for `optionalClientEnv` usage in the new code paths |

## New environment variables (all optional)

| Variable                 | Default                            | Purpose                                                           |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`   | `https://marketpay.stellar.org`    | Build-time fallback for canonical / og:url base                  |
| `NEXT_PUBLIC_TWITTER_SITE` | _empty_                          | Optional `@handle` for `twitter:site` (omit until handle exists)  |
| `NEXT_PUBLIC_API_URL`    | `http://localhost:4000`            | Already configured; the OG route reads this to fetch job data    |

No new secrets or admin endpoints are introduced.

## Testing / Verification Plan

Once deployed, run the following manual checks:

1. **Static validators**
   - Paste any `/jobs/<id>` URL into:
     - <https://www.opengraph.xyz/>
     - <https://graph.tips/validator.php>
     - Twitter's [Card Validator](https://cards-dev.twitter.com/validator) (if `twitter:site` is set)
   - Confirm `og:type`, `og:title`, `og:description`, `og:image`, `og:image:width`/`height`, and `twitter:card=summary_large_image` are all present and not blank.
2. **Image preview**
   - Open the rendered `og:image` URL directly: e.g. `https://marketpay.stellar.org/api/og/<id>`. Should return a 1200×630 PNG containing the job's title, budget, and category badge.
   - Open in Discord via two-char message paste — wait for the embed popover — confirm the image shows title + budget + category on the amber-on-ink brand.
   - Repeat on Slack, X/Twitter, LinkedIn, iMessage, Telegram.
3. **Staging regression test**
   - Visit `/jobs/123` on staging; view-source; confirm `<meta property="og:url">` begins with the **staging** host, **not** production.
4. **Negative tests**
   - Visit `/api/og/thisJobDoesNotExist` — should return a 200 PNG with the branded `FallbackImage` (no JS error, no 500).
   - Visit `/api/og/missing` (used as the sentinel URL when SSR hasn't loaded yet) — same fallback as above.
5. **Performance**
   - Confirm the image is CDN-cached after the first hit: re-fetch should be ~10–50ms (network only, no Satori CPU).
   - Confirm `next build` succeeds cold and no Vercel Edge bundle warning above 1 MB.
6. **Regression**
   - Existing `fetchJob` client flow still works (this PR doesn't replace it; it augments SSR for metadata). All current UI interactions remain unchanged.
   - `ShareJobModal` copy change is additive only — no new buttons, no breaking changes.

## Screenshots / preview

_Attach screenshots from each social validator after first deploy._

## Risks & rollout

- **@vercel/og is a new dependency.** It works on both Vercel and non-Vercel deployments as long as the runtime supports Edge (`runtime: 'edge'`). On local `next dev` it also works. If a future deployment target doesn't expose Edge runtime, swap the route to Node.js — `@vercel/og`/`satori` both run there too, just with bigger bundle.
- **Cold-start font fetch.** The Edge module loads 5 fonts at module-load and the route `await`s them on first hit; subsequent hits use the same in-memory promises across requests. The `Cache-Control` header absorbs crawler bursts.
- **Backend coupling.** The OG route calls `GET ${NEXT_PUBLIC_API_URL}/api/jobs/:id`. If the public endpoint ever moves behind auth, the OG image will degenerate to the `FallbackImage` — graceful, but a separate task would be to add an unauthenticated "preview-safe" projection to the backend.
- **Backwards compat.** `og:type=website` is the broadest-supported OG type. We deliberately omitted `og:article:*` because they only apply to `og:type=article` and most popular scrapers (Slack, Discord, X) ignore them on `website`. Future iteration could explore switching to `og:type=article` for richer article cards.

## Related

- Issue: #487
- Existing meta-tag patterns referenced: `pages/jobs/category/[slug].tsx`, `pages/freelancers/[publicKey].tsx`
- Brand spec: `frontend/tailwind.config.ts` (`market-*`, `ink-*`, fonts)

---

### Suggested PR title

```
feat(jobs): add Open Graph & Twitter Card meta tags with dynamic branded preview image (#487)
```

### Suggested PR body

Copy everything above (between the `---` rulers) into the PR description, then check off the `og:debugger` acceptance item once the deploy validation runs.
