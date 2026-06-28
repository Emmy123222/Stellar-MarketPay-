"use strict";

const pool = require("../db/pool");
const { createServiceLogger } = require("../utils/logger");

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const logger = createServiceLogger("idempotency");

function idempotencyMiddleware() {
  return (req, res, next) => {
    if (req.method !== "POST") return next();

    const rawKey = req.headers["idempotency-key"];
    if (!rawKey) return next();

    const key = String(rawKey).trim();
    if (!key) {
      return res.status(400).json({
        success: false,
        error: "Idempotency-Key must be a non-empty string",
      });
    }

    doIdempotency(key, req, res, next).catch((err) => {
      logger.error({ err, key }, "Idempotency middleware error, proceeding without it");
      next();
    });
  };
}

async function doIdempotency(key, req, res, next) {

  const { rows } = await pool.query(
    `INSERT INTO idempotency_keys (key, response, created_at)
     VALUES ($1, '{}'::jsonb, NOW())
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key]
  );

  if (rows.length === 0) {

    const { rows: cached } = await pool.query(
      "SELECT response, created_at FROM idempotency_keys WHERE key = $1",
      [key]
    );

    if (cached.length > 0) {
      const entry = cached[0];
      const age = Date.now() - new Date(entry.created_at).getTime();

      if (age >= IDEMPOTENCY_TTL_MS) {

        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [key]);

        await pool.query(
          `INSERT INTO idempotency_keys (key, response, created_at)
           VALUES ($1, '{}'::jsonb, NOW())
           RETURNING key`,
          [key]
        );
      } else {
        const response = entry.response;
        if (!response || typeof response.statusCode !== "number" || !response.body) {

          return res.status(409).json({
            success: false,
            error: "Request with this idempotency key is already in progress",
          });
        }

        res.set("Idempotency-Replayed", "true");
        return res.status(response.statusCode).json(response.body);
      }
    }
  }


  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      pool.query(
        `UPDATE idempotency_keys
         SET response = $1::jsonb
         WHERE key = $2`,
        [JSON.stringify({ statusCode, body }), key]
      ).catch((err) => {
        logger.error({ err, key }, "Failed to cache idempotency response");
      });
    }
    return originalJson.call(this, body);
  };

  next();
}

async function cleanupExpiredIdempotencyKeys() {
  try {
    const result = await pool.query(
      "DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'"
    );
    if (result.rowCount > 0) {
      logger.info({ deletedCount: result.rowCount }, "Cleaned up expired idempotency keys");
    }
  } catch (err) {
    logger.error({ err }, "Failed to clean up expired idempotency keys");
  }
}

module.exports = { idempotencyMiddleware, cleanupExpiredIdempotencyKeys };
