/**
 * src/services/store.js
 * Data is now persisted in PostgreSQL.
 * This module is kept for backwards compatibility with older imports.
 */
"use strict";

const pool = require("../db/pool");

module.exports = { pool };
