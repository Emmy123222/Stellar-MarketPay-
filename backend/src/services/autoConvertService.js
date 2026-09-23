/**
 * src/services/autoConvertService.js
 *
 * Issue #1560: Opt-in auto-conversion of XLM earnings to USDC after each
 * escrow release.
 *
 * MarketPay is non-custodial, so the backend never holds a freelancer's key.
 * The flow is:
 *
 *   1. Freelancer enables "Auto-convert earnings to USDC" in Settings
 *      (profiles.auto_convert_usdc).
 *   2. On every escrow / milestone release, queueAutoConversion() records a
 *      'pending' row in usdc_auto_conversions with a Horizon path quote.
 *   3. The freelancer's client (wallet connected) fetches pending conversions
 *      with a fresh quote and min-received amount, builds a
 *      pathPaymentStrictSend (XLM → USDC, destination = self), signs it and
 *      submits it to the network.
 *   4. completeAutoConversion() verifies the operation on Horizon, stores the
 *      amounts and effective exchange rate in the payment history and notifies
 *      the user in-app and by email.
 */
"use strict";

const { Horizon, Asset } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");
const {
  createInAppNotification,
  queueNotification,
  generateInAppContent,
  EVENT_TYPES,
} = require("./notificationService");

const logger = createServiceLogger("auto-convert");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const IS_MAINNET = (process.env.STELLAR_NETWORK || "testnet") === "mainnet";
// Circle USDC issuers — kept in sync with frontend/lib/stellar.ts
const USDC_ISSUER =
  process.env.USDC_ISSUER ||
  (IS_MAINNET
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const USDC = new Asset("USDC", USDC_ISSUER);

const MIN_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 1000;

let horizon = null;
function getHorizon() {
  if (!horizon) horizon = new Horizon.Server(HORIZON_URL);
  return horizon;
}

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const toFixed7 = (v) => (v == null ? null : Number(v).toFixed(7));

function rowToConversion(row) {
  return {
    id: row.id,
    userAddress: row.user_address,
    jobId: row.job_id,
    jobTitle: row.job_title ?? null,
    milestoneIndex: row.milestone_index,
    sourceAmountXlm: toFixed7(row.source_amount_xlm),
    quotedUsdc: toFixed7(row.quoted_usdc),
    destMinUsdc: toFixed7(row.dest_min_usdc),
    receivedUsdc: toFixed7(row.received_usdc),
    exchangeRate: toFixed7(row.exchange_rate),
    txHash: row.tx_hash,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function assetToJson(asset) {
  if (asset.asset_type === "native") return { type: "native" };
  return { type: asset.asset_type, code: asset.asset_code, issuer: asset.asset_issuer };
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function getAutoConvertSettings(publicKey) {
  validatePublicKey(publicKey);
  const { rows } = await pool.query(
    `SELECT auto_convert_usdc, auto_convert_slippage_bps FROM profiles WHERE public_key = $1`,
    [publicKey],
  );
  if (!rows.length) throw httpError(404, "Profile not found");
  return {
    enabled: rows[0].auto_convert_usdc,
    slippageBps: rows[0].auto_convert_slippage_bps,
    usdcIssuer: USDC_ISSUER,
  };
}

async function updateAutoConvertSettings(publicKey, { enabled, slippageBps } = {}) {
  validatePublicKey(publicKey);

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw httpError(400, "enabled must be a boolean");
  }
  if (slippageBps !== undefined) {
    const n = Number(slippageBps);
    if (!Number.isInteger(n) || n < MIN_SLIPPAGE_BPS || n > MAX_SLIPPAGE_BPS) {
      throw httpError(400, `slippageBps must be an integer between ${MIN_SLIPPAGE_BPS} and ${MAX_SLIPPAGE_BPS}`);
    }
  }

  const { rows } = await pool.query(
    `UPDATE profiles
     SET auto_convert_usdc         = COALESCE($2, auto_convert_usdc),
         auto_convert_slippage_bps = COALESCE($3, auto_convert_slippage_bps),
         updated_at                = NOW()
     WHERE public_key = $1
     RETURNING auto_convert_usdc, auto_convert_slippage_bps`,
    [publicKey, enabled ?? null, slippageBps == null ? null : Number(slippageBps)],
  );
  if (!rows.length) throw httpError(404, "Profile not found");

  return {
    enabled: rows[0].auto_convert_usdc,
    slippageBps: rows[0].auto_convert_slippage_bps,
    usdcIssuer: USDC_ISSUER,
  };
}

// ─── Quotes ──────────────────────────────────────────────────────────────────

/**
 * Best XLM → USDC strict-send path from Horizon.
 *
 * @param {string} amountXlm
 * @returns {Promise<{destinationAmount: string, path: Array}|null>}
 */
async function quoteXlmToUsdc(amountXlm) {
  const res = await getHorizon()
    .strictSendPaths(Asset.native(), toFixed7(amountXlm), [USDC])
    .call();
  const records = res?.records || [];
  if (!records.length) return null;
  const best = records.reduce((a, b) =>
    parseFloat(b.destination_amount) > parseFloat(a.destination_amount) ? b : a,
  );
  return {
    destinationAmount: toFixed7(best.destination_amount),
    path: (best.path || []).map(assetToJson),
  };
}

function applySlippage(amount, slippageBps) {
  return toFixed7((parseFloat(amount) * (10_000 - slippageBps)) / 10_000);
}

// ─── Release hook ────────────────────────────────────────────────────────────

/**
 * Queue an XLM → USDC conversion for the freelancer of a job after a release,
 * if they opted in. Best-effort: never throws, so an escrow release is never
 * blocked by the conversion step.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string|number} params.amountXlm     Amount released to the freelancer.
 * @param {number|null} [params.milestoneIndex]
 * @returns {Promise<Object|null>} The queued conversion, or null if not applicable.
 */
async function queueAutoConversion({ jobId, amountXlm, milestoneIndex = null }) {
  try {
    const amount = parseFloat(amountXlm);
    if (!jobId || !Number.isFinite(amount) || amount <= 0) return null;

    const { rows: jobRows } = await pool.query(
      `SELECT j.freelancer_address, j.currency, p.auto_convert_usdc, p.auto_convert_slippage_bps
       FROM jobs j
       JOIN profiles p ON p.public_key = j.freelancer_address
       WHERE j.id = $1`,
      [jobId],
    );
    const job = jobRows[0];
    if (!job || !job.auto_convert_usdc) return null;
    // Only XLM earnings are converted; USDC jobs already pay out in USDC.
    if (job.currency && job.currency !== "XLM") return null;

    let quote = null;
    try {
      quote = await quoteXlmToUsdc(amount);
    } catch (err) {
      logError(logger, err, { operation: "auto_convert_quote", jobId });
    }

    const { rows } = await pool.query(
      `INSERT INTO usdc_auto_conversions
         (user_address, job_id, milestone_index, source_amount_xlm, quoted_usdc, dest_min_usdc)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_address, job_id, (COALESCE(milestone_index, -1))) DO NOTHING
       RETURNING *`,
      [
        job.freelancer_address,
        jobId,
        Number.isInteger(milestoneIndex) ? milestoneIndex : null,
        toFixed7(amount),
        quote?.destinationAmount ?? null,
        quote ? applySlippage(quote.destinationAmount, job.auto_convert_slippage_bps) : null,
      ],
    );
    return rows.length ? rowToConversion(rows[0]) : null;
  } catch (err) {
    logError(logger, err, { operation: "queue_auto_conversion", jobId });
    return null;
  }
}

// ─── Freelancer-side flow ────────────────────────────────────────────────────

/**
 * Pending conversions for a user, each with a fresh quote, the minimum USDC
 * they will accept (after slippage) and the path to use in the
 * pathPaymentStrictSend operation.
 */
async function listPendingConversions(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `SELECT c.*, j.title AS job_title, p.auto_convert_slippage_bps
     FROM usdc_auto_conversions c
     LEFT JOIN jobs j ON j.id = c.job_id
     JOIN profiles p ON p.public_key = c.user_address
     WHERE c.user_address = $1 AND c.status = 'pending'
     ORDER BY c.created_at ASC
     LIMIT 20`,
    [publicKey],
  );

  const results = [];
  for (const row of rows) {
    const conversion = rowToConversion(row);
    let quote = null;
    try {
      quote = await quoteXlmToUsdc(row.source_amount_xlm);
    } catch (err) {
      logError(logger, err, { operation: "auto_convert_requote", id: row.id });
    }
    results.push({
      ...conversion,
      quotedUsdc: quote?.destinationAmount ?? conversion.quotedUsdc,
      destMinUsdc: quote
        ? applySlippage(quote.destinationAmount, row.auto_convert_slippage_bps)
        : conversion.destMinUsdc,
      path: quote?.path ?? [],
      quoteAvailable: Boolean(quote),
      usdcIssuer: USDC_ISSUER,
    });
  }
  return results;
}

async function getOwnedConversion(publicKey, id) {
  validatePublicKey(publicKey);
  const { rows } = await pool.query(
    `SELECT c.*, j.title AS job_title
     FROM usdc_auto_conversions c
     LEFT JOIN jobs j ON j.id = c.job_id
     WHERE c.id = $1`,
    [id],
  );
  if (!rows.length) throw httpError(404, "Conversion not found");
  if (rows[0].user_address !== publicKey) throw httpError(403, "Forbidden");
  return rows[0];
}

/**
 * Find and validate the XLM → USDC strict-send operation for this user in a
 * submitted transaction.
 */
async function verifyConversionTx(publicKey, txHash) {
  let tx;
  let ops;
  try {
    tx = await getHorizon().transactions().transaction(txHash).call();
    ops = await getHorizon().operations().forTransaction(txHash).limit(50).call();
  } catch (err) {
    if (err?.response?.status === 404) throw httpError(404, "Transaction not found on the network");
    throw httpError(502, "Unable to verify transaction on Horizon");
  }

  if (!tx.successful) throw httpError(400, "Transaction was not successful");

  const op = (ops.records || []).find(
    (o) =>
      o.type === "path_payment_strict_send" &&
      o.from === publicKey &&
      o.to === publicKey &&
      o.source_asset_type === "native" &&
      o.asset_code === "USDC" &&
      o.asset_issuer === USDC_ISSUER,
  );
  if (!op) {
    throw httpError(400, "Transaction does not contain an XLM→USDC pathPaymentStrictSend to your own account");
  }

  return {
    sourceAmount: parseFloat(op.source_amount),
    receivedUsdc: parseFloat(op.amount),
  };
}

/**
 * Record a completed conversion after the user's wallet submitted the swap,
 * then notify them in-app and by email.
 */
async function completeAutoConversion(publicKey, id, { txHash } = {}) {
  if (!txHash || !/^[a-f0-9]{64}$/i.test(txHash)) {
    throw httpError(400, "A valid transaction hash is required");
  }

  const row = await getOwnedConversion(publicKey, id);
  if (row.status !== "pending") throw httpError(409, `Conversion is already ${row.status}`);

  const { sourceAmount, receivedUsdc } = await verifyConversionTx(publicKey, txHash);
  const expected = parseFloat(row.source_amount_xlm);
  if (Math.abs(sourceAmount - expected) > 0.0000001) {
    throw httpError(400, `Transaction sent ${sourceAmount} XLM but ${expected} XLM was expected`);
  }

  const exchangeRate = receivedUsdc / sourceAmount;

  let updated;
  try {
    const { rows } = await pool.query(
      `UPDATE usdc_auto_conversions
       SET status = 'completed', tx_hash = $2, received_usdc = $3, exchange_rate = $4,
           completed_at = NOW(), error = NULL
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, txHash.toLowerCase(), toFixed7(receivedUsdc), toFixed7(exchangeRate)],
    );
    if (!rows.length) throw httpError(409, "Conversion is no longer pending");
    updated = rowToConversion({ ...rows[0], job_title: row.job_title });
  } catch (err) {
    if (err.code === "23505") throw httpError(409, "This transaction was already recorded");
    throw err;
  }

  await notifyConversion(updated).catch((err) =>
    logError(logger, err, { operation: "auto_convert_notify", id }),
  );

  return updated;
}

async function notifyConversion(conversion) {
  const data = {
    jobTitle: conversion.jobTitle || "your job",
    jobId: conversion.jobId,
    sourceAmountXlm: conversion.sourceAmountXlm,
    receivedUsdc: conversion.receivedUsdc,
    exchangeRate: conversion.exchangeRate,
    txHash: conversion.txHash,
    amount: conversion.receivedUsdc,
    currency: "USDC",
  };

  const content = generateInAppContent(EVENT_TYPES.USDC_AUTO_CONVERTED, data);
  await createInAppNotification({
    userAddress: conversion.userAddress,
    type: EVENT_TYPES.USDC_AUTO_CONVERTED,
    title: content.title,
    body: content.body,
    jobId: conversion.jobId,
    linkPath: "/settings",
  });

  await queueNotification({
    recipientAddress: conversion.userAddress,
    notificationType: "email",
    eventType: EVENT_TYPES.USDC_AUTO_CONVERTED,
    jobId: conversion.jobId,
    payload: data,
  });
}

/**
 * Mark a pending conversion as failed (wallet rejected / submission error) or
 * skipped (user chose to keep XLM this time).
 */
async function dismissAutoConversion(publicKey, id, { status = "skipped", error } = {}) {
  if (!["failed", "skipped"].includes(status)) {
    throw httpError(400, "status must be 'failed' or 'skipped'");
  }
  const row = await getOwnedConversion(publicKey, id);
  if (row.status !== "pending") throw httpError(409, `Conversion is already ${row.status}`);

  const { rows } = await pool.query(
    `UPDATE usdc_auto_conversions
     SET status = $2, error = $3, completed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, status, error ? String(error).slice(0, 500) : null],
  );
  if (!rows.length) throw httpError(409, "Conversion is no longer pending");
  return rowToConversion({ ...rows[0], job_title: row.job_title });
}

/**
 * Paginated auto-conversion payment history.
 */
async function listConversionHistory(publicKey, { page = 1, limit = 20 } = {}) {
  validatePublicKey(publicKey);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT c.*, j.title AS job_title
       FROM usdc_auto_conversions c
       LEFT JOIN jobs j ON j.id = c.job_id
       WHERE c.user_address = $1
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $2 OFFSET $3`,
      [publicKey, pageSize, (pageNum - 1) * pageSize],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM usdc_auto_conversions WHERE user_address = $1`,
      [publicKey],
    ),
  ]);

  const total = countRows[0]?.total || 0;
  return {
    conversions: rows.map(rowToConversion),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

module.exports = {
  getAutoConvertSettings,
  updateAutoConvertSettings,
  queueAutoConversion,
  listPendingConversions,
  completeAutoConversion,
  dismissAutoConversion,
  listConversionHistory,
  quoteXlmToUsdc,
  applySlippage,
  USDC_ISSUER,
};
