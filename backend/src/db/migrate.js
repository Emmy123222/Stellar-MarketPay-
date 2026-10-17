"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const pool = require("./pool");

const migrationsDir = path.join(__dirname, "migrations");

// Preserve already-recorded names while replacing colliding migration files.
const LEGACY_MIGRATION_NAME_ALIASES = Object.freeze({
  "V50__developer_api_keys_and_audit_trail": "V50__developer_api_keys_and_audit_trail_legacy_duplicate",
  "V22__talent_pool": "V83__talent_pool",
  "V57__account_merge": "V75__account_merge",
  "V57__application_status_history": "V60__application_status_history",
  "V57__ratings_unique_per_pair": "V76__ratings_unique_per_pair",
  "V58__messages_pagination_idx": "V77__messages_pagination_idx",
  "V58__recurring_escrow_dst": "V78__recurring_escrow_dst",
  "V58__sponsorship_credits": "V79__sponsorship_credits",
  "V59__idx_payments_created_at": "V80__idx_payments_created_at",
  "V59__job_templates": "V81__job_templates",
  "V59__stats_indexes_and_mv": "V82__stats_indexes_and_mv",
});

function parseVersion(name) {
  const m = name.match(/^V(\d+)__/i);
  return m ? Number(m[1]) : null;
}

function loadMigrationPairs() {
  const files = fs.readdirSync(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql"));

  const migrations = upFiles
    .map((upFile) => {
      const version = parseVersion(upFile);
      const downFile = upFile.replace(/\.up\.sql$/, ".down.sql");
      if (version == null || !files.includes(downFile)) return null;
      return {
        version,
        name: upFile.replace(/\.up\.sql$/, ""),
        upSql: fs.readFileSync(path.join(migrationsDir, upFile), "utf8"),
        downSql: fs.readFileSync(path.join(migrationsDir, downFile), "utf8"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));

  assertUniqueVersions(migrations);
  assertUniqueMigrationSlugs(migrations);
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

/**
 * Ensure no two migrations share the same description slug.
 * @param {Array<{name: string}>} migrations
 */
function assertUniqueMigrationSlugs(migrations) {
  const slugToName = new Map();
  for (const migration of migrations) {
    const match = migration.name.match(/^V\d+__(.+)$/i);
    const slug = match ? match[1] : migration.name;
    const existing = slugToName.get(slug);
    if (existing) {
      throw new Error(
        `Duplicate migration description "${slug}": "${existing}" and "${migration.name}"`
      );
    }
    slugToName.set(slug, migration.name);
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
      const legacyNames = Object.entries(LEGACY_MIGRATION_NAME_ALIASES)
        .filter(([, canonicalName]) => canonicalName === migration.name)
        .map(([legacyName]) => legacyName)
        .filter((legacyName) => applied.has(legacyName));

      if (applied.has(migration.name)) {
        for (const legacyName of legacyNames) {
          await client.query("DELETE FROM schema_migrations WHERE name = $1", [legacyName]);
          applied.delete(legacyName);
        }
        continue;
      }

      if (legacyNames.length > 0) {
        const [legacyName] = legacyNames;
        await client.query(
          "UPDATE schema_migrations SET name = $1, version = $2 WHERE name = $3",
          [migration.name, migration.version, legacyName]
        );
        applied.delete(legacyName);
        applied.add(migration.name);
        for (const duplicateLegacyName of legacyNames.slice(1)) {
          await client.query("DELETE FROM schema_migrations WHERE name = $1", [duplicateLegacyName]);
          applied.delete(duplicateLegacyName);
        }
        continue;
      }

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
    const migrationName = LEGACY_MIGRATION_NAME_ALIASES[last.name] || last.name;
    const downPath = path.join(migrationsDir, `${migrationName}.down.sql`);

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

if (require.main === module) {
  const mode = process.argv[2] || "up";
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

module.exports = { migrate, rollbackLastMigration, loadMigrationPairs, assertUniqueVersions, assertUniqueMigrationSlugs, ensureMigrationsTable, getAppliedMigrations, getCurrentMigrationVersion, getExpectedMigrationVersion, validateMigrationVersion };
