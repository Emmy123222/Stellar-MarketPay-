/**
 * src/db/migrationValidation.test.js
 *
 * Tests for database migration version validation.
 *
 * Covers:
 *   - getCurrentMigrationVersion() returns the correct version after migrations
 *   - getExpectedMigrationVersion() matches the file-system migrations
 *   - validateMigrationVersion(): matching versions pass, mismatched versions exit
 *   - Health endpoint returns migrationVersion
 */
"use strict";

const pool = require("./pool");
const {
  migrate,
  loadMigrationPairs,
  assertUniqueVersions,
  ensureMigrationsTable,
  getCurrentMigrationVersion,
  getExpectedMigrationVersion,
  validateMigrationVersion,
} = require("./migrate");

// ─── Helpers ──────────────────────────────────────────────────────────────────

let hasPostgres = false;

async function resetSchema(client) {
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await ensureMigrationsTable(client);
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    hasPostgres = true;
  } catch (err) {
    console.warn("PostgreSQL not available, skipping live migration validation tests.", err.message);
    hasPostgres = false;
  }
});

afterAll(async () => {
  if (hasPostgres) {
    await pool.end();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getExpectedMigrationVersion()", () => {
  it("returns the highest version from migration files on disk", () => {
    const version = getExpectedMigrationVersion();
    expect(version).not.toBeNull();
    expect(typeof version).toBe("number");
    // Ensure it's at least 1 (there are always base migrations)
    expect(version).toBeGreaterThanOrEqual(1);
  });

  it("is consistent with loadMigrationPairs", () => {
    const migrations = loadMigrationPairs();
    const expected = migrations.length > 0
      ? migrations[migrations.length - 1].version
      : null;
    expect(getExpectedMigrationVersion()).toBe(expected);
  });
});

describe("assertUniqueVersions()", () => {
  it("does not throw when all versions are unique", () => {
    expect(() =>
      assertUniqueVersions([
        { version: 1, name: "V1__a" },
        { version: 2, name: "V2__b" },
        { version: 3, name: "V3__c" },
      ])
    ).not.toThrow();
  });

  it("throws when two migrations share a version number", () => {
    expect(() =>
      assertUniqueVersions([
        { version: 1, name: "V1__a" },
        { version: 1, name: "V1__b" },
      ])
    ).toThrow(/Duplicate migration version V1/);
  });

  it("V6 migration prefix is used by exactly one migration (issue #1067)", () => {
    const migrations = loadMigrationPairs();
    const v6 = migrations.filter((m) => m.version === 6);
    expect(v6).toHaveLength(1);
    expect(v6[0].name).toBe("V6__private_message_nonce_unique");
  });
});

describe("getCurrentMigrationVersion()", () => {
  it("returns null when no migrations have been applied", async () => {
    if (!hasPostgres) {
      console.log("Skipping test: no Postgres instance.");
      return;
    }

    const client = await pool.connect();
    try {
      await resetSchema(client);
      const version = await getCurrentMigrationVersion();
      expect(version).toBeNull();
    } finally {
      client.release();
    }
  });

  it("returns the max version after applying migrations", async () => {
    if (!hasPostgres) {
      console.log("Skipping test: no Postgres instance.");
      return;
    }

    const client = await pool.connect();
    try {
      await resetSchema(client);
      await migrate();

      const current = await getCurrentMigrationVersion();
      const expected = getExpectedMigrationVersion();
      expect(current).toBe(expected);
    } finally {
      client.release();
    }
  });
});

describe("validateMigrationVersion()", () => {
  it("does not exit when current version matches expected version", () => {
    const originalExit = process.exit;
    const exitMock = jest.fn();
    process.exit = exitMock;

    const logger = { info: jest.fn(), fatal: jest.fn() };

    // The version in the DB matches the files on disk => no exit
    const expected = getExpectedMigrationVersion();
    validateMigrationVersion(expected, expected, logger);

    expect(exitMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { migrationVersion: expected, expectedVersion: expected },
      "Migration version check"
    );

    process.exit = originalExit;
  });

  it("calls process.exit(1) when versions do not match", () => {
    const originalExit = process.exit;
    const exitMock = jest.fn();
    process.exit = exitMock;

    const logger = { info: jest.fn(), fatal: jest.fn() };

    validateMigrationVersion(1, 99, logger);

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(logger.fatal).toHaveBeenCalledWith(
      {
        migrationVersion: 1,
        expectedVersion: 99,
      },
      "Migration version mismatch: expected 99, got 1. Exiting."
    );

    process.exit = originalExit;
  });

  it("does not exit when expectedVersion is null (no migrations on disk)", () => {
    const originalExit = process.exit;
    const exitMock = jest.fn();
    process.exit = exitMock;

    const logger = { info: jest.fn(), fatal: jest.fn() };

    // If there are no migration files, we should not force an exit
    validateMigrationVersion(null, null, logger);

    expect(exitMock).not.toHaveBeenCalled();

    process.exit = originalExit;
  });
});

describe("Health endpoint – migrationVersion field", () => {
  it("returns migrationVersion in the health response", async () => {
    const express = require("express");
    const supertest = require("supertest");
    const healthRoutes = require("../routes/health");

    const expected = getExpectedMigrationVersion();
    const app = express();
    app.locals.migrationVersion = expected;
    app.use("/health", healthRoutes);

    const res = await supertest(app).get("/health");

    // Accept any valid HTTP response (200 or 503 when dependencies are down)
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("migrationVersion");
    expect(res.body.migrationVersion).toBe(expected);
  });

  it("returns null migrationVersion when not set on app.locals", async () => {
    const express = require("express");
    const supertest = require("supertest");
    const healthRoutes = require("../routes/health");

    const app = express();
    // Do NOT set app.locals.migrationVersion
    app.use("/health", healthRoutes);

    const res = await supertest(app).get("/health");

    expect(res.body).toHaveProperty("migrationVersion");
    expect(res.body.migrationVersion).toBeNull();
  });
});
