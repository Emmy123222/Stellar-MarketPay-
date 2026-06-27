"use strict";

const Queue = require("bull");

// Setup Redis connection from env, fallback to localhost
const redisConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};

// Queue for processing emails asynchronously
const emailQueue = new Queue("emailQueue", redisConfig);

module.exports = {
  emailQueue,
};
