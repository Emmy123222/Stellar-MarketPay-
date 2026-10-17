/**
 * src/metrics.js
 * Stellar MarketPay — centralised Prometheus metrics registry.
 *
 * Owns the single `prom-client` Registry used by the API process and every
 * metric exported on `GET /metrics`.
 *
 * Metrics required by the observability spec:
 *   • http_requests_total              (counter)
 *   • http_request_duration_ms         (histogram, milliseconds)
 *   • active_websocket_connections     (gauge)
 *   • pool_query_duration_ms           (histogram, milliseconds)
 *
 * Legacy `marketpay_*` series are kept alongside the canonical names so the
 * pre-existing Grafana dashboard and Prometheus alert rules keep working.
 *
 * This module intentionally has NO internal dependencies other than
 * `prom-client` so that low-level modules (e.g. `src/db/pool.js`) can require
 * it without creating an import cycle.
 */
"use strict";

const promClient = require("prom-client");

// ─── Registry ─────────────────────────────────────────────────────────────────
const registry = new promClient.Registry();

promClient.collectDefaultMetrics({
  register: registry,
  prefix: "marketpay_",
});

/**
 * Idempotent metric factory.
 *
 * Jest re-requires modules between suites and `horizonClient.js` registers its
 * own histogram on the default registry; re-creating a metric with a name that
 * already exists throws. Returning the existing instance keeps `require()`
 * safe under any load order.
 *
 * @param {Function} Ctor   prom-client metric constructor
 * @param {object}   config metric configuration
 * @returns {object} the registered metric
 */
function createMetric(Ctor, config) {
  const existing = registry.getSingleMetric(config.name);
  if (existing) return existing;
  return new Ctor({ ...config, registers: [registry] });
}

// ─── HTTP metrics ─────────────────────────────────────────────────────────────
const HTTP_LABELS = ["method", "route", "status_code"];

/** Total HTTP requests handled by the API. */
const httpRequestsTotal = createMetric(promClient.Counter, {
  name: "http_requests_total",
  help: "Total HTTP requests handled by the API",
  labelNames: HTTP_LABELS,
});

