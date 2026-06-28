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
    try {
      await webpush.sendNotification(subscription, payload);
      successCount++;
      pushLogger.debug(`Push sent to subscription: ${subscription.endpoint.slice(0, 30)}...`);
    } catch (error) {
      failureCount++;

      // If subscription is invalid/expired, deactivate it
      if (error.statusCode === 410 || error.statusCode === 404) {
        await removeSubscription(userAddress, subscription.endpoint);
        pushLogger.debug(`Subscription expired and removed: ${subscription.endpoint.slice(0, 30)}...`);
      } else {
        pushLogger.error(`Failed to send push to ${subscription.endpoint.slice(0, 30)}...: ${error.message}`);
      }
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

module.exports = {
  saveSubscription,
  getUserSubscriptions,
  removeSubscription,
  sendPushNotification,
  broadcastPushNotification,
  getVapidPublicKey: () => vapidPublicKey,
};
