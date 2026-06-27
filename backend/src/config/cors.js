"use strict";

const DEFAULT_DEVELOPMENT_ORIGIN = "http://localhost:3000";

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getAllowedOrigins(env = process.env, logger = console) {
  const configuredOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (env.NODE_ENV === "production") {
    logger.warn("ALLOWED_ORIGINS is not set; denying all cross-origin requests in production");
    return [];
  }

  return [DEFAULT_DEVELOPMENT_ORIGIN];
}

function createCorsOptions({ env = process.env, logger = console } = {}) {
  const allowedOrigins = getAllowedOrigins(env, logger);

  return {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-XSRF-Token"],
    credentials: true,
  };
}

module.exports = {
  DEFAULT_DEVELOPMENT_ORIGIN,
  createCorsOptions,
  getAllowedOrigins,
  parseAllowedOrigins,
};