/** HTTP request latency in milliseconds. */
const httpRequestDurationMs = createMetric(promClient.Histogram, {
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: HTTP_LABELS,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

// Legacy series (kept for existing dashboards / alert rules).
const legacyHttpRequestsTotal = createMetric(promClient.Counter, {
  name: "marketpay_http_requests_total",
  help: "Total HTTP requests handled by the API (legacy name)",
  labelNames: HTTP_LABELS,
});

const legacyHttpRequestDurationSeconds = createMetric(promClient.Histogram, {
  name: "marketpay_http_request_duration_seconds",
  help: "HTTP request duration in seconds (legacy name)",
  labelNames: HTTP_LABELS,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

// ─── WebSocket metrics ────────────────────────────────────────────────────────
/** Number of currently open WebSocket connections, by channel. */
const activeWebsocketConnections = createMetric(promClient.Gauge, {
  name: "active_websocket_connections",
  help: "Currently open WebSocket connections",
  labelNames: ["channel"],
});

// Legacy unlabelled gauge (realtime channel only).
const legacyWsConnectionsActive = createMetric(promClient.Gauge, {
  name: "ws_connections_active",
  help: "Active WebSocket connections (legacy name)",
});

// ─── Database pool metrics ────────────────────────────────────────────────────
/** PostgreSQL query latency in milliseconds. */
const poolQueryDurationMs = createMetric(promClient.Histogram, {
  name: "pool_query_duration_ms",
  help: "PostgreSQL pool query duration in milliseconds",
  labelNames: ["operation", "status"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

/** Total PostgreSQL queries executed through the shared pool. */
const poolQueriesTotal = createMetric(promClient.Counter, {
  name: "pool_queries_total",
  help: "Total PostgreSQL queries executed through the shared pool",
  labelNames: ["operation", "status"],
});

const dbConnections = createMetric(promClient.Gauge, {
  name: "marketpay_db_connections",
  help: "Current PostgreSQL pool connection counts",
  labelNames: ["state"],
});

const pgPoolTotal = createMetric(promClient.Gauge, {
  name: "pg_pool_total",
  help: "Total PostgreSQL pool connections",
});

const pgPoolIdle = createMetric(promClient.Gauge, {
  name: "pg_pool_idle",
  help: "Idle PostgreSQL pool connections",
});

const pgPoolWaiting = createMetric(promClient.Gauge, {
  name: "pg_pool_waiting",
  help: "Waiting PostgreSQL pool requests",
});

const pgPoolWaitingConnections = createMetric(promClient.Gauge, {
  name: "pg_pool_waiting_connections",
  help: "Waiting PostgreSQL pool requests",
});

const notificationQueuePending = createMetric(promClient.Gauge, {
  name: "notification_queue_pending",
  help: "Pending notifications in the queue",
});

// ─── XLM price gauge ──────────────────────────────────────────────────────────
/** Current XLM/USD spot price, updated on every successful CoinGecko fetch. */
const xlmPriceUsd = createMetric(promClient.Gauge, {
  name: "xlm_price_usd",
  help: "Current XLM price in USD (updated on every successful CoinGecko fetch)",
});

const escrowReleasesTotal = createMetric(promClient.Counter, {
  name: "marketpay_escrow_releases_total",
  help: "Total escrow release attempts",
  labelNames: ["result"],
});
const escrowReleaseErrorsTotal = createMetric(promClient.Counter, {
  name: "marketpay_escrow_release_errors_total",
  help: "Total failed escrow release attempts by bounded reason",
  labelNames: ["reason"],
});

// ─── Cache metrics (Issue #1512) ─────────────────────────────────────────────
/** Cache hit counter for Redis-backed caches, labeled by cache name. */
const cacheHitsTotal = createMetric(promClient.Counter, {
  name: "marketpay_cache_hits_total",
  help: "Total cache hits, labeled by cache name",
  labelNames: ["cache"],
});

/** Cache miss counter for Redis-backed caches, labeled by cache name. */
const cacheMissesTotal = createMetric(promClient.Counter, {
  name: "marketpay_cache_misses_total",
  help: "Total cache misses, labeled by cache name",
  labelNames: ["cache"],
});

// ─── IPFS pin verification ────────────────────────────────────────────────────
/**
 * Counts uploads whose IPFS pin could not be confirmed after the configured
 * number of retries (Issue #1439). A non-zero rate means a CID was returned to
 * a caller while the content is not actually pinned, so it may be
 * garbage-collected by the provider.
 *
 * `reason` is bounded to "not_pinned" | "api_error" | "invalid_cid" so the
 * series cannot explode in cardinality (we never label by CID).
 */
const ipfsPinVerificationFailuresTotal = createMetric(promClient.Counter, {
  name: "ipfs_pin_verification_failures_total",
  help: "Total IPFS uploads whose pin could not be verified after retries",
  labelNames: ["reason"],
});

/** Total XLM price fetch failures, including fallback attempts. */
const xlmPriceFetchErrorsTotal = createMetric(promClient.Counter, {
  name: "xlm_price_fetch_errors_total",
  help: "Total XLM/USD price fetch failures across all providers",
});

// ─── Indexer metrics (Issue #1827) ──────────────────────────────────────────
/** Current lag in seconds of the Horizon indexer compared to wall-clock time. */
const indexerLagSeconds = createMetric(promClient.Gauge, {
  name: "indexer_lag_seconds",
  help: "Lag in seconds between wall-clock time and the last processed Horizon transaction/event timestamp",
});

const legacyIndexerLagSeconds = createMetric(promClient.Gauge, {
  name: "marketpay_indexer_lag_seconds",
  help: "Lag in seconds between wall-clock time and the last processed Horizon transaction/event timestamp (legacy name)",
});

/** Last processed Stellar ledger sequence number. */
const indexerLastLedger = createMetric(promClient.Gauge, {
  name: "indexer_last_ledger",
  help: "Last processed Stellar ledger sequence number",
});

const legacyIndexerLastLedger = createMetric(promClient.Gauge, {
  name: "marketpay_indexer_last_ledger",
  help: "Last processed Stellar ledger sequence number (legacy name)",
});

/** Horizon indexer synchronization status (1 = synced/healthy, 0 = stalled/error/stopped). */
const indexerSyncStatus = createMetric(promClient.Gauge, {
  name: "indexer_sync_status",
  help: "Horizon indexer synchronization status (1 = synced and running, 0 = stalled/stopped/error)",
});

const legacyIndexerSyncStatus = createMetric(promClient.Gauge, {
  name: "marketpay_indexer_sync_status",
  help: "Horizon indexer synchronization status (legacy name)",
});

/** Horizon indexer errors counter, labeled by error category. */
const indexerErrorsTotal = createMetric(promClient.Counter, {
  name: "indexer_errors_total",
  help: "Total errors encountered by the Horizon indexer",
  labelNames: ["type"],
});

const legacyIndexerErrorsTotal = createMetric(promClient.Counter, {
  name: "marketpay_indexer_errors_total",
  help: "Total errors encountered by the Horizon indexer (legacy name)",
  labelNames: ["type"],
});

// ─── Scheduler metrics (Issue #1827) ─────────────────────────────────────────
/** Unix epoch timestamp of the last successful escrow timeout checker execution. */
const escrowTimeoutCheckerLastRunTimestampSeconds = createMetric(promClient.Gauge, {
  name: "escrow_timeout_checker_last_run_timestamp_seconds",
  help: "Unix timestamp in seconds of the last execution of the escrow timeout checker",
});

const legacyEscrowTimeoutCheckerLastRunTimestampSeconds = createMetric(promClient.Gauge, {
  name: "marketpay_escrow_timeout_checker_last_run_timestamp_seconds",
  help: "Unix timestamp in seconds of the last execution of the escrow timeout checker (legacy name)",
});

/** Execution counter for the escrow timeout checker. */
const escrowTimeoutCheckerRunsTotal = createMetric(promClient.Counter, {
  name: "escrow_timeout_checker_runs_total",
  help: "Total runs of the escrow timeout checker",
  labelNames: ["status"],
});

const legacyEscrowTimeoutCheckerRunsTotal = createMetric(promClient.Counter, {
  name: "marketpay_escrow_timeout_checker_runs_total",
  help: "Total runs of the escrow timeout checker (legacy name)",
  labelNames: ["status"],
});

/** Duration of escrow timeout checker runs in seconds. */
const escrowTimeoutCheckerDurationSeconds = createMetric(promClient.Histogram, {
  name: "escrow_timeout_checker_duration_seconds",
  help: "Duration of escrow timeout checker execution in seconds",
  buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30],
});

const legacyEscrowTimeoutCheckerDurationSeconds = createMetric(promClient.Histogram, {
  name: "marketpay_escrow_timeout_checker_duration_seconds",
  help: "Duration of escrow timeout checker execution in seconds (legacy name)",
  buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30],
});

// ─── Database migration metrics (Issue #1827) ────────────────────────────────
/** Database migration status (1 = up to date with disk, 0 = pending or error). */
const dbMigrationStatus = createMetric(promClient.Gauge, {
  name: "db_migration_status",
  help: "Database migration status (1 = current matches expected, 0 = mismatch/failed)",
});

const legacyDbMigrationStatus = createMetric(promClient.Gauge, {
  name: "marketpay_db_migration_status",
  help: "Database migration status (legacy name)",
});

const dbMigrationCurrentVersion = createMetric(promClient.Gauge, {
  name: "db_migration_current_version",
  help: "Current applied database migration version number",
});

const dbMigrationExpectedVersion = createMetric(promClient.Gauge, {
  name: "db_migration_expected_version",
  help: "Expected database migration version number found in migration files",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SQL_VERB = /^[\s(]*(select|insert|update|delete|with|begin|commit|rollback|create|alter|drop|truncate|copy|explain|set|listen|notify)\b/i;

/**
 * Derive a low-cardinality label from a SQL string.
 *
 * Only the leading verb is used — never the full statement — so the metric
 * cannot explode in cardinality or leak query parameters.
 *
 * @param {string|object} sql query text or pg query config
 * @returns {string} lowercase SQL verb, or "other"
 */
function sqlOperation(sql) {
  const text = typeof sql === "string" ? sql : sql && sql.text;
  if (typeof text !== "string") return "other";
  const match = SQL_VERB.exec(text);
  return match ? match[1].toLowerCase() : "other";
}

// Segment patterns that represent a variable path parameter. Anything matching
// is collapsed to ":id" so URLs like /api/jobs/8123 do not each become their
// own time series.
const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STELLAR_SEGMENT = /^[GMC][A-Z2-7]{55}$/;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const LONG_OPAQUE_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;

/**
 * Collapse a concrete request path into a bounded-cardinality route label.
 *
 * Used when Express cannot give us the matched route pattern (404s, and error
 * responses written after the router has unwound `req.baseUrl`).
 *
 * @param {string} rawPath request path, e.g. "/api/jobs/8123/bids"
 * @returns {string} normalised label, e.g. "/api/jobs/:id/bids"
 */
function normalizeRoutePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return "/";
  const [pathOnly] = rawPath.split("?");
  const segments = pathOnly.split("/").filter(Boolean).map((segment) => {
    const decoded = (() => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })();
    if (
      NUMERIC_SEGMENT.test(decoded) ||
      UUID_SEGMENT.test(decoded) ||
      STELLAR_SEGMENT.test(decoded) ||
      HEX_SEGMENT.test(decoded) ||
      LONG_OPAQUE_SEGMENT.test(decoded)
    ) {
      return ":id";
    }
    // Hard cap on segment length so a pathological URL cannot bloat a label.
    return decoded.length > 40 ? ":id" : decoded;
  });
  return segments.length ? `/${segments.join("/")}` : "/";
}

/**
 * Choose the best bounded-cardinality route label for a request.
 *
 * Express exposes the matched pattern on `req.route.path`, but by the time a
 * response is written by an error handler the router has already restored
 * `req.baseUrl` to "" — yielding a truncated label such as ":id" instead of
 * "/api/jobs/:id". We therefore accept the matched pattern only when it has the
 * same number of path segments as the actual URL, and otherwise fall back to a
 * normalised version of the URL itself.
 *
 * @param {string|null} matchedPattern `${req.baseUrl}${req.route.path}` if known
 * @param {string}      originalUrl    the full request URL
 * @returns {string} route label
 */
function resolveRouteLabel(matchedPattern, originalUrl) {
  const normalized = normalizeRoutePath(originalUrl);
  if (!matchedPattern) return normalized;

  const segmentCount = (value) => value.split("/").filter(Boolean).length;
  if (segmentCount(matchedPattern) !== segmentCount(normalized)) {
    return normalized;
  }
  return matchedPattern;
}

/**
 * Record one HTTP request in both the canonical and legacy series.
 *
 * @param {object} labels          metric labels
 * @param {string} labels.method   HTTP method
 * @param {string} labels.route    matched route (never the raw URL)
 * @param {string} labels.status_code response status
 * @param {number} durationMs      wall-clock duration in milliseconds
 */
function observeHttpRequest(labels, durationMs) {
  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, durationMs);
  legacyHttpRequestsTotal.inc(labels);
  legacyHttpRequestDurationSeconds.observe(labels, durationMs / 1000);
}

/**
 * Record one pool query.
 *
 * @param {string} operation  SQL verb label
 * @param {string} status     "success" | "error"
 * @param {number} durationMs wall-clock duration in milliseconds
 */
function observePoolQuery(operation, status, durationMs) {
  poolQueryDurationMs.observe({ operation, status }, durationMs);
  poolQueriesTotal.inc({ operation, status });
}

/**
 * Update the WebSocket gauges for a channel.
 *
 * @param {string} channel channel name ("realtime", "scope", …)
 * @param {number} count   number of open sockets on that channel
 */
function setWebsocketConnections(channel, count) {
  activeWebsocketConnections.set({ channel }, count);
  if (channel === "realtime") legacyWsConnectionsActive.set(count);
}

// Bounded failure-reason set for escrow releases. Raw error messages are never
// used as label values (cardinality + PII safety).
const ESCROW_RELEASE_REASONS = [
  ["insufficient_balance", /insufficient|balance/],
  ["network", /horizon|network|fetch|timeout|econn|socket/],
  ["not_found", /not found|no escrow|already released|not in progress/],
];

/**
 * Classify an escrow release failure into a bounded `reason` label.
 *
 * @param {Error|*} err error thrown while releasing escrow
 * @returns {string} insufficient_balance | network | not_found | contract_error
 */
function escrowReleaseReason(err) {
  const message = String((err && err.message) || "").toLowerCase();
  for (const [reason, pattern] of ESCROW_RELEASE_REASONS) {
    if (pattern.test(message)) return reason;
  }
  return "contract_error";
}

/**
 * Record one escrow release attempt.
 *
 * @param {boolean} ok   whether the release succeeded
 * @param {Error}  [err] the thrown error when `ok` is false
 */
function recordEscrowRelease(ok, err) {
  escrowReleasesTotal.inc({ result: ok ? "success" : "error" });
  if (!ok) escrowReleaseErrorsTotal.inc({ reason: escrowReleaseReason(err) });
}

/**
 * Record a cache hit for the named cache.
 *
 * @param {string} cache cache name, e.g. "insights"
 */
function recordCacheHit(cache) {
  cacheHitsTotal.inc({ cache });
}

/**
 * Record a cache miss for the named cache.
 *
 * @param {string} cache cache name, e.g. "insights"
 */
function recordCacheMiss(cache) {
  cacheMissesTotal.inc({ cache });
}

/**
 * Record indexer checkpoint, progress and lag state.
 *
 * @param {object} params
 * @param {number|null} [params.ledger]
 * @param {string|Date|null} [params.lastTransactionAt]
 * @param {boolean} [params.synced]
 * @param {boolean} [params.running]
 */
function recordIndexerCheckpoint({ ledger, lastTransactionAt, synced, running = true }) {
  if (typeof ledger === "number" && !Number.isNaN(ledger)) {
    indexerLastLedger.set(ledger);
    legacyIndexerLastLedger.set(ledger);
  }
  const isHealthy = Boolean(running && synced);
  indexerSyncStatus.set(isHealthy ? 1 : 0);
  legacyIndexerSyncStatus.set(isHealthy ? 1 : 0);

  if (lastTransactionAt) {
    const txTime = new Date(lastTransactionAt).getTime();
    if (!Number.isNaN(txTime)) {
      const lagSec = Math.max(0, (Date.now() - txTime) / 1000);
      indexerLagSeconds.set(lagSec);
      legacyIndexerLagSeconds.set(lagSec);
    }
  }
}

/**
 * Record an indexer processing or stream error.
 *
 * @param {"transaction"|"event"|"contract_tx"|"checkpoint"|string} type
 */
function recordIndexerError(type) {
  const bounded = ["transaction", "event", "contract_tx", "checkpoint"].includes(type)
    ? type
    : "other";
  indexerErrorsTotal.inc({ type: bounded });
  legacyIndexerErrorsTotal.inc({ type: bounded });
}

/**
 * Record an execution of the escrow timeout checker scheduler.
 *
 * @param {object} params
 * @param {number} [params.durationMs] duration in milliseconds
 * @param {boolean} [params.ok=true] whether check succeeded
 */
function recordEscrowTimeoutCheck({ durationMs, ok = true }) {
  const nowSec = Math.floor(Date.now() / 1000);
  escrowTimeoutCheckerLastRunTimestampSeconds.set(nowSec);
  legacyEscrowTimeoutCheckerLastRunTimestampSeconds.set(nowSec);

  const status = ok ? "success" : "error";
  escrowTimeoutCheckerRunsTotal.inc({ status });
  legacyEscrowTimeoutCheckerRunsTotal.inc({ status });

  if (typeof durationMs === "number" && durationMs >= 0) {
    const sec = durationMs / 1000;
    escrowTimeoutCheckerDurationSeconds.observe(sec);
    legacyEscrowTimeoutCheckerDurationSeconds.observe(sec);
  }
}

/**
 * Record database migration versions and health.
 *
 * @param {number|null} current
 * @param {number|null} expected
 * @param {boolean} [ok]
 */
function recordMigrationStatus(current, expected, ok) {
  if (typeof current === "number" && !Number.isNaN(current)) {
    dbMigrationCurrentVersion.set(current);
  }
  if (typeof expected === "number" && !Number.isNaN(expected)) {
    dbMigrationExpectedVersion.set(expected);
  }
  const isOk = ok !== undefined ? Boolean(ok) : (current !== null && expected !== null && current === expected);
  dbMigrationStatus.set(isOk ? 1 : 0);
  legacyDbMigrationStatus.set(isOk ? 1 : 0);
}

/**
 * Render the registry in Prometheus text exposition format.
 *
 * @returns {Promise<string>} metrics payload
 */
function renderMetrics() {
  return registry.metrics();
}

module.exports = {
  promClient,
  registry,
  contentType: registry.contentType,
  // canonical metrics
  httpRequestsTotal,
  httpRequestDurationMs,
  activeWebsocketConnections,
  poolQueryDurationMs,
  poolQueriesTotal,
  escrowReleasesTotal,
  escrowReleaseErrorsTotal,
  // indexer metrics
  indexerLagSeconds,
  indexerLastLedger,
  indexerSyncStatus,
  indexerErrorsTotal,
  // scheduler metrics
  escrowTimeoutCheckerLastRunTimestampSeconds,
  escrowTimeoutCheckerRunsTotal,
  escrowTimeoutCheckerDurationSeconds,
  // migration metrics
  dbMigrationStatus,
  dbMigrationCurrentVersion,
  dbMigrationExpectedVersion,
  // supporting metrics
  dbConnections,
  pgPoolTotal,
  pgPoolIdle,
  pgPoolWaiting,
  pgPoolWaitingConnections,
  notificationQueuePending,
  xlmPriceUsd,
  ipfsPinVerificationFailuresTotal,
  xlmPriceFetchErrorsTotal,
  // cache metrics
  cacheHitsTotal,
  cacheMissesTotal,
  // legacy aliases
  legacyHttpRequestsTotal,
  legacyHttpRequestDurationSeconds,
  legacyWsConnectionsActive,
  legacyIndexerLagSeconds,
  legacyIndexerLastLedger,
  legacyIndexerSyncStatus,
  legacyIndexerErrorsTotal,
  legacyEscrowTimeoutCheckerLastRunTimestampSeconds,
  legacyEscrowTimeoutCheckerRunsTotal,
  legacyEscrowTimeoutCheckerDurationSeconds,
  legacyDbMigrationStatus,
  // helpers
  normalizeRoutePath,
  resolveRouteLabel,
  sqlOperation,
  observeHttpRequest,
  observePoolQuery,
  setWebsocketConnections,
  recordEscrowRelease,
  escrowReleaseReason,
  recordCacheHit,
  recordCacheMiss,
  recordIndexerCheckpoint,
  recordIndexerError,
  recordEscrowTimeoutCheck,
  recordMigrationStatus,
  renderMetrics,
};
