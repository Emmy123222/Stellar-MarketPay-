// src/services/invitationCleanupService.js
"use strict";

const { purgeExpiredInvitations } = require("./jobInvitationService");
const { createServiceLogger } = require("../utils/logger");

const cleanupLogger = createServiceLogger("invitation-cleanup");

/** Start a daily cleanup job to purge expired and accepted/declined invitations */
function startInvitationCleanup() {
  purgeExpiredInvitations()
    .then((count) => cleanupLogger.info({ count }, "Initial invitation cleanup completed"))
    .catch((err) => cleanupLogger.error({ err }, "Initial invitation cleanup failed"));

  setInterval(() => {
    purgeExpiredInvitations()
      .then((count) => cleanupLogger.info({ count }, "Scheduled invitation cleanup completed"))
      .catch((err) => cleanupLogger.error({ err }, "Scheduled invitation cleanup failed"));
  }, 24 * 60 * 60 * 1000).unref();
}

module.exports = { startInvitationCleanup };
