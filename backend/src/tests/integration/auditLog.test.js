/**
 * Integration tests for the audit_log table (V22 Issue #826)
 *
 * Tests the auditLogService directly with a real PostgreSQL connection.
 * Does NOT import the Express server to avoid bootstrap dependencies.
 *
 * Uses a real PostgreSQL instance (DATABASE_URL).
 * Transactions are rolled back between tests for isolation.
 */

"use strict";

const { Pool } = require("pg");
const { insertAuditLog, listAuditLogs } = require("../../services/auditLogService");

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/postgres";

let pool;
let hasPostgres = false;

beforeAll(async () => {
  try {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    hasPostgres = true;

    // Ensure the audit_log table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_address   TEXT        NOT NULL,
        action          TEXT        NOT NULL,
        entity_type     TEXT        NOT NULL,
        entity_id       TEXT        NOT NULL,
        old_value       JSONB,
        new_value       JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn("PostgreSQL not available, skipping live audit log integration tests.", err.message);
    hasPostgres = false;
  }
});

afterAll(async () => {
  if (hasPostgres && pool) await pool.end();
});

const actorAddress = "GAUDITTEST123456789012345678901234567890123456789012345678901234";

// NOTE: The service queries go through the shared pool, so a BEGIN/ROLLBACK
// pattern that releases its client between hooks cannot isolate tests —
// inserts land on arbitrary pooled connections (some outside the open
// transaction) and leak across tests non-deterministically. Other suites
// hitting the real API also persist audit rows in this shared database
// (e.g. job creation), so clear the whole table before each test; list
// filters are not actor-scoped and count exact matches.
beforeEach(async () => {
  if (!hasPostgres) return;
  await pool.query("DELETE FROM audit_log");
});

describe("Audit Log Integration Tests", () => {
  beforeAll(() => {
    if (!hasPostgres) {
      console.log("Skipping audit log integration tests — no Postgres instance.");
    }
  });
  const entityId = "00000000-0000-0000-0000-000000000001";

  test("insertAuditLog creates a row with correct fields", async () => {
    if (!hasPostgres) return;
    const entry = await insertAuditLog({
      actorAddress,
      action: "test_action",
      entityType: "test_entity",
      entityId,
      oldValue: { status: "old_status" },
      newValue: { status: "new_status" },
    });

    expect(entry).toBeDefined();
    expect(entry.id).toBeDefined();
    expect(entry.actor_address).toBe(actorAddress);
    expect(entry.action).toBe("test_action");
    expect(entry.entity_type).toBe("test_entity");
    expect(entry.entity_id).toBe(entityId);
    expect(entry.old_value).toEqual({ status: "old_status" });
    expect(entry.new_value).toEqual({ status: "new_status" });
    expect(entry.created_at).toBeDefined();

    // Verify row exists in DB
    const { rows } = await pool.query(
      "SELECT * FROM audit_log WHERE id = $1",
      [entry.id],
    );
    expect(rows.length).toBe(1);
  });

  test("insertAuditLog accepts null old_value and new_value", async () => {
    if (!hasPostgres) return;
    const entry = await insertAuditLog({
      actorAddress,
      action: "system_event",
      entityType: "system",
      entityId: "boot-1",
    });

    expect(entry).toBeDefined();
    expect(entry.old_value).toBeNull();
    expect(entry.new_value).toBeNull();
  });

  test("listAuditLogs returns entries ordered by created_at DESC", async () => {
    if (!hasPostgres) return;
    await insertAuditLog({
      actorAddress,
      action: "first",
      entityType: "test",
      entityId,
    });
    await insertAuditLog({
      actorAddress,
      action: "second",
      entityType: "test",
      entityId,
    });

    const { rows } = await listAuditLogs({ limit: 10 });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Most recent entry should be first
    expect(new Date(rows[0].created_at).getTime())
      .toBeGreaterThanOrEqual(new Date(rows[1].created_at).getTime());
  });

  test("listAuditLogs filters by entity_type, entity_id, and action", async () => {
    if (!hasPostgres) return;
    await insertAuditLog({
      actorAddress,
      action: "job_status_change",
      entityType: "job",
      entityId: "job-1",
      newValue: { status: "completed" },
    });
    await insertAuditLog({
      actorAddress,
      action: "escrow_release",
      entityType: "escrow",
      entityId: "escrow-1",
    });

    // Filter by entity_type
    const jobEntries = await listAuditLogs({ entityType: "job" });
    expect(jobEntries.rows.length).toBe(1);
    expect(jobEntries.rows[0].entity_type).toBe("job");

    // Filter by action
    const escrowEntries = await listAuditLogs({ action: "escrow_release" });
    expect(escrowEntries.rows.length).toBe(1);
    expect(escrowEntries.rows[0].action).toBe("escrow_release");
  });

  test("listAuditLogs paginates with cursor", async () => {
    if (!hasPostgres) return;
    // Insert 3 entries
    for (let i = 0; i < 3; i++) {
      await insertAuditLog({
        actorAddress,
        action: `page_test_${i}`,
        entityType: "test",
        entityId,
      });
    }

    // Fetch with limit 2
    const page1 = await listAuditLogs({ limit: 2 });
    expect(page1.rows.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    // Fetch next page
    const page2 = await listAuditLogs({ limit: 2, after: page1.nextCursor });
    expect(page2.rows.length).toBeGreaterThanOrEqual(1);

    // No duplicate entries across pages
    const page1Ids = new Set(page1.rows.map((r) => r.id));
    for (const row of page2.rows) {
      expect(page1Ids.has(row.id)).toBe(false);
    }
  });

  test("audit_log service never issues UPDATE or DELETE (append-only by convention)", () => {
    // Verify the auditLogService only exposes insert/list, never update/delete
    const serviceExports = Object.keys(require("../../services/auditLogService"));
    expect(serviceExports).toEqual(["insertAuditLog", "listAuditLogs"]);
    expect(serviceExports).not.toContain("updateAuditLog");
    expect(serviceExports).not.toContain("deleteAuditLog");

    // Also verify that the service code never contains UPDATE or DELETE queries
    const source = require("fs").readFileSync(
      require.resolve("../../services/auditLogService"),
      "utf8",
    );
    expect(source.includes("UPDATE ")).toBe(false);
    expect(source.includes("DELETE ")).toBe(false);
  });
});
