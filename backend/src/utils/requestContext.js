/**
 * src/utils/requestContext.js
 *
 * Per-request correlation context propagated via Node.js AsyncLocalStorage.
 *
 * Lets any code path — including service layer functions invoked from a
 * route handler — automatically pick up the current request's tracing
 * fields without having to thread `req.logger` through every signature.
 *
 * Lifecycle:
 *   1. `xRequestIdMiddleware` (in `utils/logger.js`) calls
 *      `requestContextStorage.enterWith({ requestId, ... })` so every
 *      downstream call sees the same context.
 *   2. Inside any awaited service/middleware code,
 *      `getRequestId()` / `getRequestContext()` reads the bound store.
 *   3. Once the response is sent, the per-request async context unwinds;
 *      background work that ran BEFORE the response was sent remains
 *      tagged with the originating request's id. Background work spawned
 *      later (e.g. via `setTimeout` or queue consumers) runs without any
 *      request id — except for `res.on(\"finish\")` listeners, which are
 *      intentionally still tagged.
 *
 * The store is a plain mutable object, but mutating it mid-request is
 * discouraged — prefer running a sub-context with `runWithRequestContext`
 * so concurrent log lines remain correlatable.
 */
"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

/** Single shared storage instance for request-scoped fields. */
const requestContextStorage = new AsyncLocalStorage();

/**
 * Read the current request context, or `undefined` if invoked outside a
 * request scope (e.g. cron job, queued worker, queue processor).
 *
 * @returns {{ requestId: string } & Record<string, unknown>} | undefined
 */
function getRequestContext() {
  return requestContextStorage.getStore();
}

/** Convenience: returns just the current requestId (or null outside a request). */
function getRequestId() {
  return getRequestContext()?.requestId || null;
}

/**
 * Run `fn` inside a fresh AsyncLocalStorage context seeded with `ctx`.
 * Use this for background work spawned by a request so its log lines
 * remain correlatable to the parent request.
 *
 * @template T
 * @param {Record<string, unknown>} ctx
 * @param {() => Promise<T> | T} fn
 * @returns T
 */
function runWithRequestContext(ctx, fn) {
  return requestContextStorage.run(ctx, fn);
}

/**
 * Enter the context for the rest of the current synchronous execution.
 * Express uses this so all `next()` chain awaits share the same store.
 * Do NOT call from short-lived helpers — use `runWithRequestContext`.
 *
 * @param {Record<string, unknown>} ctx
 */
function enterRequestContext(ctx) {
  requestContextStorage.enterWith(ctx);
}

/**
 * UUID v4 validator (RFC 4122 — relaxed: any version, any variant).
 * Any non-matching value is treated as untrusted and replaced with a
 * freshly generated UUID so we never propagate arbitrary attacker-supplied
 * strings into our logs/responses.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidRequestId(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Stable field names that are safe to copy from the request context to
 * every log line. Keep this list tight — adding more keys silently inflates
 * log volume across the platform.
 */
const REQUEST_CONTEXT_LOG_FIELDS = [
  "requestId",
  "userId",
  "method",
  "path",
];

/**
 * Build a Pino child-binding style object from the AsyncLocalStorage
 * store so callers can spread it into a log line. Returns {} when no
 * context is active so background jobs aren't tagged with a stale id.
 *
 * @returns {Record<string, unknown>}
 */
function pickLoggableContext() {
  const ctx = getRequestContext();
  if (!ctx) return {};
  const out = {};
  for (const key of REQUEST_CONTEXT_LOG_FIELDS) {
    if (ctx[key] !== undefined) out[key] = ctx[key];
  }
  return out;
}

module.exports = {
  requestContextStorage,
  getRequestContext,
  getRequestId,
  runWithRequestContext,
  enterRequestContext,
  isValidRequestId,
  pickLoggableContext,
  REQUEST_CONTEXT_LOG_FIELDS,
};
