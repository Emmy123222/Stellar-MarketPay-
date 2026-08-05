## Summary

Adds request ID correlation logging to the `packages/backend/` TypeScript project. Every incoming request now receives a UUID `requestId` that is propagated through the pino logger context, set as the `X-Request-Id` response header, and logged alongside method, path, status code, and duration.

Closes #778

## Changes

### `packages/backend/src/utils/logger.ts` (new)
- Structured pino logger with `AsyncLocalStorage`-based request context propagation
- UUID v4 generation via the `uuid` package
- Accepts client-supplied `X-Request-ID` header if it's a valid UUID; otherwise mints a fresh UUID
- `createServiceLogger(name)` — service-scoped logger that lazily picks up the current ALS context at log-write time (safe to cache at module load)
- `logError(logger, err, ctx)` — enriches error logs with trace context (requestId, userId, method, path)
- Body sanitization (redacts `password`, `token`, `secret`, `key`, `credential` fields)
- UUID validation to prevent log injection from attacker-supplied headers
- Pretty-print in development, JSON in production

### `packages/backend/src/middleware/requestLogger.ts` (new)
- Express middleware resolving/injecting UUID requestId per request
- Sets `X-Request-Id` response header for client-side correlation
- Enters AsyncLocalStorage context so downstream async code sees the requestId
- Attaches a pino child logger to `req.logger` with full request context
- Logs `"Request started"` (method, path, query, sanitized body)
- Logs `"Request completed"` (statusCode, durationMs) on response finish

## Acceptance Criteria Met

- [x] Generate a UUID `requestId` per incoming request (via middleware)
- [x] Attach `requestId` to the pino logger context for each request
- [x] Add `X-Request-Id` response header
- [x] Log: method, path, status, duration, requestId for every response
- [x] Ensure error logs include the same `requestId`

## Notes

The implementation follows the same proven pattern from `backend/src/utils/logger.js` and `backend/src/utils/requestContext.js` in the main backend, adapted for TypeScript.
