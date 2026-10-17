/**
 * src/services/auditLogService.js
 *
 * Append-only audit trail for all state-changing operations.
 * Every mutation (job status change, escrow release, dispute filing, etc.)
 * should be recorded with before/after snapshots so that any change can be
 * traced back to the actor and the exact state diff.
 *
 * The `audit_log` table is never updated or deleted — this service must
 * only ever call INSERT.
 */
"use strict";

const pool = require("../db/pool");
const metrics = require("../metrics");

/**
 * Record a state-changing operation in the audit log.
 *
 * @param {Object} params
 * @param {string} params.actorAddress  - Stellar public key of the actor.
 * @param {string} params.action        - Machine-readable action name (e.g. "job_status_change", "escrow_release").
 * @param {string} params.entityType    - Type of entity that changed (e.g. "job", "escrow", "dispute").
 * @param {string} params.entityId      - Unique identifier of the entity (e.g. job UUID).
 * @param {Object|null} [params.oldValue]  - Snapshot of the entity BEFORE the change (JSON-serialisable).
 * @param {Object|null} [params.newValue]  - Snapshot of the entity AFTER  the change (JSON-serialisable).
 * @returns {Promise<Object>} The inserted audit_log row.
 */
async function insertAuditLog({ actorAddress, action, entityType, entityId, oldValue, newValue }) {
  const { rows } = await pool.query(
    `INSERT INTO audit_log (actor_address, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
     RETURNING *`,
    [
      actorAddress,
      action,
      entityType,
      entityId,
      oldValue != null ? JSON.stringify(oldValue) : null,
      newValue != null ? JSON.stringify(newValue) : null,
    ],
  );
  return rows[0];
}

/**
 * Record an escrow on-chain/off-chain reconciliation mismatch.
 *
 * Writes an append-only audit entry describing the divergence between the
 * PostgreSQL copy of escrow state and the authoritative Soroban contract
 * state, and increments the Prometheus mismatch counter so the event is
 * alertable. This is called from escrowService before sensitive transitions
 * (release, refund, dispute open) when the cross-check fails.
 *
 * @param {Object} params
 * @param {string} params.actorAddress - Stellar public key of the actor (or "system").
 * @param {string} params.escrowId     - Escrow identifier that desynced.
 * @param {string} params.transition   - Sensitive transition being attempted (e.g. "release").
 * @param {Object|null} [params.dbState]     - Escrow state as stored in PostgreSQL.
 * @param {Object|null} [params.chainState]  - Escrow state read from the Soroban contract.
 * @param {string[]} [params.mismatches]     - List of field names that diverged.
 * @returns {Promise<Object>} The inserted audit_log row.
 */
async function recordEscrowMismatch({
  actorAddress,
  escrowId,
  transition,
  dbState,
  chainState,
  mismatches,
}) {
  if (typeof metrics.incrementEscrowMismatch === "function") {
    metrics.incrementEscrowMismatch({ transition });
  }

  return insertAuditLog({
    actorAddress: actorAddress || "system",
    action: "escrow_state_mismatch",
    entityType: "escrow",
    entityId: escrowId,
    oldValue: dbState != null ? { source: "db", state: dbState } : null,
    newValue:
      chainState != null || mismatches != null
        ? {
            source: "chain",
            state: chainState != null ? chainState : null,
            transition,
            mismatches: mismatches || [],
          }
        : null,
  });
}

/**
 * Fetch audit log entries with cursor-based pagination (admin use).
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=50]   - Max rows to return (cap 200).
 * @param {string} [opts.after]      - Opaque base64 cursor for the next page.
 * @param {string} [opts.entityType] - Optional filter by entity type.
 * @param {string} [opts.entityId]   - Optional filter by entity id.
 * @param {string} [opts.action]     - Optional filter by action name.
 * @returns {Promise<{ rows: Object[], nextCursor: string|null }>}
 */
async function listAuditLogs({ limit = 50, after, entityType, entityId, action } = {}) {
  const maxLimit = Math.min(parseInt(limit, 10) || 50, 200);
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (entityType) {
    conditions.push(`entity_type = $${paramIdx++}`);
    params.push(entityType);
  }
  if (entityId) {
    conditions.push(`entity_id = $${paramIdx++}`);
    params.push(entityId);
  }
  if (action) {
    conditions.push(`action = $${paramIdx++}`);
    params.push(action);
  }

  // Cursor pagination: `after` is base64-encoded `created_at|id`. We only
  // decode it to recover the opaque boundary id; the timestamp part is no
  // longer compared directly. Comparing against a reconstructed string would
  // truncate the microsecond component (Date#toISOString -> ms), so rows
  // sharing the boundary's millisecond would silently drop out of the next
  // page. Instead the boundary row is re-fetched by its primary key and the
  // exact (created_at, id) pair is compared as a PostgreSQL row value, which
  // preserves full timestamp precision and stays a total order across pages.
  if (after) {
    try {
      const decoded = Buffer.from(after, "base64").toString("utf8");
      const [, cursorId] = decoded.split("|");
      if (cursorId) {
        const boundaryParam = `$${paramIdx++}`;
        conditions.push(
          `(created_at, id) < (SELECT created_at, id FROM audit_log WHERE id = ${boundaryParam})`,
        );
        params.push(cursorId);
      }
    } catch {
      throw Object.assign(new Error("Invalid cursor"), { status: 400 });
    }
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const { rows } = await pool.query(
    `SELECT id, actor_address, action, entity_type, entity_id,
            old_value, new_value, created_at
     FROM audit_log
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${paramIdx}`,
    [...params, maxLimit],
  );

  let nextCursor = null;
  if (rows.length === maxLimit) {
    const last = rows[rows.length - 1];
    nextCursor = Buffer.from(
      `${last.created_at.toISOString?.() || last.created_at}|${last.id}`,
    ).toString("base64");
  }

  return { rows, nextCursor };
}

module.exports = {
  insertAuditLog,
  listAuditLogs,
  recordEscrowMismatch,
};
