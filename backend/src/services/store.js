/**
 * src/services/store.js
 * In-memory data store for v1.
 * Replace with a real database (PostgreSQL / Supabase) in v1.1.
 * See ROADMAP.md for the database migration plan.
 */
"use strict";

/** @type {Map<string, object>} jobId → Job */
const jobs = new Map();

/** @type {Map<string, object>} applicationId → Application */
const applications = new Map();

/** @type {Map<string, object>} publicKey → UserProfile */
const profiles = new Map();

/** @type {Map<string, object>} jobId → EscrowRecord */
const escrows = new Map();

module.exports = { jobs, applications, profiles, escrows };
