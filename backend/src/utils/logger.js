/**
 * src/utils/logger.js
 * Structured logging with request IDs and context
 */
"use strict";

const pino = require("pino");
const { v4: uuidv4 } = require("uuid");

// Configure logger based on environment
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === "production"
    ? {
        // JSON format for production
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

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return uuidv4();
}

/**
 * Create a child logger with request context
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
 * Middleware to add request ID and logger to request object
 */
function requestLoggerMiddleware(req, res, next) {
  req.requestId = generateRequestId();
  req.logger = createRequestLogger(req);
  
  // Log request start
  req.logger.info({
    msg: "Request started",
    query: req.query,
    body: req.method === "POST" || req.method === "PUT" || req.method === "PATCH" 
      ? sanitizeBody(req.body) 
      : undefined,
  });

  // Track response time
  const startTime = Date.now();
  
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    req.logger.info({
      msg: "Request completed",
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

/**
 * Sanitize request body for logging (remove sensitive fields)
 */
function sanitizeBody(body) {
  if (!body || typeof body !== "object") return body;
  
  const sensitiveFields = ["password", "token", "secret", "key", "credential"];
  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }
  
  return sanitized;
}

/**
 * Log error with full context and stack trace
 */
function logError(logger, error, context = {}) {
  logger.error({
    msg: error.message || "Unknown error",
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
    },
    ...context,
  });
}

/**
 * Create service logger with service name context
 */
function createServiceLogger(serviceName) {
  return logger.child({ service: serviceName });
}

module.exports = {
  logger,
  generateRequestId,
  createRequestLogger,
  requestLoggerMiddleware,
  logError,
  createServiceLogger,
};