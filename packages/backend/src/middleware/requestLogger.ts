/**
 * packages/backend/src/middleware/requestLogger.ts
 *
 * Request ID generation and structured request/response logging for Express.
 *
 * This middleware:
 *   1. Generates (or accepts) a UUID v4 `requestId` per incoming request.
 *   2. Sets the `X-Request-Id` response header so clients can correlate logs.
 *   3. Enters the AsyncLocalStorage request context so downstream code (service
 *      layer, error handlers) automatically picks up the requestId.
 *   4. Attaches a pino child logger to `req.logger` with the request context.
 *   5. Logs a `Request started` line (method, path, query, sanitized body).
 *   6. Logs a `Request completed` line (status, durationMs, requestId) on
 *      response finish.
 *
 * Usage (in app.ts):
 *   import { requestLogger } from './middleware/requestLogger';
 *   app.use(requestLogger);
 *
 * Must be mounted BEFORE other middleware that logs (after helmet/security
 * which do not log) and AFTER body-parsing middleware so the request body is
 * available for the "Request started" log line.
 *
 * Error logs automatically include `requestId` via the child logger attached
 * to `req.logger` — route-level error handlers should use `req.logger` rather
 * than the base `logger` instance.
 */

import { Request, Response, NextFunction } from 'express';
import {
  logger,
  resolveRequestId,
  sanitizeBody,
  enterRequestContext,
} from '../utils/logger';

/**
 * Express middleware that:
 *  - Resolves/injects a UUID requestId
 *  - Sets the X-Request-Id response header
 *  - Enters the ALS request context
 *  - Attaches a child logger to `req.logger`
 *  - Logs request start and completion with timing
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // 1. Resolve or mint a UUID requestId
  const requestId = resolveRequestId(req);

  // 2. Build the request context for AsyncLocalStorage
  const ctx = {
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent') as string | undefined,
    ip: req.ip,
  };

  // 3. Attach to request and response
  (req as Record<string, unknown>).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // 4. Enter ALS context so every downstream async call sees the requestId
  enterRequestContext(ctx);

  // 5. Create a child logger bound to this request
  const reqLogger = logger.child({
    requestId,
    method: req.method,
    path: req.path,
    userId: (req as any).user?.publicKey ?? (req as any).user?.walletAddress,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  (req as any).logger = reqLogger;

  const startTime = Date.now();

  // 6. Log request start (include body for mutating methods, sanitised)
  reqLogger.info({
    msg: 'Request started',
    query: req.query,
    body:
      req.method === 'POST' ||
      req.method === 'PUT' ||
      req.method === 'PATCH'
        ? sanitizeBody(req.body)
        : undefined,
  });

  // 7. Log request completion on finish
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    reqLogger.info({
      msg: 'Request completed',
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
