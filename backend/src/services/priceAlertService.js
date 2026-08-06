"use strict";

const pool = require("../db/pool");
const { createInAppNotification } = require("./notificationService");

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const ALERT_COOLDOWN_SQL = "INTERVAL '1 hour'";

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

async function upsertPriceAlertPreference({
  freelancerAddress,
  minXlmPriceUsd,
  maxXlmPriceUsd,
  emailNotificationsEnabled,
  email,
}) {
  validatePublicKey(freelancerAddress);
  const min = minXlmPriceUsd == null || minXlmPriceUsd === "" ? null : Number(minXlmPriceUsd);
  const max = maxXlmPriceUsd == null || maxXlmPriceUsd === "" ? null : Number(maxXlmPriceUsd);
  if (min !== null && Number.isNaN(min)) throwBadRequest("minXlmPriceUsd must be a number");
  if (max !== null && Number.isNaN(max)) throwBadRequest("maxXlmPriceUsd must be a number");
  if (min !== null && max !== null && min > max) throwBadRequest("minXlmPriceUsd must be less than maxXlmPriceUsd");

  const { rows } = await pool.query(
    `INSERT INTO price_alert_preferences (
      freelancer_address, min_xlm_price_usd, max_xlm_price_usd, email_notifications_enabled, email, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (freelancer_address) DO UPDATE
      SET min_xlm_price_usd = EXCLUDED.min_xlm_price_usd,
          max_xlm_price_usd = EXCLUDED.max_xlm_price_usd,
          email_notifications_enabled = EXCLUDED.email_notifications_enabled,
          email = EXCLUDED.email,
          updated_at = NOW()
    RETURNING *`,
    [freelancerAddress, min, max, Boolean(emailNotificationsEnabled), email || null]
  );

  return rows[0];
}

async function getPriceAlertPreference(freelancerAddress) {
  validatePublicKey(freelancerAddress);
  const { rows } = await pool.query(
    "SELECT * FROM price_alert_preferences WHERE freelancer_address = $1",
    [freelancerAddress]
  );
  return rows[0] || null;
}

// ─── New condition/threshold price alert CRUD ─────────────────────────────────

/**
 * Create a new price alert.
 * @param {Object} opts
 * @param {string} opts.userAddress - Stellar public key
 * @param {'above'|'below'} opts.condition - Alert when price goes above or below threshold
 * @param {number} opts.threshold - Price threshold in USD
 * @param {boolean} [opts.oneTime=true] - Whether to auto-delete after triggering
 * @returns {Promise<Object>} The created alert
 */
async function createPriceAlert({ userAddress, condition, threshold, oneTime = true }) {
  validatePublicKey(userAddress);

  if (!['above', 'below'].includes(condition)) {
    const e = new Error("condition must be 'above' or 'below'");
    e.status = 400;
    throw e;
  }

  const thresholdNum = Number(threshold);
  if (Number.isNaN(thresholdNum) || thresholdNum <= 0) {
    const e = new Error("threshold must be a positive number");
    e.status = 400;
    throw e;
  }

  // Limit to 20 alerts per user to prevent abuse
  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM price_alerts WHERE user_address = $1 AND triggered = FALSE",
    [userAddress]
  );
  if (countRows[0].cnt >= 20) {
    const e = new Error("Maximum of 20 active price alerts per user");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO price_alerts (user_address, condition, threshold, one_time)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userAddress, condition, thresholdNum, Boolean(oneTime)]
  );

  return rows[0];
}

/**
 * List all price alerts for a user.
 * @param {string} userAddress - Stellar public key
 * @returns {Promise<Object[]>} Array of alerts
 */
async function listPriceAlerts(userAddress) {
  validatePublicKey(userAddress);

  const { rows } = await pool.query(
    `SELECT id, user_address, condition, threshold, one_time, triggered, triggered_at, created_at
     FROM price_alerts
     WHERE user_address = $1
     ORDER BY created_at DESC`,
    [userAddress]
  );

  return rows;
}

/**
 * Delete a price alert by ID.
 * @param {string} alertId - Alert UUID
 * @param {string} userAddress - Owner's Stellar public key (for authorization)
 * @returns {Promise<boolean>} Whether a row was deleted
 */
async function deletePriceAlert(alertId, userAddress) {
  const { rowCount } = await pool.query(
    "DELETE FROM price_alerts WHERE id = $1 AND user_address = $2",
    [alertId, userAddress]
  );

  if (rowCount === 0) {
    const e = new Error("Price alert not found or not owned by user");
    e.status = 404;
    throw e;
  }

  return true;
}

/**
 * Delete all triggered one-time alerts for a user (cleanup).
 * @param {string} userAddress - Stellar public key
 */
async function cleanupTriggeredAlerts(userAddress) {
  await pool.query(
    "DELETE FROM price_alerts WHERE user_address = $1 AND triggered = TRUE AND one_time = TRUE",
    [userAddress]
  );
}

function throwBadRequest(message) {
  const e = new Error(message);
  e.status = 400;
  throw e;
}

class PriceAlertService {
  constructor({ broadcast = () => {}, sendEmail = async () => {} } = {}) {
    this.broadcast = broadcast;
    this.sendEmail = sendEmail;
    this.interval = null;
  }

