"use strict";

/**
 * src/testUtils/refreshTokenStoreFake.js
 *
 * Tiny in-memory stand-in for the `refresh_tokens` table (V58) so tests can
 * exercise services/authTokens.js without a database.
 *
 * Usage inside a jest.mock factory for "../db/pool":
 *   const { createRefreshTokenStoreFake } = require("../testUtils/refreshTokenStoreFake");
 *   const store = createRefreshTokenStoreFake();
 *   return { query: store.query, __store: store };
 *
 * Queries that do not touch refresh_tokens resolve to { rows: [] }.
 */
function createRefreshTokenStoreFake() {
  let rows = [];

  const byHash = (hash) => rows.find((r) => r.token_hash === hash);

  async function query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();

    if (/^INSERT INTO refresh_tokens/i.test(text)) {
      const [tokenHash, familyId, publicKey, payload, expiresAt] = params;
      rows.push({
        token_hash: tokenHash,
        family_id: familyId,
        public_key: publicKey,
        payload: typeof payload === "string" ? JSON.parse(payload) : payload,
        expires_at: new Date(expiresAt),
        used_at: null,
        revoked_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE refresh_tokens SET used_at = NOW\(\)/i.test(text)) {
      const row = byHash(params[0]);
      if (
        row &&
        row.used_at === null &&
        row.revoked_at === null &&
        row.expires_at.getTime() > Date.now()
      ) {
        row.used_at = new Date();
        return {
          rows: [{ family_id: row.family_id, payload: row.payload }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^SELECT family_id, used_at FROM refresh_tokens/i.test(text)) {
      const row = byHash(params[0]);
      return {
        rows: row ? [{ family_id: row.family_id, used_at: row.used_at }] : [],
      };
    }

    if (/^UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE family_id = \$1/i.test(text)) {
      const matched = rows.filter(
        (r) => r.family_id === params[0] && r.revoked_at === null,
      );
      matched.forEach((r) => {
        r.revoked_at = new Date();
      });
      return { rows: [], rowCount: matched.length };
    }

    if (/^UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE revoked_at IS NULL AND family_id = \(SELECT/i.test(text)) {
      const source = byHash(params[0]);
      const matched = source
        ? rows.filter((r) => r.family_id === source.family_id && r.revoked_at === null)
        : [];
      matched.forEach((r) => {
        r.revoked_at = new Date();
      });
      return { rows: [], rowCount: matched.length };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    query,
    findByHash: byHash,
    get rows() {
      return rows;
    },
    reset() {
      rows = [];
    },
  };
}

module.exports = { createRefreshTokenStoreFake };
