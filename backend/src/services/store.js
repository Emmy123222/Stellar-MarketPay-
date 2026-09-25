/**
 * src/services/store.js
 * Data is now persisted in PostgreSQL.
 * This module is kept for backwards compatibility with older imports.
 */
"use strict";

// During tests we keep an in-memory store for fast, isolated unit tests.
if (process.env.NODE_ENV === 'test') {
    const jobs = new Map();
    const applications = new Map();

    module.exports = {
        jobs,
        applications,
        reset: () => {
            jobs.clear();
            applications.clear();
        },
    };
} else {
    const pool = require("../db/pool");
    module.exports = { pool };
}
