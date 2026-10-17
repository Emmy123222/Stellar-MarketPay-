"use strict";

const Queue = require("bull");

// Setup Redis connection from env, fallback to localhost
const redisConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};

// Queue for processing emails asynchronously
const emailQueue = new Queue("emailQueue", redisConfig);

// Queue for non-blocking audit log writes
const auditQueue = new Queue("auditQueue", redisConfig);

// Queue for processing portfolio link HEAD checks asynchronously.
// We keep the connection string identical to `emailQueue` so that an
// environment redeploy only needs a single Redis URL.
const linkVerificationQueue = new Queue("linkVerificationQueue", redisConfig, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

const { recordQueueJob, setQueueDepth } = require("../metrics");

function instrumentQueue(queue, name) {
  queue.on("completed", () => {
    recordQueueJob(name, "completed");
  });
  queue.on("failed", () => {
    recordQueueJob(name, "failed");
  });
}

instrumentQueue(emailQueue, "email");
instrumentQueue(auditQueue, "audit");
instrumentQueue(linkVerificationQueue, "linkVerification");

/**
 * Poll job counts across all registered queues and update queue_depth gauges.
 */
async function refreshQueueDepths() {
  const queues = [
    { q: emailQueue, name: "email" },
    { q: auditQueue, name: "audit" },
    { q: linkVerificationQueue, name: "linkVerification" },
  ];
  for (const { q, name } of queues) {
    if (!q.client || q.client.status !== "ready") continue;
    try {
      const counts = await q.getJobCounts();
      setQueueDepth(name, "waiting", counts.waiting || 0);
      setQueueDepth(name, "active", counts.active || 0);
      setQueueDepth(name, "delayed", counts.delayed || 0);
      setQueueDepth(name, "failed", counts.failed || 0);
    } catch {
      // Non-fatal if Redis is unavailable
    }
  }
}

module.exports = {
  emailQueue,
  auditQueue,
  linkVerificationQueue,
  refreshQueueDepths,
};
