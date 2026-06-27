"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("./pool");

const migrationsDir = path.join(__dirname, "migrations");

function parseVersion(name) {
  const m = name.match(/^V(\d+)__/i);
  return m ? Number(m[1]) : null;
}

function loadMigrationPairs() {
  const files = fs.readdirSync(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql"));

  return upFiles
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

module.exports = { migrate, rollbackLastMigration, loadMigrationPairs, ensureMigrationsTable, getAppliedMigrations };
