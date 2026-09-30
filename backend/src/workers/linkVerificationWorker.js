/**
 * src/workers/linkVerificationWorker.js
 *
 * Bull queue worker that HEAD-checks portfolio links and writes the
 * result back to the profile. One worker process owns this file; the
 * queue enforces retry/backoff via the defaultJobOptions set in
 * `utils/queue.js`.
 *
 * Imported once from `server.js` (and any dev/CLI bootstrap). The
 * worker registers a `process` handler at module load time so the
 * bootstrap flow remains identical to the existing email worker.
 */

"use strict";

const { linkVerificationQueue } = require("../utils/queue");
const { verifyPortfolioItem } = require("../services/linkVerificationService");
const { createServiceLogger, logError } = require("../utils/logger");

const workerLogger = createServiceLogger("link-verification-worker");

linkVerificationQueue.process(5, async (job) => {
  const { publicKey, item } = job.data || {};
  if (!publicKey || !item || !item.url || !item.type) {
    workerLogger.warn({ jobId: job.id }, "Dropping malformed job");
    throw new Error("linkVerificationQueue job missing publicKey or item.url");
  }

  try {
    const result = await verifyPortfolioItem(publicKey, item);
    return result;
  } catch (err) {
    logError(workerLogger, err, { jobId: job.id, publicKey, url: item.url });
    // Re-throw to let Bull apply backoff/retry policy.
    throw err;
  }
});

workerLogger.info("Link verification worker started listening for jobs");

module.exports = {
  linkVerificationQueue,
};
