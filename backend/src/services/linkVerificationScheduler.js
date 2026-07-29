/**
 * src/services/linkVerificationScheduler.js
 *
 * Periodic scheduler that finds portfolio items whose verification
 * timestamp is older than 7 days (or never verified at all) and pushes
 * them through the link verification queue. Uses the same setInterval
 * unref() pattern as `priceAlertService` and `savedSearchAlertService`
 * so the scheduler never blocks process exit.
 */

"use strict";

const { requeueStalePortfolioLinks, REVERIFY_AGE_DAYS } = require("./linkVerificationService");
const { createServiceLogger, logError } = require("../utils/logger");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STALE_CHECK_BATCH = 200;

const schedulerLogger = createServiceLogger("link-verification-scheduler");

let intervalHandle = null;
let startupTimeoutHandle = null;
let stopped = false;

/**
 * Run a single sweep of stale-portfolio re-verification. Designed to be
 * called both at startup and from the interval. Never throws.
 */
async function runStaleSweep() {
  try {
    const stats = await requeueStalePortfolioLinks({
      maxAgeDays: REVERIFY_AGE_DAYS,
      limit: STALE_CHECK_BATCH,
    });
    if (stats.jobsQueued > 0) {
      schedulerLogger.info(
        { profiles: stats.profiles, jobsQueued: stats.jobsQueued },
        "Re-queued stale portfolio links"
      );
    }
    return stats;
  } catch (err) {
    logError(schedulerLogger, err, { operation: "runStaleSweep" });
    return { profiles: 0, jobsQueued: 0 };
  }
}

/**
 * Start the daily scheduler. Idempotent — calling more than once is
 * safe and the previous interval handle is cleared.
 */
function startLinkVerificationScheduler() {
  if (intervalHandle) return;
  // Defensive clear: a prior stop/restart cycle could leave a pending
  // 60 s sweep timer behind; cancel it before arming a new one so
  // `stop` can never race with a stale sweep.
  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }
  stopped = false;
  schedulerLogger.info(
    { intervalMs: ONE_DAY_MS, maxAgeDays: REVERIFY_AGE_DAYS },
    "Starting portfolio link verification scheduler"
  );

  // Run once shortly after startup (give the server a moment to settle)
  // and then every 24 hours from there onward.
  startupTimeoutHandle = setTimeout(() => {
    startupTimeoutHandle = null;
    if (stopped) return;
    runStaleSweep();
  }, 60 * 1000);
  if (startupTimeoutHandle && typeof startupTimeoutHandle.unref === "function") {
    startupTimeoutHandle.unref();
  }

  intervalHandle = setInterval(() => {
    if (stopped) return;
    runStaleSweep();
  }, ONE_DAY_MS);
  if (intervalHandle && typeof intervalHandle.unref === "function") {
    intervalHandle.unref();
  }
}

/**
 * Stop the scheduler (used in tests). Safe to call repeatedly.
 */
function stopLinkVerificationScheduler() {
  stopped = true;
  // Defensive clear: if `stop` is called while the startup sweep
  // timer is still pending, ensure it doesn't fire after the next
  // start.
  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startLinkVerificationScheduler,
  stopLinkVerificationScheduler,
  runStaleSweep,
  ONE_DAY_MS,
  STALE_CHECK_BATCH,
};
