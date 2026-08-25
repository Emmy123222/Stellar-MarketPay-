"use strict";

const crypto = require("crypto");
const axios = require("axios");
const pool = require("../db/pool");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("webhookService");
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

function buildSignature(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerWebhook({ userAddress, url, events, secret }) {
  const { rows } = await pool.query(
    `INSERT INTO webhooks (user_address, url, events, secret, created_at)
     VALUES ($1, $2, $3::text[], $4, NOW())
     RETURNING *`,
    [userAddress, url, events, secret],
  );

  return rows[0];
}

async function listWebhooksForEvent(userAddresses, eventType) {
  if (!Array.isArray(userAddresses) || userAddresses.length === 0) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT id, user_address, url, events, secret, created_at
     FROM webhooks
     WHERE user_address = ANY($1::text[])
       AND $2 = ANY(events)`,
    [userAddresses, eventType],
  );

  return rows;
}

async function recordWebhookDeliveryAttempt({
  webhookId,
  eventType,
  payload,
  attemptNumber,
  status,
  responseStatus = null,
  errorMessage = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO webhook_deliveries
      (webhook_id, event_type, payload, attempt_number, status, response_status, error_message, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      webhookId,
      eventType,
      JSON.stringify(payload),
      attemptNumber,
      status,
      responseStatus,
      errorMessage,
    ],
  );

  return rows[0];
}

async function deliverSingleWebhook(webhook, eventType, payload) {
  const body = JSON.stringify(payload);
  const attempts = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const signature = buildSignature(webhook.secret, body);
      const response = await axios.post(webhook.url, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
        },
        timeout: 10000,
      });

      attempts.push(await recordWebhookDeliveryAttempt({
        webhookId: webhook.id,
        eventType,
        payload,
        attemptNumber: attempt,
        status: "delivered",
        responseStatus: response.status,
      }));

      return { success: true, attempts };
    } catch (error) {
      attempts.push(await recordWebhookDeliveryAttempt({
        webhookId: webhook.id,
        eventType,
        payload,
        attemptNumber: attempt,
        status: attempt === MAX_RETRIES ? "failed" : "retrying",
        responseStatus: error.response?.status || null,
        errorMessage: error.message,
      }));

      if (attempt < MAX_RETRIES) {
        await wait(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
      } else {
        logger.error(
          {
            webhookId: webhook.id,
            eventType,
            error: error.message,
            responseStatus: error.response?.status || null,
          },
          "Webhook delivery failed after retries",
        );
      }
    }
  }

  return { success: false, attempts };
}

async function deliverEscrowWebhooks({ eventType, userAddresses, payload }) {
  const webhooks = await listWebhooksForEvent(userAddresses, eventType);
  const deliveries = [];

  for (const webhook of webhooks) {
    deliveries.push(await deliverSingleWebhook(webhook, eventType, payload));
  }

  return { deliveries };
}

module.exports = {
  MAX_RETRIES,
  BASE_BACKOFF_MS,
  buildSignature,
  registerWebhook,
  deliverSingleWebhook,
  deliverEscrowWebhooks,
};
