/**
 * src/services/pushSubscriptionService.js
 * Web Push notification subscription management
 */
"use strict";

const pool = require("../db/pool");
const webpush = require("web-push");
const { createServiceLogger } = require("../utils/logger");

const pushLogger = createServiceLogger("push-notifications");

// Configure Web Push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:notifications@stellar-marketpay.com",
    vapidPublicKey,
    vapidPrivateKey
  );
}

/**
 * Save a push subscription for a user
 */
async function saveSubscription(userAddress, subscription) {
  if (!userAddress || !subscription) {
    throw new Error("User address and subscription are required");
  }

  const { endpoint, keys } = subscription;
  if (!endpoint || !keys || !keys.auth || !keys.p256dh) {
    throw new Error("Invalid subscription format");
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO push_subscriptions (user_address, endpoint, auth_key, p256dh_key, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_address, endpoint)
       DO UPDATE SET is_active = true, updated_at = NOW()
       RETURNING id`,
      [userAddress, endpoint, keys.auth, keys.p256dh]
    );

    pushLogger.info(`Subscription saved for user: ${userAddress.slice(0, 8)}...`);
    return rows[0];
  } catch (error) {
    pushLogger.error(`Failed to save subscription: ${error.message}`);
    throw error;
  }
}

/**
 * Get all active subscriptions for a user
 */
async function getUserSubscriptions(userAddress) {
  try {
    const { rows } = await pool.query(
      `SELECT id, endpoint, auth_key, p256dh_key FROM push_subscriptions
       WHERE user_address = $1 AND is_active = true`,
      [userAddress]
    );

    return rows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      keys: {
        auth: row.auth_key,
        p256dh: row.p256dh_key,
      },
    }));
  } catch (error) {
    pushLogger.error(`Failed to get subscriptions for user: ${error.message}`);
    throw error;
  }
}

/**
 * Remove a push subscription
 */
async function removeSubscription(userAddress, endpoint) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE push_subscriptions SET is_active = false WHERE user_address = $1 AND endpoint = $2`,
      [userAddress, endpoint]
    );

    if (rowCount > 0) {
      pushLogger.info(`Subscription removed for user: ${userAddress.slice(0, 8)}...`);
    }

    return rowCount > 0;
  } catch (error) {
    pushLogger.error(`Failed to remove subscription: ${error.message}`);
    throw error;
  }
}

/**
 * Retry configuration for failed push deliveries (issue #1438).
 * Transient failures are retried up to 3 times with exponential backoff:
 * 1s before the 1st retry, 2s before the 2nd, 4s before the 3rd.
 */
const PUSH_MAX_RETRIES = 3;
const PUSH_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Wait for the given number of milliseconds (used between push retries)
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an error means the subscription no longer exists on the push
 * service (expired or unsubscribed endpoint). These can never succeed, so
 * they are deactivated immediately instead of retried.
 */
function isExpiredSubscriptionError(error) {
  return error?.statusCode === 410 || error?.statusCode === 404;
}

/**
 * Deliver a payload to a single subscription.
 *
 * Transient/network failures are retried up to PUSH_MAX_RETRIES times with
 * exponential backoff (1s, 2s, 4s). Expired endpoints (410/404) are not
 * retried because they can never succeed.
 *
 * @param {Object} subscription - Push subscription (id, endpoint, keys)
 * @param {string} payload - JSON payload string
 * @returns {Promise<{delivered: boolean, expired?: boolean, attempts: number, error?: Error}>}
 */
async function sendToSubscription(subscription, payload) {
  const endpointLabel = `${subscription.endpoint.slice(0, 30)}...`;
  let lastError = null;

  for (let attempt = 0; attempt <= PUSH_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(PUSH_RETRY_DELAYS_MS[attempt - 1]);
    }

    try {
      await webpush.sendNotification(subscription, payload);
      return { delivered: true, attempts: attempt + 1 };
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        return { delivered: false, expired: true, attempts: attempt + 1, error };
      }

      lastError = error;
      pushLogger.debug(
        `Push attempt ${attempt + 1}/${PUSH_MAX_RETRIES + 1} failed for ${endpointLabel}: ${error.message}`
      );
    }
  }

  return { delivered: false, attempts: PUSH_MAX_RETRIES + 1, error: lastError };
}

/**
 * Send push notification to a user
 */
