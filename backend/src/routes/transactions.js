"use strict";

/**
 * src/routes/transactions.js
 *
 * GET /api/transactions/export
 *   ?format=csv   (required)
 *   ?account=G... (required — Stellar public key)
 *   ?filter=all|sent|received|escrow  (optional, default "all")
 *
 * Streams transaction history from Horizon directly to the client as a CSV
 * file using Node.js stream.pipeline — no full buffering in memory.
 *
 * Horizon returns up to 200 records per page; we walk every page via the
 * `next` link until exhausted, encoding each record as a CSV row on the fly.
 */

const express = require("express");
const router = express.Router();
const { pipeline, Readable, Transform } = require("stream");
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");

const exportRateLimiter = createRateLimiter(10, 1); // 10 exports per minute per IP

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const CSV_HEADER = "id,hash,ledger,created_at,from,to,amount,asset,memo,memo_type,successful,type\n";

const PAGE_LIMIT = 200; // max Horizon allows

/**
 * Determine a human-readable transaction type from a Horizon record.
 * Mirrors the logic in the frontend getTransactionType helper so the
 * exported CSV column is consistent with what the UI shows.
 */
function resolveType(record, accountAddress) {
  const memo = (record.memo || "").toLowerCase();
  if (memo.includes("escrow") || memo.includes("marketpay")) return "escrow";

  // Walk the operations embedded in the record if present
  const ops = record._embedded?.operations || [];
  for (const op of ops) {
    if (op.from === accountAddress && op.to !== accountAddress) return "sent";
    if (op.to === accountAddress && op.from !== accountAddress) return "received";
  }

  // Fallback: use source_account heuristic
  if (record.source_account === accountAddress) return "sent";
  return "received";
}

/**
 * Escape a single CSV cell value.
 * Wraps in quotes and escapes interior double-quotes.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/"/g, '""');
  return `"${s}"`;
}

/**
 * Convert one Horizon transaction record to a CSV row string.
 */
function recordToCsvRow(record, accountAddress, filter) {
  const type = resolveType(record, accountAddress);

  // Apply filter before encoding
  if (filter !== "all" && type !== filter) return null;

  const op = (record._embedded?.operations || [])[0] || {};
  const from = op.from || record.source_account || "";
  const to = op.to || "";
  const amount = op.amount || "";
  const asset =
    op.asset_type === "native"
      ? "XLM"
      : op.asset_code || "XLM";

  return [
    csvCell(record.id),
    csvCell(record.hash),
    csvCell(record.ledger),
    csvCell(record.created_at),
    csvCell(from),
    csvCell(to),
    csvCell(amount),
    csvCell(asset),
    csvCell(record.memo || ""),
    csvCell(record.memo_type || "none"),
    csvCell(record.successful),
    csvCell(type),
  ].join(",") + "\n";
}

/**
 * Build the first Horizon page URL for an account's transactions.
 */
function buildHorizonUrl(accountAddress) {
  return `${HORIZON_URL}/accounts/${encodeURIComponent(accountAddress)}/transactions?limit=${PAGE_LIMIT}&order=desc&include_failed=false`;
}

/**
 * Async generator that walks every Horizon page and yields individual
 * transaction records. Each yield is a single JS object from Horizon's
 * `_embedded.records` array.
 */
async function* horizonPageWalker(accountAddress) {
  let url = buildHorizonUrl(accountAddress);

  while (url) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Horizon 404 means the account has no transactions — treat as empty
      if (res.status === 404) return;
      throw new Error(`Horizon responded with ${res.status}`);
    }

    const data = await res.json();
    const records = data._embedded?.records || [];

    for (const record of records) {
      yield record;
    }

    // Follow the `next` link if present and there were results on this page
    url = records.length === PAGE_LIMIT ? data._links?.next?.href : null;
  }
}

/**
 * Create a Transform stream that accepts Horizon records (objects) and
 * emits CSV row strings, applying the requested filter.
 */
function createCsvTransform(accountAddress, filter) {
  return new Transform({
    objectMode: true,
    transform(record, _encoding, callback) {
      try {
        const row = recordToCsvRow(record, accountAddress, filter);
        if (row) this.push(row);
        callback();
      } catch (err) {
        callback(err);
      }
    },
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/transactions/export?format=csv&account=G...&filter=all
 *
 * Requires a valid JWT — the authenticated user may only export their own
 * account's transactions.
 */
router.get("/export", exportRateLimiter, verifyJWT, async (req, res, next) => {
  const { format = "csv", account, filter = "all" } = req.query;

  if (format !== "csv") {
    return res.status(400).json({ error: "Unsupported format. Use format=csv" });
  }

  if (!account || typeof account !== "string" || !/^G[A-Z0-9]{55}$/.test(account)) {
    return res.status(400).json({ error: "Valid Stellar account address required" });
  }

  // Auth: only allow the authenticated user to export their own transactions
  if (req.user.publicKey !== account) {
    return res.status(403).json({ error: "Forbidden: you may only export your own transactions" });
  }

  const validFilters = ["all", "sent", "received", "escrow"];
  const safeFilter = validFilters.includes(filter) ? filter : "all";

  const filename = `transactions-${account.slice(0, 8)}-${new Date().toISOString().split("T")[0]}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-store");
  // Note: Content-Length cannot be set for streamed responses of unknown size.
  // The frontend progress bar uses a chunk counter instead (see frontend implementation).

  // Write the CSV header immediately so the browser starts the download
  res.write(CSV_HEADER);

  // Create a Readable from the async generator, then pipe through the
  // CSV transform and into the response using stream.pipeline for proper
  // error propagation and back-pressure handling.
  const recordStream = Readable.from(horizonPageWalker(account));
  const csvTransform = createCsvTransform(account, safeFilter);

  pipeline(recordStream, csvTransform, res, (err) => {
    if (err) {
      // If headers haven't been flushed yet we can send a JSON error;
      // otherwise the connection is already streaming and we just end it.
      if (!res.headersSent) {
        next(err);
      } else {
        res.end();
      }
    }
  });
});

module.exports = router;
