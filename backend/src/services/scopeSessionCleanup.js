"use strict";

const pool = require("../db/pool");

/**
 * Remove collaborative scope sessions whose lease has expired.
 *
 * @param {{ log?: (message: string) => void }} [options]
 * @returns {Promise<number>} number of deleted sessions
 */
async function cleanupExpiredScopeSessions({ log = console.log } = {}) {
  const result = await pool.query(
    "DELETE FROM scope_sessions WHERE expires_at <= NOW()",
  );
  const count = Number(result.rowCount ?? result.rows?.length ?? 0);
  log(`Cleaned ${count} expired scope sessions`);
  return count;
}

module.exports = { cleanupExpiredScopeSessions };
