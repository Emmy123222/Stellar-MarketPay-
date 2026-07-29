"use strict";

const Queue = require("bull");

// Setup Redis connection from env, fallback to localhost
const redisConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};

// Queue for processing emails asynchronously
const emailQueue = new Queue("emailQueue", redisConfig);

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

module.exports = {
  emailQueue,
  linkVerificationQueue,
};
