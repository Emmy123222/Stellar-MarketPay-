// src/services/wsEventCleanupService.js
"use strict";

const { cleanupOldEvents } = require("../utils/wsEventQueue");
const { createServiceLogger } = require("../utils/logger");

const cleanupLogger = createServiceLogger("ws-event-cleanup");

/** Start a daily cleanup job to purge events older than 7 days */
function startWsEventCleanup() {
  // Run immediately on startup
  cleanupOldEvents()
    .then(() => cleanupLogger.info("Initial WS event cleanup completed"))
    .catch((err) => cleanupLogger.error({ err }, "Initial WS event cleanup failed"));

  // Schedule subsequent runs every 24 hours (86400000 ms)
  setInterval(() => {
    cleanupOldEvents()
      .then(() => cleanupLogger.info("Scheduled WS event cleanup completed"))
      .catch((err) => cleanupLogger.error({ err }, "Scheduled WS event cleanup failed"));
  }, 24 * 60 * 60 * 1000).unref();
}

module.exports = { startWsEventCleanup };
