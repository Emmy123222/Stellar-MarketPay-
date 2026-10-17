"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const pool = require("./pool");

const migrationsDir = path.join(__dirname, "migrations");

const crypto = require("crypto");

function computeChecksum(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function parseVersion(name) {
  const m = name.match(/^V(\d+)__/i);
  return m ? Number(m[1]) : null;
}

function loadMigrationFiles(customMigrationsDir = migrationsDir) {
  const files = fs.readdirSync(customMigrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql"));

  return upFiles
    .map((upFile) => {
      const version = parseVersion(upFile);
      const downFile = upFile.replace(/\.up\.sql$/, ".down.sql");
      if (version == null || !files.includes(downFile)) return null;
      const upSql = fs.readFileSync(path.join(customMigrationsDir, upFile), "utf8");
      const downSql = fs.readFileSync(path.join(customMigrationsDir, downFile), "utf8");
      return {
        version,
        name: upFile.replace(/\.up\.sql$/, ""),
        upFile,
        downFile,
        upSql,
        downSql,
        checksum: computeChecksum(upSql),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
}

function loadMigrationPairs() {
  const migrations = loadMigrationFiles();
  assertUniqueVersions(migrations);
  return migrations;
}

/**
 * Ensure no two migrations share the same version number. A collision makes the
 * `MAX(version)` progress check and the `version`-then-`name` sort
 * non-deterministic, so this must fail fast before any migration runs.
 *
 * @param {Array<{version: number, name: string}>} migrations
 */
function assertUniqueVersions(migrations) {
  const versionToName = new Map();
  for (const migration of migrations) {
    const existing = versionToName.get(migration.version);
    if (existing) {
      throw new Error(
        `Duplicate migration version V${migration.version}: "${existing}" and "${migration.name}"`
      );
    }
    versionToName.set(migration.version, migration.name);
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS checksum TEXT
  `);
}

async function getMigrationHistory(client) {
  const { rows } = await client.query(
    "SELECT name, version, checksum, applied_at FROM schema_migrations ORDER BY applied_at ASC, version ASC, name ASC"
  );
  return rows;
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  return new Set(rows.map((r) => r.name));
}

/**
 * Query the current (highest) migration version applied in the database.
 * @returns {Promise<number|null>} The max version from schema_migrations, or null if none applied.
 */
async function getCurrentMigrationVersion() {
  const { rows } = await pool.query("SELECT MAX(version)::int AS version FROM schema_migrations");
  return rows[0]?.version ?? null;
}

/**
 * Determine the expected (highest) migration version from the files on disk.
 * @returns {number|null} The max version among migration files, or null if none exist.
 */
function getExpectedMigrationVersion() {
  const migrations = loadMigrationPairs();
  if (migrations.length === 0) return null;
  return migrations[migrations.length - 1].version;
}

/**
 * Validate that the database migration version matches the expected version.
 * Logs the current version at INFO level. If versions differ, logs a FATAL
 * error and calls process.exit(1).
 *
 * @param {number|null} currentVersion - Version from schema_migrations
 * @param {number|null} expectedVersion - Highest version found on disk
 * @param {object} logger - A service logger (e.g. from createServiceLogger)
 */
function validateMigrationVersion(currentVersion, expectedVersion, logger) {
  logger.info({ migrationVersion: currentVersion, expectedVersion }, 'Migration version check');

  if (expectedVersion !== null && currentVersion !== expectedVersion) {
    logger.fatal({
      migrationVersion: currentVersion,
      expectedVersion,
    }, `Migration version mismatch: expected ${expectedVersion}, got ${currentVersion}. Exiting.`);
    process.exit(1);
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = loadMigrationPairs();
    const applied = await getAppliedMigrations(client);

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      await client.query("BEGIN");
      try {
        await client.query(migration.upSql);
        await client.query(
          "INSERT INTO schema_migrations (name, version, checksum) VALUES ($1, $2, $3)",
          [migration.name, migration.version, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

async function rollbackLastMigration() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      "SELECT version, name FROM schema_migrations ORDER BY applied_at DESC, version DESC, name DESC LIMIT 1"
    );

    if (!rows.length) return null;
    const last = rows[0];
    const downPath = path.join(migrationsDir, `${last.name}.down.sql`);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Rollback file missing for migration ${last.name}`);
    }

    const downSql = fs.readFileSync(downPath, "utf8");

    await client.query("BEGIN");
    try {
      await client.query(downSql);
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [last.name]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    return Number(last.version);
  } finally {
    client.release();
  }
}

/**
 * Compare database migration history with migration files on disk.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} [customMigrationsDir]
 * @returns {Promise<{
 *   applied: Array<{ version: number, name: string, applied_at: Date, checksum: string|null }>,
 *   pending: Array<{ version: number, name: string, checksum: string }>,
 *   conflicts: Array<{ type: 'checksum_mismatch'|'missing_file'|'duplicate_version', version: number, name: string, [key: string]: any }>,
 *   duplicates: Array<{ version: number, names: string[] }>,
 *   hasDuplicates: boolean
 * }>}
 */
async function getMigrationStatus(client, customMigrationsDir = migrationsDir) {
  await ensureMigrationsTable(client);
  const history = await getMigrationHistory(client);

  const files = loadMigrationFiles(customMigrationsDir);

  // Group by version to detect duplicates
  const versionMap = new Map();
  for (const m of files) {
    if (!versionMap.has(m.version)) {
      versionMap.set(m.version, []);
    }
    versionMap.get(m.version).push(m);
  }

  const duplicates = [];
  for (const [version, group] of versionMap.entries()) {
    if (group.length > 1) {
      duplicates.push({
        version,
        names: group.map((m) => m.name),
      });
    }
  }

  const conflicts = [];

  // Flag duplicate versions in conflicts
  for (const dup of duplicates) {
    for (const name of dup.names) {
      conflicts.push({
        type: "duplicate_version",
        version: dup.version,
        name,
        conflictingNames: dup.names.filter((n) => n !== name),
        message: `Duplicate version V${dup.version} detected on disk: ${dup.names.join(", ")}`,
      });
    }
  }

  const historyByName = new Map();
  const historyByVersion = new Map();
  for (const row of history) {
    historyByName.set(row.name, row);
    historyByVersion.set(row.version, row);
  }

  const filesByName = new Map();
  for (const file of files) {
    filesByName.set(file.name, file);
  }

  // Check recorded history against files
  for (const record of history) {
    const file = filesByName.get(record.name);
    if (!file) {
      // Check if maybe there is a file with the same version but different name
      const sameVersionFile = files.find((f) => f.version === record.version);
      if (sameVersionFile) {
        conflicts.push({
          type: "name_mismatch",
          version: record.version,
          name: record.name,
          expectedName: record.name,
          actualName: sameVersionFile.name,
          message: `Name mismatch for V${record.version}: recorded as "${record.name}" in DB, but file on disk is "${sameVersionFile.name}"`,
        });
      } else {
        conflicts.push({
          type: "missing_file",
          version: record.version,
          name: record.name,
          message: `Recorded migration "${record.name}" (V${record.version}) is missing from disk`,
        });
      }
    } else {
      // File exists, check checksum if recorded
      if (record.checksum && record.checksum !== file.checksum) {
        conflicts.push({
          type: "checksum_mismatch",
          version: record.version,
          name: record.name,
          recordedChecksum: record.checksum,
          fileChecksum: file.checksum,
          message: `Checksum mismatch for "${record.name}": DB recorded ${record.checksum.slice(0, 8)}, but file checksum is ${file.checksum.slice(0, 8)}`,
        });
      }
    }
  }

  const applied = history.map((row) => ({
    version: row.version,
    name: row.name,
    applied_at: row.applied_at,
    checksum: row.checksum,
  }));

  const pending = [];
  for (const file of files) {
    if (!historyByName.has(file.name)) {
      pending.push({
        version: file.version,
        name: file.name,
        checksum: file.checksum,
      });
    }
  }

  return {
    applied,
    pending,
    conflicts,
    duplicates,
    hasDuplicates: duplicates.length > 0,
  };
}

async function printMigrationStatus(client, customMigrationsDir = migrationsDir) {
  const status = await getMigrationStatus(client, customMigrationsDir);

  console.log("=== Database Migration Status ===\n");

  console.log(`Applied Migrations (${status.applied.length}):`);
  if (status.applied.length === 0) {
    console.log("  (none)");
  } else {
    for (const app of status.applied) {
      const dateStr = app.applied_at ? new Date(app.applied_at).toISOString() : "unknown";
      const cs = app.checksum ? ` [checksum: ${app.checksum.slice(0, 8)}]` : "";
      console.log(`  [x] V${app.version} ${app.name} (applied: ${dateStr})${cs}`);
    }
  }
  console.log("");

  console.log(`Pending Migrations (${status.pending.length}):`);
  if (status.pending.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of status.pending) {
      console.log(`  [ ] V${p.version} ${p.name} [checksum: ${p.checksum.slice(0, 8)}]`);
    }
  }
  console.log("");

  if (status.duplicates.length > 0) {
    console.error(`Duplicate Versions Detected (${status.duplicates.length}):`);
    for (const dup of status.duplicates) {
      console.error(`  [!] V${dup.version}: ${dup.names.join(", ")}`);
    }
    console.log("");
  }

  if (status.conflicts.length > 0) {
    console.error(`Conflicts / Warnings (${status.conflicts.length}):`);
    for (const conflict of status.conflicts) {
      console.error(`  [!] ${conflict.message}`);
    }
    console.log("");
  }

  return status;
}

if (require.main === module) {
  const mode = process.argv[2] || "up";

  if (mode === "status") {
    pool.connect()
      .then(async (client) => {
        try {
          const status = await printMigrationStatus(client);
          if (status.hasDuplicates) {
            process.exit(1);
          }
          process.exit(0);
        } finally {
          client.release();
        }
      })
      .catch((err) => {
        console.error("Failed to check migration status:", err.message);
        process.exit(1);
      });
  } else {
    const run = mode === "down" ? rollbackLastMigration : migrate;

    run()
      .then((result) => {
        if (mode === "down") {
          console.log(result == null ? "No migrations to rollback" : `Rolled back V${result}`);
        } else {
          console.log("Migrations complete");
        }
        process.exit(0);
      })
      .catch((err) => {
        console.error(err.message);
        process.exit(1);
      });
  }
}

module.exports = {
  migrate,
  rollbackLastMigration,
  loadMigrationFiles,
  loadMigrationPairs,
  assertUniqueVersions,
  ensureMigrationsTable,
  getMigrationHistory,
  getMigrationStatus,
  printMigrationStatus,
  computeChecksum,
  getAppliedMigrations,
  getCurrentMigrationVersion,
  getExpectedMigrationVersion,
  validateMigrationVersion,
};
