## Description

Surfaces live backend and indexer health on the public status page. The page now shows API, database, Redis, indexer lag, and WebSocket connectivity with last-checked times, automatic refresh, degraded-state messaging, and graceful rendering when services are unavailable.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Files Modified

- `backend/src/server.js` — adds current-ledger data and a bounded timeout to indexer health.
- `backend/src/tests/contract/api.contract.test.js` — adds indexer health endpoint coverage.
- `frontend/pages/status.tsx` — adds live SWR status tiles, lag warnings, and WebSocket monitoring.
- `frontend/lib/api/health.ts` — aligns health response types and handles degraded HTTP responses.
- `frontend/components/DegradedStatusBanner.tsx` — adds a reusable degraded-state banner.
- `frontend/__tests__/status.page.test.tsx` — tests healthy, degraded, lag-warning, and API-unavailable states.
- `frontend/__tests__/page-accessibility.test.tsx` — updates status page API mocks.

## Testing

- [x] Tested locally — focused frontend status and accessibility tests passed (9 tests).
- [x] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes) — not applicable.

## Code Quality checks

- Backend syntax check and lint passed with no errors; `git diff --check` passed.
- Frontend type diagnostics for edited files report no errors.

## Behavioural Changes

- API health checks returning HTTP 503 remain readable so the page can show component-level degraded health.
- Indexer health reports current ledger with a two-second timeout; failed checks return a degraded response.
- Indexer lag above five ledgers displays a warning.
- The status page polls every 60 seconds and checks WebSocket connectivity with automatic reconnection.

## Tests Errors

- Backend contract tests could not run because the pre-existing `backend/src/routes/jobs.js` file contains an invalid `Jobs · JS` line, and the full frontend TypeScript check reports parse errors in unrelated existing files.
- Frontend ESLint is blocked by a pre-existing circular ESLint configuration error.

Closes #1898
