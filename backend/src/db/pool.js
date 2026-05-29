/**
 * src/db/pool.js
 * Shared PostgreSQL connection pool.
 * All services import this — never create a second Pool.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL = requireEnv("DATABASE_URL");

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Keep a modest pool; tune per deployment.
  max:             10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Enforce SSL in production but allow plain-text in local Docker.
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected pool error:", err.message);
});

module.exports = pool;
