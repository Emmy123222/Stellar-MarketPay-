# 🏆 Contributor Leaderboard — Issue #844

## Summary

Adds a public contributor leaderboard to the stats page that celebrates community members by ranking them according to a **contribution score**: a weighted blend of jobs completed, XLM transacted, and GitHub PRs.

### Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `GET /api/contributors` — returns top 50 contributors sorted by contribution score | ✅ |
| 2 | Contribution score = `(jobs_completed × 10) + (xlm_transacted / 100) + (github_prs × 5)` | ✅ |
| 3 | Frontend: dedicated section on `stats.tsx` page | ✅ |
| 4 | Weekly refresh semantics (1-hour cache TTL) | ✅ |
| 5 | Display: avatar (from GitHub), name, score, badge (Gold/Silver/Bronze) | ✅ |

## Changes

### Backend

#### `backend/src/routes/contributors.js` — Rewritten
- **Data sources**: GitHub API (`GET /repos/…/contributors`) + `profiles` DB table
- **Matching**: Platform profiles matched to GitHub users via `github_username` (preferred) or `display_name` (fallback); unmatched GitHub contributors included for open-source visibility
- **Score**: `jobs_completed × 10 + floor(xlm_transacted / 100) + github_prs × 5`
- **Badges**: 🥇 Gold (rank 1–3), 🥈 Silver (4–10), 🥉 Bronze (11–50)
- **Caching**: Two-tier — 1-hour TTL for merged leaderboard, 24-hour TTL for raw GitHub API data
- **Rate limiting**: 60 requests/minute via `contributorRateLimiter`
- **Refresh**: `POST /api/contributors/refresh` busts both caches
- **Shared logic**: `computeLeaderboard()` extracted to eliminate duplication between GET and POST handlers

#### `backend/src/server.js`
- Registered `contributorRoutes` at `/api/contributors`

#### `backend/src/db/migrations/V22__add_github_username` (new)
- Adds `github_username TEXT` column to `profiles` table for reliable matching
- Adds partial index `profiles_github_username_idx`

### Frontend

#### `frontend/pages/stats.tsx`
- New `Contributor` TypeScript interface
- Separate `useEffect` to fetch `/api/contributors`
- Dedicated "🏆 Contributor Leaderboard" section below existing stats
- Each row shows: medal emoji + rank number, avatar (with gradient fallback), name + badge pill, score breakdown, proportional score bar
- Loading spinner and empty state
- Expandable "How is the score calculated?" footnote
- Full dark-mode support

### Testing

#### `backend/src/routes/contributors.test.js` (new, ~250 lines)
- **Score computation**: mixed profiles, GitHub-only, zero scores
- **Badge assignment**: Gold/Silver/Bronze thresholds, rank numbers
- **Matching**: `github_username` preference, `display_name` fallback, deduplication
- **Caching**: cache hit returns stale data without re-fetching
- **Empty states**: no contributors, all-zero scores
- **Response shape**: envelope + field validation
- **Error handling**: GitHub API failure, DB failure
- **Top 50 limit**: ensures ≤50 entries returned
- **POST /refresh**: verifies cache bust + fresh data

### Score Formula

```
Contribution Score = (jobs_completed × 10) + (⌊XLM transacted / 100⌋) + (GitHub PRs × 5)
```

- **Jobs**: each completed job = 10 points
- **XLM**: every 100 XLM transacted = 1 point
- **PRs**: each GitHub pull request to the repo = 5 points
