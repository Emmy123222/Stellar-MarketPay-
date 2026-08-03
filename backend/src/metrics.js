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

const notificationQueuePending = createMetric(promClient.Gauge, {
  name: "notification_queue_pending",
  help: "Pending notifications in the queue",
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
  // supporting metrics
  dbConnections,
  pgPoolTotal,
  pgPoolIdle,
  pgPoolWaiting,
  notificationQueuePending,
  // legacy aliases
  legacyHttpRequestsTotal,
  legacyHttpRequestDurationSeconds,
  legacyWsConnectionsActive,
  // helpers
  normalizeRoutePath,
  resolveRouteLabel,
  sqlOperation,
  observeHttpRequest,
  observePoolQuery,
  setWebsocketConnections,
  renderMetrics,
};