  async fetchXlmPriceUsd() {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd"
    );
    if (!response.ok) throw new Error(`Failed to fetch XLM price: ${response.status}`);
    const data = await response.json();
    return Number(data?.stellar?.usd);
  }

  async runOnce() {
    const currentPriceUsd = await this.fetchXlmPriceUsd();
    if (Number.isNaN(currentPriceUsd)) return;

    // ── Check legacy price_alert_preferences (min/max) ──
    const { rows: legacyPrefs } = await pool.query("SELECT * FROM price_alert_preferences");
    for (const pref of legacyPrefs) {
      const shouldTriggerMin =
        pref.min_xlm_price_usd !== null &&
        currentPriceUsd < Number(pref.min_xlm_price_usd) &&
        (!pref.last_min_alert_at || Date.now() - new Date(pref.last_min_alert_at).getTime() > 60 * 60 * 1000);

      const shouldTriggerMax =
        pref.max_xlm_price_usd !== null &&
        currentPriceUsd > Number(pref.max_xlm_price_usd) &&
        (!pref.last_max_alert_at || Date.now() - new Date(pref.last_max_alert_at).getTime() > 60 * 60 * 1000);

      if (shouldTriggerMin) {
        await this.handleTrigger(pref, "min", currentPriceUsd, Number(pref.min_xlm_price_usd));
      }
      if (shouldTriggerMax) {
        await this.handleTrigger(pref, "max", currentPriceUsd, Number(pref.max_xlm_price_usd));
      }
    }

    // ── Check new price_alerts table (condition/threshold) ──
    const { rows: activeAlerts } = await pool.query(
      "SELECT * FROM price_alerts WHERE triggered = FALSE"
    );
    for (const alert of activeAlerts) {
      const shouldTrigger =
        (alert.condition === 'above' && currentPriceUsd > Number(alert.threshold)) ||
        (alert.condition === 'below' && currentPriceUsd < Number(alert.threshold));

      if (shouldTrigger) {
        await this.handleNewAlertTrigger(alert, currentPriceUsd);
      }
    }

    // Clean up any triggered one-time alerts that weren't deleted
    try {
      await pool.query(
        "DELETE FROM price_alerts WHERE triggered = TRUE AND one_time = TRUE AND triggered_at < NOW() - INTERVAL '1 hour'"
      );
    } catch (err) {
      console.error("[price-alert] Failed to cleanup triggered alerts:", err.message);
    }
  }

  async sendPriceAlertNotification(userAddress, direction, currentPriceUsd, threshold) {
    try {
      await createInAppNotification({
        userAddress,
        type: "price_alert",
        title: `XLM ${direction === 'above' ? '⬆' : '⬇'} Price Alert`,
        body: `XLM is now ${currentPriceUsd.toFixed(4)} USD — crossed ${direction} your threshold of ${Number(threshold).toFixed(4)} USD.`,
        linkPath: "/dashboard",
        sendPush: true,
      });
    } catch (err) {
      console.error("[price-alert] Failed to create in-app notification:", err.message);
    }
  }

  async handleNewAlertTrigger(alert, currentPriceUsd) {
    // Mark as triggered
    await pool.query(
      `UPDATE price_alerts SET triggered = TRUE, triggered_at = NOW() WHERE id = $1`,
      [alert.id]
    );

    const direction = alert.condition === 'above' ? 'above' : 'below';

    // Send WebSocket broadcast
    this.broadcast("price:alert", {
      alertId: alert.id,
      recipientAddress: alert.user_address,
      kind: direction,
      currentPriceUsd,
      threshold: Number(alert.threshold),
      triggeredAt: new Date().toISOString(),
    });

    // Create in-app notification
    await this.sendPriceAlertNotification(alert.user_address, direction, currentPriceUsd, alert.threshold);

    // Auto-delete if one-time alert
    if (alert.one_time) {
      try {
        await pool.query(
          "DELETE FROM price_alerts WHERE id = $1 AND one_time = TRUE",
          [alert.id]
        );
      } catch (err) {
        console.error("[price-alert] Failed to auto-delete triggered alert:", err.message);
      }
    }
  }

  async handleTrigger(pref, kind, currentPriceUsd, threshold) {
    const field = kind === "min" ? "last_min_alert_at" : "last_max_alert_at";
    await pool.query(`UPDATE price_alert_preferences SET ${field} = NOW(), updated_at = NOW() WHERE freelancer_address = $1`, [
      pref.freelancer_address,
    ]);

    const direction = kind === "min" ? "below" : "above";

    this.broadcast("price:alert", {
      recipientAddress: pref.freelancer_address,
      kind,
      currentPriceUsd,
      threshold,
      triggeredAt: new Date().toISOString(),
    });

    // Create in-app notification for legacy alerts too
    await this.sendPriceAlertNotification(pref.freelancer_address, direction, currentPriceUsd, threshold);

    if (pref.email_notifications_enabled && pref.email) {
      await this.sendEmail({
        to: pref.email,
        subject: `XLM price alert (${direction} threshold)`,
        text: `XLM price is ${currentPriceUsd} USD. Your ${direction} threshold is ${threshold} USD.`,
      });
    }
  }

  start() {
    if (this.interval) return;
    this.runOnce().catch((error) => {
      console.error("[price-alert] initial check failed:", error.message);
    });
    this.interval = setInterval(() => {
      this.runOnce().catch((error) => {
        console.error("[price-alert] poll failed:", error.message);
      });
    }, POLL_INTERVAL_MS);
    this.interval.unref();
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }
}

module.exports = {
  POLL_INTERVAL_MS,
  ALERT_COOLDOWN_SQL,
  upsertPriceAlertPreference,
  getPriceAlertPreference,
  createPriceAlert,
  listPriceAlerts,
  deletePriceAlert,
  PriceAlertService,
};
