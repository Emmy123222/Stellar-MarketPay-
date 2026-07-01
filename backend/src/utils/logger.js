/**
 * src/utils/logger.js
 *
 * Structured logging with request IDs (#453) and trace context.
 *
 * Strategy:
 *   - `xRequestIdMiddleware` is the FIRST Express middleware (before
 *     helmet, body parser, anything). It: *   1. Accepts a vendor-supplied `X-Request-ID` if it parses as a
 *      UUID v4; otherwise mints a new UUID.
 *   2. Sets `req.requestId`.
 *   3. Sets the response header `X-Request-ID` so clients can echo it
 *      back when reporting issues.
 *   4. Calls `enterRequestContext({ requestId, ... })` so every
 *      downstream async call sees the trace via AsyncLocalStorage.
 *   Must be mounted BEFORE every downstream middleware that logs.
 *   - `requestLoggerMiddleware` runs immediately after and produces the
 *     `Request started` / `Request completed` log lines that bracket
 *     each request, attaching the requestId via the child logger.
 *   - `createServiceLogger(name)` returns a Pino child logger that
 *     lazily captures the current AsyncLocalStorage store at LOG TIME
 *     — so background work without a request scope is not tagged with
 *     a stale id, and child logger instances can be cached at module
 *     load without losing correlation.
 *   - `logError(logger, err, ctx)` augments the provided `ctx` with the
 *     trace fields so an unhandled error in a service module still
 *     includes `requestId` automatically.
 */
"use strict";

const pino = require("pino");
const { v4: uuidv4 } = require("uuid");

const {
  enterRequestContext,
  isValidRequestId,
  pickLoggableContext,
} = require("./requestContext");

// ─── Base logger ─────────────────────────────────────────────────────────────

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === "production"
    ? {
        // JSON format for production (loki / datadog / cloud logging)
        serializers: pino.stdSerializers,
      }
    : {
        // Pretty print for development
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a fresh UUID v4 correlation id.
 * @returns {string}
 */
function generateRequestId() {
  return uuidv4();
}

/**
 * Pick the request id for this request, honouring any client-supplied
 * `X-Request-ID` if it parses as a UUID v4. Otherwise mint fresh.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveRequestId(req) {
  const incoming = req.get("X-Request-ID");
  if (isValidRequestId(incoming)) return incoming;
  return generateRequestId();
}

/**
 * Sanitize request body for logging (remove sensitive fields).
 * @param {unknown} body
 */
function sanitizeBody(body) {
  if (!body || typeof body !== "object") return body;
  const sensitiveFields = ["password", "token", "secret", "key", "credential"];
  const sanitized = { ...body };
  for (const field of sensitiveFields) {
    if (sanitized[field]) sanitized[field] = "[REDACTED]";
  }
  return sanitized;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * First-pass middleware: assign / accept X-Request-ID, expose it on
 * the request, mirror it on the response, and enter the request's
 * AsyncLocalStorage scope so every downstream call sees the same id.
 */
function xRequestIdMiddleware(req, res, next) {
  const requestId = resolveRequestId(req);
  const ctx = {
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  };
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  enterRequestContext(ctx);
  next();
}

/**
 * Second-pass middleware: produce the bracketing log lines for the
 * request. The child logger here is the one most callers already
 * plumbed via `req.logger`; the AsyncLocalStorage path lets services
 * skip needing `req` entirely.
 */
function requestLoggerMiddleware(req, res, next) {
  // Assumption: `xRequestIdMiddleware` ran first and already entered the
  // ALS context. We just attach a pre-bound child logger to req for any
  // legacy code paths that still expect `req.logger`.
  const startTime = Date.now();
  const baseLogger = createRequestLogger(req);

  req.logger = baseLogger;

  baseLogger.info({
    msg: "Request started",
    query: req.query,
    body:
      req.method === "POST" ||
      req.method === "PUT" ||
      req.method === "PATCH"
        ? sanitizeBody(req.body)
        : undefined,
  });

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    baseLogger.info({
      msg: "Request completed",
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

// ─── Logger factories ────────────────────────────────────────────────────────

/**
 * Create a child logger bound to the current request (when present).
 * Always returns a fresh child so callers receive the context snapshot
 * taken at the time they ask for one.
 *
 * @param {import('express').Request} req
 */
function createRequestLogger(req) {
  const requestId = req.requestId || generateRequestId();
  req.requestId = requestId;
  return logger.child({
    requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.publicKey,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });
}

/**
 * Create a service-specific child logger that automatically picks up
 * the current AsyncLocalStorage context on every call. Safe to cache
 * at module load — the ALS lookup happens lazily via `pickLoggableContext`.
 *
 * @param {string} serviceName
 */
function createServiceLogger(serviceName) {
  return {
    service: serviceName,
    /**
     * Build a fresh Pino child at call-time so the latest request
     * context is included without needing to recreate the whole chain.
     */
    child(extra = {}) {
      return logger.child({ service: serviceName, ...extra, ...pickLoggableContext() });
    },
    // Pino-protocol proxies: each call snapshots the ALS context and
    // forwards to a fresh Pino child. Direct pino instance methods aren't
    // reusable since child() needs a fresh context lookup per call.
    trace(...args) { return this.child().trace(...args); },
    debug(...args) { return this.child().debug(...args); },
    info(...args) { return this.child().info(...args); },
    warn(...args) { return this.child().warn(...args); },
    error(...args) { return this.child().error(...args); },
    fatal(...args) { return this.child().fatal(...args); },
  };
}

// ─── Error reporting ─────────────────────────────────────────────────────────

/**
 * Log an error with full context. Merges in any active AsyncLocalStorage
 * context so service-side logs include `requestId` automatically — and
 * accepts explicit `ctx` overrides when callers want to add their own.
 *
 * @param {ReturnType<typeof createServiceLogger> | { error: Function }} loggerInstance
 * @param {Error} error
 * @param {Record<string, unknown>} ctx
 */
function logError(loggerInstance, error, context = {}) {
  const autoContext = pickLoggableContext();
  const composite = { ...autoContext, ...context };
  // Pino loggers expose `.error(obj, msg?)`; the wrapper exposes
  // `.error(msg, ...)` or `.error(obj)`. Normalise both shapes:
  if (typeof loggerInstance.error === "function") {
    loggerInstance.error({
      msg: error.message || "Unknown error",
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      },
      ...composite,
    });
    return;
  }
  // Fallback for callers that hand in the raw Pino instance.
  logger.error({
    msg: error.message || "Unknown error",
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
    },
    ...composite,
  });
}

module.exports = {
  logger,
  generateRequestId,
  resolveRequestId,
  createRequestLogger,
  createServiceLogger,
  requestLoggerMiddleware,
  xRequestIdMiddleware,
  sanitizeBody,
  logError,
};
