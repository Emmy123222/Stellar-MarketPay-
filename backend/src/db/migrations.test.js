"use strict";

const pool = require("./pool");
const {
  loadMigrationPairs,
  ensureMigrationsTable,
  rollbackLastMigration,
} = require("./migrate");

describe("Database Migrations (V1–V11)", () => {
  let hasPostgres = false;

  beforeAll(async () => {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      hasPostgres = true;
    } catch (err) {
      console.warn("PostgreSQL not available, skipping live migration tests.", err.message);
      hasPostgres = false;
    }
  });

  afterAll(async () => {
    if (hasPostgres) {
      await pool.end();
    }
  });

  it("loads all migration pairs correctly", () => {
    const migrations = loadMigrationPairs();
    expect(migrations.length).toBeGreaterThan(0);
    // Ensure V1 to V11 are present
    expect(migrations[0].version).toBe(1);
    expect(migrations[migrations.length - 1].version).toBe(11);
  });

  it("applies migrations sequentially and validates schema, foreign keys, and unique indexes after each", async () => {
    if (!hasPostgres) {
      console.log("Skipping live apply test due to no Postgres instance.");
      return;
    }

    const client = await pool.connect();
    try {
      // Start fresh
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await ensureMigrationsTable(client);

      const migrations = loadMigrationPairs();

      for (const migration of migrations) {
        // Apply migration up
        await client.query("BEGIN");
        try {
          await client.query(migration.upSql);
          await client.query(
            "INSERT INTO schema_migrations (name, version) VALUES ($1, $2)",
            [migration.name, migration.version]
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${migration.name} failed to apply: ${err.message}`);
        }

        // Validate schema: check tables exist in public schema
        const { rows: tables } = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name != 'schema_migrations'
        `);
        expect(tables.length).toBeGreaterThan(0);

        // Verify foreign key constraints
        const { rows: fks } = await client.query(`
          SELECT conname, conrelid::regclass AS table_name 
          FROM pg_constraint 
          WHERE contype = 'f'
        `);
        expect(fks).toBeDefined();
        if (migration.version >= 1) {
          expect(fks.length).toBeGreaterThan(0);
        }

        // Verify unique indexes and constraints
        const { rows: uniques } = await client.query(`
          SELECT conname AS name FROM pg_constraint WHERE contype = 'u'
          UNION
          SELECT indexname AS name FROM pg_indexes WHERE indexdef LIKE '%UNIQUE%'
        `);
        expect(uniques).toBeDefined();
        if (migration.version >= 1) {
          expect(uniques.length).toBeGreaterThan(0);
        }
      }

      // Ensure all migrations are recorded in schema_migrations
      const { rows: applied } = await client.query("SELECT name, version FROM schema_migrations");
      expect(applied.length).toBe(migrations.length);
    } finally {
      client.release();
    }
  });

  it("verifies rollback scripts (V11 → V10 → ... → V1) execute cleanly if down migrations added", async () => {
    if (!hasPostgres) {
      console.log("Skipping live rollback test due to no Postgres instance.");
      return;
    }

    const client = await pool.connect();
    try {
      const migrations = loadMigrationPairs();
      let count = migrations.length;

      while (count > 0) {
        const rolledBackVersion = await rollbackLastMigration();
        expect(rolledBackVersion).toBeDefined();
        expect(rolledBackVersion).not.toBeNull();
        count--;

        const { rows: remaining } = await client.query("SELECT name, version FROM schema_migrations");
        expect(remaining.length).toBe(count);
      }

      // After rolling back everything (V11 -> V1), public schema should have no core tables left
      const { rows: remainingTables } = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name != 'schema_migrations'
      `);
      expect(remainingTables.length).toBe(0);
    } finally {
      client.release();
    }
  });
});
