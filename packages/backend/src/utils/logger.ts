/**
 * packages/backend/src/utils/logger.ts
 *
 * Structured logging with request IDs for distributed tracing.
 *
 * Strategy:
 *   - Uses Node.js AsyncLocalStorage to propagate request context (requestId)
 *     across async boundaries without threading `req.logger` through every call.
 *   - `requestLogger` middleware (in `../middleware/requestLogger`) generates a
 *     UUID per request, sets the `X-Request-Id` response header, enters the ALS
 *     context, then logs request start/completion with method, path, status, and
 *     duration.
 *   - `createServiceLogger(name)` returns a logger wrapper that automatically
 *     picks up the current ALS context at log-write time — safe to cache at
 *     module load, no stale IDs.
 *   - `logError(logger, err, ctx)` enriches error logs with trace context.
 */

import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';

// ─── AsyncLocalStorage request context ───────────────────────────────────────

interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
  [key: string]: unknown;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Read the current request context, or `undefined` outside a request scope
 * (e.g. cron jobs, queue workers).
 */
function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/** Convenience: returns the current requestId or `null` outside a request. */
function getRequestId(): string | null {
  return getRequestContext()?.requestId ?? null;
}

/**
 * Enter a request context for the remainder of the current synchronous
 * execution. Called by the `requestLogger` middleware.
 */
function enterRequestContext(ctx: RequestContext): void {
  requestContextStorage.enterWith(ctx);
}

/**
 * Run `fn` inside a fresh AsyncLocalStorage context seeded with `ctx`.
 * Useful for background work spawned by a request so its log lines remain
 * correlatable.
 */
function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}

/**
 * UUID v4 validator (RFC 4122). Only accept properly formatted UUIDs to
 * prevent log injection from attacker-supplied `X-Request-Id` headers.
 */
function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Fields safe to copy from request context to every log line. */
const REQUEST_CONTEXT_LOG_FIELDS = ['requestId', 'userId', 'method', 'path'];

/**
 * Build a context object from the ALS store for merging into Pino child
 * loggers. Returns `{}` when no context is active so background jobs are
 * not tagged with a stale ID.
 */
function pickLoggableContext(): Record<string, unknown> {
  const ctx = getRequestContext();
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  for (const key of REQUEST_CONTEXT_LOG_FIELDS) {
    if (ctx[key] !== undefined) out[key] = ctx[key];
  }
  return out;
}

// ─── Base Pino logger ────────────────────────────────────────────────────────

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'production'
    ? {
        serializers: pino.stdSerializers,
      }
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a fresh UUID v4. */
function generateRequestId(): string {
  return uuidv4();
}

/**
 * Resolve the requestId for an incoming request. Accepts a client-supplied
 * `X-Request-ID` header if it is a valid UUID v4; otherwise creates a new one.
 */
function resolveRequestId(req: { get: (name: string) => string | undefined }): string {
  const incoming = req.get('X-Request-ID');
  if (incoming && isValidRequestId(incoming)) return incoming;
  return generateRequestId();
}

/**
 * Sanitize request body for logging by redacting sensitive fields.
 */
function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential'];
  const sanitized: Record<string, unknown> = Array.isArray(body)
    ? [...body]
    : { ...body };
  for (const field of sensitiveFields) {
    if (field in (sanitized as Record<string, unknown>)) {
      (sanitized as Record<string, unknown>)[field] = '[REDACTED]';
    }
  }
  return sanitized;
}

// ─── Logger factories ────────────────────────────────────────────────────────

/**
 * Create a Pino child logger bound to a specific request. Attaches requestId,
 * method, path, userId (when available), user-agent, and IP.
 */
function createRequestLogger(req: {
  requestId?: string;
  method: string;
  path: string;
  ip?: string;
  get: (name: string) => string | undefined;
  user?: { publicKey?: string; walletAddress?: string; [key: string]: unknown };
}): pino.Logger {
  const requestId = req.requestId || generateRequestId();
  (req as Record<string, unknown>).requestId = requestId;
  return logger.child({
    requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.publicKey ?? req.user?.walletAddress,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });
}

/**
 * Create a service-scoped logger that automatically picks up the current
 * AsyncLocalStorage context on every call. Safe to cache at module load.
 */
interface ServiceLogger {
  service: string;
  child(extra?: Record<string, unknown>): pino.Logger;
  trace(...args: any[]): void;
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  fatal(...args: any[]): void;
}

function createServiceLogger(serviceName: string): ServiceLogger {
  const child = (extra: Record<string, unknown> = {}) =>
    logger.child({ service: serviceName, ...extra, ...pickLoggableContext() });

  return {
    service: serviceName,
    child,
    trace(...args) {
      return child().trace(...args);
    },
    debug(...args) {
      return child().debug(...args);
    },
    info(...args) {
      return child().info(...args);
    },
    warn(...args) {
      return child().warn(...args);
    },
    error(...args) {
      return child().error(...args);
    },
    fatal(...args) {
      return child().fatal(...args);
    },
  };
}

// ─── Error reporting ─────────────────────────────────────────────────────────

/**
 * Log an error with full context. Merges active AsyncLocalStorage context so
 * error logs include `requestId` automatically.
 */
function logError(
  loggerInstance: pino.Logger | ServiceLogger,
  error: Error,
  context: Record<string, unknown> = {},
): void {
  const autoContext = pickLoggableContext();
  const composite = { ...autoContext, ...context };

  const errorPayload = {
    msg: error.message || 'Unknown error',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    },
    ...composite,
  };

  // pino.Logger has `.error(obj, msg?)` signature
  const logFn = (loggerInstance as pino.Logger).error ?? (loggerInstance as ServiceLogger).error;

  if (typeof logFn === 'function') {
    logFn.call(loggerInstance, errorPayload);
    return;
  }

  // Fallback: use the base logger directly
  logger.error(errorPayload);
}

export {
  logger,
  generateRequestId,
  resolveRequestId,
  isValidRequestId,
  createRequestLogger,
  createServiceLogger,
  sanitizeBody,
  logError,
  getRequestContext,
  getRequestId,
  enterRequestContext,
  runWithRequestContext,
  pickLoggableContext,
  requestContextStorage,
};

export type { RequestContext, ServiceLogger };