async function sendPushNotification(userAddress, notification) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    pushLogger.warn("Web Push not configured (missing VAPID keys)");
    return { success: false, reason: "Push not configured" };
  }

  const subscriptions = await getUserSubscriptions(userAddress);

  if (subscriptions.length === 0) {
    pushLogger.debug(`No push subscriptions found for user: ${userAddress.slice(0, 8)}...`);
    return { success: false, reason: "No subscriptions", count: 0 };
  }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    icon: notification.icon || "/icon-192x192.png",
    badge: "/icon-96x96.png",
    tag: notification.tag || "notification",
    data: {
      linkPath: notification.linkPath || "/notifications",
      jobId: notification.jobId,
      timestamp: new Date().toISOString(),
    },
  });

  let successCount = 0;
  let failureCount = 0;

  // Send to all subscriptions in parallel
  const pushPromises = subscriptions.map(async (subscription) => {
    const endpointLabel = `${subscription.endpoint.slice(0, 30)}...`;
    const result = await sendToSubscription(subscription, payload);

    if (result.delivered) {
      successCount++;
      pushLogger.debug(`Push sent to subscription: ${endpointLabel}`);
      return;
    }

    failureCount++;

    // Expired endpoints and subscriptions that exhausted their retries are
    // marked invalid so we stop sending notifications to them. The daily
    // purge job (startPushSubscriptionPurge) removes them from the database.
    try {
      await removeSubscription(userAddress, subscription.endpoint);

      if (result.expired) {
        pushLogger.debug(`Subscription expired and removed: ${endpointLabel}`);
      } else {
        pushLogger.error(
          `Subscription marked invalid after ${result.attempts} failed attempts: ${endpointLabel}: ${result.error.message}`
        );
      }
    } catch (dbError) {
      // Never let deactivation failures break the fan-out for other subscriptions.
      pushLogger.error(`Failed to mark subscription invalid (${endpointLabel}): ${dbError.message}`);
    }
  });

  await Promise.all(pushPromises);

  return {
    success: successCount > 0,
    count: subscriptions.length,
    sent: successCount,
    failed: failureCount,
  };
}

/**
 * Send push notifications to multiple users
 */
async function broadcastPushNotification(userAddresses, notification) {
  const results = [];

  for (const userAddress of userAddresses) {
    try {
      const result = await sendPushNotification(userAddress, notification);
      results.push({ userAddress, ...result });
    } catch (error) {
      pushLogger.error(`Failed to send push to ${userAddress.slice(0, 8)}...: ${error.message}`);
      results.push({ userAddress, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Remove subscriptions marked invalid (inactive) from the database.
 * Covers subscriptions deactivated after exhausted retries, expired
 * endpoints (410/404) and user unsubscriptions.
 *
 * Runs daily via startPushSubscriptionPurge (issue #1438).
 *
 * @returns {Promise<number>} Number of subscriptions removed
 */
async function purgeInvalidSubscriptions() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM push_subscriptions WHERE is_active = false`
    );

    if (rowCount > 0) {
      pushLogger.info(`Purged ${rowCount} invalid push subscription(s)`);
    }

    return rowCount;
  } catch (error) {
    pushLogger.error(`Failed to purge invalid subscriptions: ${error.message}`);
    throw error;
  }
}

/**
 * Start a daily job that purges subscriptions marked invalid (issue #1438).
 */
function startPushSubscriptionPurge() {
  const logPurge = (label, purged) =>
    pushLogger.info(`${label} push subscription purge completed (${purged} removed)`);

  // Run immediately on startup
  purgeInvalidSubscriptions()
    .then((purged) => logPurge("Initial", purged))
    .catch((err) => pushLogger.error({ err }, "Initial push subscription purge failed"));

  // Schedule subsequent runs every 24 hours (86400000 ms)
  setInterval(() => {
    purgeInvalidSubscriptions()
      .then((purged) => logPurge("Scheduled", purged))
      .catch((err) => pushLogger.error({ err }, "Scheduled push subscription purge failed"));
  }, 24 * 60 * 60 * 1000).unref();
}

module.exports = {
  saveSubscription,
  getUserSubscriptions,
  removeSubscription,
  sendPushNotification,
  broadcastPushNotification,
  purgeInvalidSubscriptions,
  startPushSubscriptionPurge,
  getVapidPublicKey: () => vapidPublicKey,
};
