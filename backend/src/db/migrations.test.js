"use strict";

const pool = require("./pool");
const {
  loadMigrationPairs,
  ensureMigrationsTable,
  rollbackLastMigration,
} = require("./migrate");

describe("Database Migrations (V1–V49)", () => {
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

  it("loads all migration pairs correctly with unique, increasing versions", () => {
    const migrations = loadMigrationPairs();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].version).toBe(1);

    const versions = migrations.map((m) => m.version);
    // No two migrations may share a version number (issue #1062).
    expect(new Set(versions).size).toBe(versions.length);
    // Versions must be strictly increasing so ordering is deterministic.
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }

    expect(migrations[migrations.length - 1].version).toBeGreaterThanOrEqual(22);
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
          throw new Error(`Migration ${migration.name} failed to apply: ${err.message}`, { cause: err });
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

  it("verifies rollback scripts execute cleanly for all migrations", async () => {
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

      // After rolling back everything (V49 -> V1), public schema should have no core tables left
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

  describe("Migration Status Subcommand", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const {
      getMigrationStatus,
      printMigrationStatus,
      computeChecksum,
    } = require("./migrate");

    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-status-test-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    function createMigrationFile(name, upContent, downContent = "-- down") {
      fs.writeFileSync(path.join(tempDir, `${name}.up.sql`), upContent, "utf8");
      fs.writeFileSync(path.join(tempDir, `${name}.down.sql`), downContent, "utf8");
    }

    it("lists applied and pending migrations in order", async () => {
      createMigrationFile("V1__initial", "CREATE TABLE a (id INT);");
      createMigrationFile("V2__secondary", "CREATE TABLE b (id INT);");
      createMigrationFile("V3__tertiary", "CREATE TABLE c (id INT);");

      const up1 = fs.readFileSync(path.join(tempDir, "V1__initial.up.sql"), "utf8");
      const fakeClient = {
        query: jest.fn().mockImplementation((queryText) => {
          if (queryText.includes("SELECT name, version, checksum, applied_at FROM schema_migrations")) {
            return Promise.resolve({
              rows: [
                {
                  name: "V1__initial",
                  version: 1,
                  checksum: computeChecksum(up1),
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const status = await getMigrationStatus(fakeClient, tempDir);

      expect(status.hasDuplicates).toBe(false);
      expect(status.conflicts).toHaveLength(0);

      expect(status.applied).toHaveLength(1);
      expect(status.applied[0].name).toBe("V1__initial");
      expect(status.applied[0].version).toBe(1);

      expect(status.pending).toHaveLength(2);
      expect(status.pending[0].name).toBe("V2__secondary");
      expect(status.pending[0].version).toBe(2);
      expect(status.pending[1].name).toBe("V3__tertiary");
      expect(status.pending[1].version).toBe(3);
    });

    it("detects and flags checksum mismatches between DB history and files", async () => {
      createMigrationFile("V1__initial", "CREATE TABLE a_modified (id INT);");

      const fakeClient = {
        query: jest.fn().mockImplementation((queryText) => {
          if (queryText.includes("SELECT name, version, checksum, applied_at FROM schema_migrations")) {
            return Promise.resolve({
              rows: [
                {
                  name: "V1__initial",
                  version: 1,
                  checksum: "old_different_checksum_hash_here",
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const status = await getMigrationStatus(fakeClient, tempDir);

      expect(status.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "checksum_mismatch",
            version: 1,
            name: "V1__initial",
          }),
        ])
      );
    });

    it("detects and flags name mismatches between DB history and files with the same version", async () => {
      createMigrationFile("V1__renamed_initial", "CREATE TABLE a (id INT);");

      const fakeClient = {
        query: jest.fn().mockImplementation((queryText) => {
          if (queryText.includes("SELECT name, version, checksum, applied_at FROM schema_migrations")) {
            return Promise.resolve({
              rows: [
                {
                  name: "V1__initial",
                  version: 1,
                  checksum: "some_checksum",
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const status = await getMigrationStatus(fakeClient, tempDir);

      expect(status.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "name_mismatch",
            version: 1,
            expectedName: "V1__initial",
            actualName: "V1__renamed_initial",
          }),
        ])
      );
    });

    it("detects when recorded migrations are missing entirely from disk", async () => {
      createMigrationFile("V2__other", "CREATE TABLE b (id INT);");

      const fakeClient = {
        query: jest.fn().mockImplementation((queryText) => {
          if (queryText.includes("SELECT name, version, checksum, applied_at FROM schema_migrations")) {
            return Promise.resolve({
              rows: [
                {
                  name: "V1__initial",
                  version: 1,
                  checksum: "some_checksum",
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const status = await getMigrationStatus(fakeClient, tempDir);

      expect(status.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "missing_file",
            version: 1,
            name: "V1__initial",
          }),
        ])
      );
    });

    it("flags duplicate versions on disk and sets hasDuplicates to true", async () => {
      createMigrationFile("V1__initial_a", "CREATE TABLE a (id INT);");
      createMigrationFile("V1__initial_b", "CREATE TABLE b (id INT);");

      const fakeClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };

      const status = await getMigrationStatus(fakeClient, tempDir);

      expect(status.hasDuplicates).toBe(true);
      expect(status.duplicates).toEqual([
        {
          version: 1,
          names: ["V1__initial_a", "V1__initial_b"],
        },
      ]);
      expect(status.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "duplicate_version",
            version: 1,
          }),
        ])
      );
    });

    it("printMigrationStatus prints applied, pending, duplicates, and conflicts", async () => {
      createMigrationFile("V1__initial_a", "CREATE TABLE a (id INT);");
      createMigrationFile("V1__initial_b", "CREATE TABLE b (id INT);");
      createMigrationFile("V2__pending", "CREATE TABLE c (id INT);");

      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const fakeClient = {
        query: jest.fn().mockImplementation((queryText) => {
          if (queryText.includes("SELECT name, version, checksum, applied_at FROM schema_migrations")) {
            return Promise.resolve({
              rows: [
                {
                  name: "V1__initial_a",
                  version: 1,
                  checksum: "mismatch_checksum",
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      try {
        const status = await printMigrationStatus(fakeClient, tempDir);
        expect(status.hasDuplicates).toBe(true);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Applied Migrations"));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Pending Migrations"));
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate Versions Detected"));
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Conflicts / Warnings"));
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });
});
