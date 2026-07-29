"use strict";

const pool = require("../db/pool");

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

    const { rows } = await pool.query("SELECT * FROM price_alert_preferences");
    for (const pref of rows) {
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
  }

  async handleTrigger(pref, kind, currentPriceUsd, threshold) {
    const field = kind === "min" ? "last_min_alert_at" : "last_max_alert_at";
    await pool.query(`UPDATE price_alert_preferences SET ${field} = NOW(), updated_at = NOW() WHERE freelancer_address = $1`, [
      pref.freelancer_address,
    ]);

    this.broadcast("price:alert", {
      recipientAddress: pref.freelancer_address,
      kind,
      currentPriceUsd,
      threshold,
      triggeredAt: new Date().toISOString(),
    });

    if (pref.email_notifications_enabled && pref.email) {
      await this.sendEmail({
        to: pref.email,
        subject: `XLM price alert (${kind === "min" ? "below" : "above"} threshold)`,
        text: `XLM price is ${currentPriceUsd} USD. Your ${kind} threshold is ${threshold} USD.`,
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
  PriceAlertService,
};
