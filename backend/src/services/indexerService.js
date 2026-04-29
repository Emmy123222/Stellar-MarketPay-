"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");

function parseJobIdFromMemo(memoValue) {
  if (!memoValue || typeof memoValue !== "string") return null;
  const trimmed = memoValue.trim();
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuidMatch) return uuidMatch[0];
  return null;
}

function toNumericAmount(amount) {
  const parsed = Number.parseFloat(amount || "0");
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function normalizeAsset(op) {
  if (op.asset_type === "native") return "XLM";
  if (op.asset_code) return op.asset_code;
  return "UNKNOWN";
}

function isEscrowRelease(op, platformWallet) {
  return op.type === "payment" && op.from === platformWallet && op.to && op.to !== platformWallet;
}

function isDonation(op, platformWallet) {
  return op.type === "payment" && op.to === platformWallet && op.from && op.from !== platformWallet;
}

class IndexerService {
  constructor({ platformWallet, horizonUrl, broadcast = () => {} }) {
    this.platformWallet = platformWallet;
    this.horizonUrl = horizonUrl || "https://horizon-testnet.stellar.org";
    this.broadcast = broadcast;
    this.horizon = new Horizon.Server(this.horizonUrl);
    this.syncState = {
      running: false,
      synced: false,
      lastProcessedLedger: null,
      lastTransactionAt: null,
      lastError: null,
    };
    this.closeStream = null;
    this.closeEventStream = null;
    this.contractId = process.env.ESCROW_CONTRACT_ID;
  }

  async loadCheckpoint() {
    const { rows } = await pool.query(
      "SELECT synced, last_processed_ledger, last_transaction_at, updated_at FROM indexer_state WHERE id = 1"
    );
    if (!rows.length) return null;
    this.syncState.synced = Boolean(rows[0].synced);
    this.syncState.lastProcessedLedger = rows[0].last_processed_ledger;
    this.syncState.lastTransactionAt = rows[0].last_transaction_at;
    return rows[0].last_processed_ledger;
  }

  async saveCheckpoint({ ledger, txTimestamp, synced = true }) {
    await pool.query(
      `UPDATE indexer_state
       SET synced = $1,
           last_processed_ledger = $2,
           last_transaction_at = $3,
           updated_at = NOW()
       WHERE id = 1`,
      [synced, ledger || null, txTimestamp || null]
    );
    this.syncState.synced = synced;
    this.syncState.lastProcessedLedger = ledger || null;
    this.syncState.lastTransactionAt = txTimestamp || null;
  }

  async processTransaction(tx) {
    if (!tx.successful) return;
    const txMemo = tx.memo || null;
    const ledgerNumber = tx.ledger_attr || tx.ledger || null;
    const matchedJobId = parseJobIdFromMemo(txMemo);
    const operations = await this.horizon.operations().forTransaction(tx.hash).limit(200).call();
    const records = operations?.records || [];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const op of records) {
        if (op.type !== "payment") continue;
        const amount = toNumericAmount(op.amount);
        if (amount <= 0) continue;

        const asset = normalizeAsset(op);
        const jobId = matchedJobId;
        const outbound = op.from === this.platformWallet;
        const direction = outbound ? "outbound" : "inbound";

        await client.query(
          `INSERT INTO payment_records
           (tx_hash, operation_id, ledger, job_id, from_address, to_address, amount, asset, memo, direction, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (operation_id) DO NOTHING`,
          [
            tx.hash,
            String(op.id),
            ledgerNumber,
            jobId,
            op.from,
            op.to,
            amount.toFixed(7),
            asset,
            txMemo,
            direction,
          ]
        );

        if (jobId && isEscrowRelease(op, this.platformWallet)) {
          const jobResult = await client.query(
            "UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING id, status, freelancer_address, client_address",
            [jobId]
          );
          await client.query(
            `UPDATE escrows
             SET status = 'released', released_at = NOW(), updated_at = NOW()
             WHERE job_id = $1 AND status <> 'released'`,
            [jobId]
          );

          if (jobResult.rows.length) {
            this.broadcast("job:status-changed", {
              jobId,
              status: "completed",
              txHash: tx.hash,
              ledger: ledgerNumber,
            });
          }
        }

        if (asset === "XLM" && isDonation(op, this.platformWallet)) {
          await client.query(
            `INSERT INTO donor_stats (address, total_donated_xlm, donation_count, updated_at)
             VALUES ($1, $2, 1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET
               total_donated_xlm = donor_stats.total_donated_xlm + EXCLUDED.total_donated_xlm,
               donation_count = donor_stats.donation_count + 1,
               updated_at = NOW()`,
            [op.from, amount.toFixed(7)]
          );

          const leaderboard = await client.query(
            `SELECT address, total_donated_xlm, donation_count
             FROM donor_stats
             ORDER BY total_donated_xlm DESC, donation_count DESC
             LIMIT 10`
          );
          this.broadcast("analytics:leaderboard-updated", {
            leaderboard: leaderboard.rows,
            txHash: tx.hash,
          });
        }
      }

      await client.query(
        `UPDATE indexer_state
         SET synced = TRUE,
             last_processed_ledger = $1,
             last_transaction_at = $2,
             updated_at = NOW()
         WHERE id = 1`,
        [ledgerNumber, tx.created_at || null]
      );
      this.syncState.synced = true;
      this.syncState.lastProcessedLedger = ledgerNumber;
      this.syncState.lastTransactionAt = tx.created_at || null;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async processEvent(event) {
    // Soroban events from Horizon have: type, id, paging_token, ledger, ledger_closed_at, contract_id, topic, value, etc.
    if (this.contractId && event.contract_id !== this.contractId) return;

    const eventTypeRaw = event.topic?.[0];
    if (!eventTypeRaw) return;

    // Map contract symbols to DB event types
    const typeMap = {
      "created": "escrow_created",
      "started": "work_started",
      "released": "escrow_released",
      "conv_rel": "escrow_released",
      "refunded": "escrow_refunded",
      "disputed": "dispute_opened"
    };

    const eventType = typeMap[eventTypeRaw];
    if (!eventType) return;

    const jobId = event.value?.job_id || event.value; // Simplification: depends on event structure
    if (!jobId) return;

    await pool.query(
      `INSERT INTO contract_events (job_id, event_type, contract_id, tx_hash, ledger, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        jobId,
        eventType,
        event.contract_id,
        event.transaction_hash,
        event.ledger,
        JSON.stringify(event.value || {}),
        event.ledger_closed_at
      ]
    );

    this.broadcast("contract:event", { jobId, eventType, txHash: event.transaction_hash });
  }

  async start() {
    if (this.syncState.running) return;
    if (!this.platformWallet) {
      this.syncState.lastError = "PLATFORM_WALLET_ADDRESS is not configured";
      return;
    }

    await this.loadCheckpoint();
    this.syncState.running = true;
    this.syncState.lastError = null;

    const cursor = this.syncState.lastProcessedLedger ? String(this.syncState.lastProcessedLedger) : "now";

    this.closeStream = this.horizon
      .transactions()
      .forAccount(this.platformWallet)
      .cursor(cursor)
      .stream({
        onmessage: async (tx) => {
          try {
            await this.processTransaction(tx);
          } catch (error) {
            this.syncState.lastError = error.message;
            console.error("[Indexer] failed to process transaction:", error.message);
          }
        },
        onerror: (error) => {
          this.syncState.lastError = error?.message || "stream error";
          console.error("[Indexer] stream error:", this.syncState.lastError);
        },
      });

    // Start event stream
    this.startEventStream();
  }

  startEventStream() {
    const cursor = "now";
    this.closeEventStream = this.horizon
      .events()
      .cursor(cursor)
      .stream({
        onmessage: async (event) => {
          try {
            await this.processEvent(event);
          } catch (error) {
            console.error("[Indexer] failed to process event:", error.message);
          }
        },
        onerror: (error) => {
          console.error("[Indexer] event stream error:", error?.message);
          // Auto-reconnect logic
          setTimeout(() => {
            if (this.syncState.running) {
              console.log("[Indexer] attempting to reconnect event stream...");
              this.startEventStream();
            }
          }, 5000);
        },
      });
  }

  async getEventsForJob(jobId) {
    const { rows } = await pool.query(
      "SELECT * FROM contract_events WHERE job_id = $1 ORDER BY created_at ASC",
      [jobId]
    );
    return rows;
  }


  stop() {
    if (typeof this.closeStream === "function") this.closeStream();
    if (typeof this.closeEventStream === "function") this.closeEventStream();
    this.closeStream = null;
    this.closeEventStream = null;
    this.syncState.running = false;
  }

  getHealth() {
    return { ...this.syncState };
  }
}

module.exports = IndexerService;
