# Prometheus Metrics

The Express API exports Prometheus metrics on `GET /metrics` in the standard text exposition format (`text/plain; version=0.0.4`). Metrics are collected via `prom-client` and exposed through a centralised registry (`backend/src/metrics.js`).

---

## Metric Reference Table

The table below lists all custom application metrics exported by the backend API:

| Metric Name                                          | Type      | Labels                           | Description                                                                     |
| ---------------------------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `http_requests_total`                                | Counter   | `method`, `route`, `status_code` | Total HTTP requests handled by the API                                          |
| `http_request_duration_ms`                           | Histogram | `method`, `route`, `status_code` | HTTP request duration in **milliseconds**                                       |
| `active_websocket_connections`                       | Gauge     | `channel`                        | Currently open WebSocket connections per channel                                |
| `pool_queries_total`                                 | Counter   | `operation`, `status`            | Total PostgreSQL queries executed through the shared pool                       |
| `pool_query_duration_ms`                             | Histogram | `operation`, `status`            | PostgreSQL pool query latency in **milliseconds**                               |
| `marketpay_db_connections`                           | Gauge     | `state`                          | Current PostgreSQL pool connection counts by state (`total`, `idle`, `waiting`) |
| `pg_pool_total`                                      | Gauge     | _None_                           | Total PostgreSQL connections allocated in the pool                              |
| `pg_pool_idle`                                       | Gauge     | _None_                           | Idle PostgreSQL connections available in the pool                               |
| `pg_pool_waiting`                                    | Gauge     | _None_                           | Client requests waiting for an available database connection                    |
| `notification_queue_pending`                         | Gauge     | _None_                           | Pending outbound notifications queued for processing                            |
| `ipfs_pin_verification_failures_total`               | Counter   | `reason`                         | IPFS uploads whose pin could not be verified after retries (`not_pinned`, `api_error`, `invalid_cid`) |
| `stellar_marketpay_horizon_request_duration_seconds` | Histogram | `method`, `status`               | Outbound Horizon API request duration in **seconds**                            |
| `marketpay_http_requests_total`                      | Counter   | `method`, `route`, `status_code` | _(Legacy alias)_ Total HTTP requests handled                                    |
| `marketpay_http_request_duration_seconds`            | Histogram | `method`, `route`, `status_code` | _(Legacy alias)_ HTTP request latency in **seconds**                            |
| `ws_connections_active`                              | Gauge     | _None_                           | _(Legacy alias)_ Active WebSocket connections on `realtime` channel             |
| `marketpay_*`                                        | Various   | Various                          | Node.js process and runtime default metrics                                     |

---

## Detailed Metric Definitions & PromQL Examples

### 1. HTTP Request Metrics

#### `http_requests_total`

- **Type**: `Counter`
- **Description**: Tracks the cumulative number of HTTP requests processed by the API server.
- **Labels**:
  - `method`: HTTP method (e.g. `GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
  - `route`: Matched Express route pattern (e.g. `/api/jobs/:id`) or normalised URL for unmapped/404 routes.
  - `status_code`: HTTP response status code (e.g. `200`, `201`, `400`, `401`, `404`, `500`).
- **Example PromQL Queries**:
  - **Overall request rate (req/s) over 5m window**:
    ```promql
    sum(rate(http_requests_total{job="marketpay-backend"}[5m]))
    ```
  - **Top 10 highest-traffic routes**:
    ```promql
    topk(10, sum by (route, method) (rate(http_requests_total{job="marketpay-backend"}[5m])))
    ```
  - **5xx Server Error Rate (%)**:
    ```promql
    100 * sum(rate(http_requests_total{job="marketpay-backend",status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total{job="marketpay-backend"}[5m])), 0.001)
    ```
  - **Request throughput broken down by status code**:
    ```promql
    sum by (status_code) (rate(http_requests_total{job="marketpay-backend"}[5m]))
    ```

#### `http_request_duration_ms`

- **Type**: `Histogram`
- **Description**: Wall-clock execution duration of HTTP requests measured in **milliseconds**.
- **Labels**: `method`, `route`, `status_code`
- **Histogram Buckets**: `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]` ms
- **Example PromQL Queries**:
  - **p95 and p99 request latency**:
    ```promql
    histogram_quantile(0.95, sum(rate(http_request_duration_ms_bucket{job="marketpay-backend"}[5m])) by (le))
    ```
    ```promql
    histogram_quantile(0.99, sum(rate(http_request_duration_ms_bucket{job="marketpay-backend"}[5m])) by (le))
    ```
  - **p95 latency grouped by route**:
    ```promql
    topk(10, histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_ms_bucket{job="marketpay-backend"}[5m]))))
    ```
  - **Average request duration (ms)**:
    ```promql
    sum(rate(http_request_duration_ms_sum{job="marketpay-backend"}[5m])) / sum(rate(http_request_duration_ms_count{job="marketpay-backend"}[5m]))
    ```

---

### 2. WebSocket Metrics

#### `active_websocket_connections`

- **Type**: `Gauge`
- **Description**: Real-time count of open WebSocket connections maintained by the API server.
- **Labels**:
  - `channel`: Channel name or namespace (e.g. `realtime`, `scope`).
- **Example PromQL Queries**:
  - **Active connections per channel**:
    ```promql
    active_websocket_connections{job="marketpay-backend"}
    ```
  - **Total active WebSocket connections across all channels**:
    ```promql
    sum(active_websocket_connections{job="marketpay-backend"})
    ```
  - **Connection rate of change (derivative over 5m)**:
    ```promql
    sum(deriv(active_websocket_connections{job="marketpay-backend"}[5m]))
    ```

---

### 3. Database Pool Metrics

Database metrics are instrumented through the shared PostgreSQL connection pool (`backend/src/db/pool.js`).

#### `pool_queries_total`

- **Type**: `Counter`
- **Description**: Cumulative count of SQL queries executed through the connection pool.
- **Labels**:
  - `operation`: Normalised lowercase SQL verb (`select`, `insert`, `update`, `delete`, `with`, `begin`, `commit`, `rollback`, `create`, `alter`, `drop`, `truncate`, `copy`, `explain`, `set`, `listen`, `notify`, or `other`).
  - `status`: `"success"` or `"error"`.
- **Example PromQL Queries**:
  - **Query throughput (queries/s) by operation**:
    ```promql
    sum by (operation) (rate(pool_queries_total{job="marketpay-backend"}[5m]))
    ```
  - **Failed queries per second**:
    ```promql
    sum by (operation) (rate(pool_queries_total{job="marketpay-backend",status="error"}[5m]))
    ```
  - **Database error percentage**:
    ```promql
    100 * sum(rate(pool_queries_total{job="marketpay-backend",status="error"}[5m])) / clamp_min(sum(rate(pool_queries_total{job="marketpay-backend"}[5m])), 0.001)
    ```

#### `pool_query_duration_ms`

- **Type**: `Histogram`
- **Description**: Wall-clock execution time for PostgreSQL queries in **milliseconds**.
- **Labels**:
  - `operation`: Normalised lowercase SQL verb.
  - `status`: `"success"` or `"error"`.
- **Histogram Buckets**: `[1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]` ms
- **Example PromQL Queries**:
  - **p95 query execution latency**:
    ```promql
    histogram_quantile(0.95, sum(rate(pool_query_duration_ms_bucket{job="marketpay-backend"}[5m])) by (le))
    ```
  - **p99 query latency by operation**:
    ```promql
    histogram_quantile(0.99, sum by (operation, le) (rate(pool_query_duration_ms_bucket{job="marketpay-backend"}[5m])))
    ```
  - **Average query duration (ms) for SELECT queries**:
    ```promql
    sum(rate(pool_query_duration_ms_sum{job="marketpay-backend",operation="select"}[5m])) / sum(rate(pool_query_duration_ms_count{job="marketpay-backend",operation="select"}[5m]))
    ```

#### `marketpay_db_connections`

- **Type**: `Gauge`
- **Description**: Current connection count in the shared PostgreSQL pool, partitioned by connection state.
- **Labels**:
  - `state`: Connection state:
    - `total`: Total allocated connections currently managed by the pool.
    - `idle`: Available connections sitting idle in the pool.
    - `waiting`: Client requests waiting for an available connection from a saturated pool.
- **Example PromQL Queries**:
  - **Connection pool breakdown by state**:
    ```promql
    marketpay_db_connections{job="marketpay-backend"}
    ```
  - **Active connections currently in use**:
    ```promql
    marketpay_db_connections{job="marketpay-backend",state="total"} - marketpay_db_connections{job="marketpay-backend",state="idle"}
    ```
  - **Connection pool utilization percentage**:
    ```promql
    100 * (marketpay_db_connections{job="marketpay-backend",state="total"} - marketpay_db_connections{job="marketpay-backend",state="idle"}) / clamp_min(marketpay_db_connections{job="marketpay-backend",state="total"}, 1)
    ```

#### `pg_pool_total`

- **Type**: `Gauge`
- **Description**: Total number of database connections allocated in the pool (idle + active).
- **Labels**: _None_
- **Example PromQL Query**:
  ```promql
  pg_pool_total{job="marketpay-backend"}
  ```

#### `pg_pool_idle`

- **Type**: `Gauge`
- **Description**: Number of idle database connections currently ready to serve queries.
- **Labels**: _None_
- **Example PromQL Query**:
  ```promql
  pg_pool_idle{job="marketpay-backend"}
  ```

#### `pg_pool_waiting`

- **Type**: `Gauge`
- **Description**: Number of requests waiting for an available connection when the pool is at capacity.
- **Labels**: _None_
- **Example PromQL Query**:
  ```promql
  pg_pool_waiting{job="marketpay-backend"}
  ```
  - **Pool exhaustion alert condition**:
    ```promql
    pg_pool_waiting{job="marketpay-backend"} > 0
    ```

---

### 4. Background Queue Metrics

#### `notification_queue_pending`

- **Type**: `Gauge`
- **Description**: Number of pending outbound notifications waiting in the delivery queue backlog.
- **Labels**: _None_
- **Example PromQL Queries**:
  - **Current pending notification backlog**:
    ```promql
    notification_queue_pending{job="marketpay-backend"}
    ```
  - **Backlog growth rate (derivative over 5m)**:
    ```promql
    deriv(notification_queue_pending{job="marketpay-backend"}[5m])
    ```

---

### 4.1 IPFS Pin Verification (Issue #1439)

#### `ipfs_pin_verification_failures_total`

- **Type**: `Counter`
- **Description**: Incremented when an IPFS upload returns a CID but the pin cannot be confirmed after retrying (3 attempts, 2s apart). Such a CID may be garbage-collected by the provider, so the row is stored with `dispute_evidence.pinned = false` for reconciliation.
- **Labels**:
  - `reason`: `not_pinned` (provider responded, pin absent), `api_error` (provider unreachable/error), `invalid_cid` (empty/malformed CID).
- **Example PromQL Queries**:
  - **Pin failures in the last 15 minutes**:
    ```promql
    increase(ipfs_pin_verification_failures_total{job="marketpay-backend"}[15m])
    ```
  - **Failures broken down by reason**:
    ```promql
    sum by (reason) (rate(ipfs_pin_verification_failures_total{job="marketpay-backend"}[1h]))
    ```

---

### 5. Stellar Horizon Client Metrics

Outbound Horizon RPC calls (`backend/src/utils/horizonClient.js`) are instrumented with latency tracking, concurrency limiting (max 5), and automatic exponential retry on HTTP 429.

#### `stellar_marketpay_horizon_request_duration_seconds`

- **Type**: `Histogram`
- **Description**: Latency of outbound Stellar Horizon API calls in **seconds**.
- **Labels**:
  - `method`: Horizon API operation or endpoint identifier (e.g. `loadAccount`, `submitTransaction`).
  - `status`: `"success"` or `"error"`.
- **Histogram Buckets**: `[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]` seconds
- **Example PromQL Queries**:
  - **p95 Horizon request latency**:
    ```promql
    histogram_quantile(0.95, sum(rate(stellar_marketpay_horizon_request_duration_seconds_bucket[5m])) by (le))
    ```
  - **Horizon request throughput by status**:
    ```promql
    sum by (status) (rate(stellar_marketpay_horizon_request_duration_seconds_count[5m]))
    ```
  - **Horizon call failure rate (%)**:
    ```promql
    100 * sum(rate(stellar_marketpay_horizon_request_duration_seconds_count{status="error"}[5m])) / clamp_min(sum(rate(stellar_marketpay_horizon_request_duration_seconds_count[5m])), 0.001)
    ```

---

### 6. Legacy Series (Backwards Compatibility)

These legacy series are emitted alongside canonical series to prevent breaking pre-existing dashboards or alerting rules:

#### `marketpay_http_requests_total`

- **Type**: `Counter`
- **Labels**: `method`, `route`, `status_code`
- **Description**: Legacy alias for `http_requests_total`.
- **Example PromQL**:
  ```promql
  sum(rate(marketpay_http_requests_total[5m]))
  ```

#### `marketpay_http_request_duration_seconds`

- **Type**: `Histogram` (seconds)
- **Labels**: `method`, `route`, `status_code`
- **Buckets**: `[0.05, 0.1, 0.25, 0.5, 1, 2, 5]` seconds
- **Description**: Legacy alias for HTTP request duration, exposed in seconds.
- **Example PromQL**:
  ```promql
  histogram_quantile(0.99, sum(rate(marketpay_http_request_duration_seconds_bucket[5m])) by (le))
  ```

#### `ws_connections_active`

- **Type**: `Gauge`
- **Labels**: _None_
- **Description**: Legacy unlabelled gauge tracking active connections on the `realtime` channel.
- **Example PromQL**:
  ```promql
  ws_connections_active
  ```

---

### 7. Node.js & Process Default Metrics

Default metrics from `promClient.collectDefaultMetrics` are registered under the prefix `marketpay_`.

| Metric Name                                  | Type    | Description                               |
| -------------------------------------------- | ------- | ----------------------------------------- |
| `marketpay_process_cpu_user_seconds_total`   | Counter | Total user CPU time spent in seconds      |
| `marketpay_process_cpu_system_seconds_total` | Counter | Total system CPU time spent in seconds    |
| `marketpay_process_resident_memory_bytes`    | Gauge   | Resident set size (RSS) in bytes          |
| `marketpay_nodejs_heap_size_total_bytes`     | Gauge   | Total V8 heap size in bytes               |
| `marketpay_nodejs_heap_size_used_bytes`      | Gauge   | Used V8 heap size in bytes                |
| `marketpay_nodejs_eventloop_lag_p99_seconds` | Gauge   | 99th percentile event loop lag in seconds |
| `marketpay_nodejs_active_handles_total`      | Gauge   | Total number of active libuv handles      |

**Example PromQL Queries**:

- **Process CPU utilization (%)**:
  ```promql
  rate(marketpay_process_cpu_user_seconds_total{job="marketpay-backend"}[5m]) * 100
  ```
- **Heap memory utilization (%)**:
  ```promql
  100 * marketpay_nodejs_heap_size_used_bytes{job="marketpay-backend"} / marketpay_nodejs_heap_size_total_bytes{job="marketpay-backend"}
  ```
- **Event loop lag p99**:
  ```promql
  marketpay_nodejs_eventloop_lag_p99_seconds{job="marketpay-backend"}
  ```

---

## Cardinality Safety

Two core mechanisms ensure label cardinality remains strictly bounded:

- **Route labels (`route`)**:
  - Matched Express routes use their route template (e.g. `/api/jobs/:id`).
  - Unmatched routes, 404s, or paths unwound during error handling are normalised through `normalizeRoutePath`.
  - Numeric IDs (`123`), UUIDs (`[0-9a-f-]{36}`), Stellar public keys (`G...`), hex hashes, and long opaque segments are collapsed to `:id`.
- **SQL labels (`operation`)**:
  - Extracted via `sqlOperation` to inspect only the leading SQL verb (`select`, `insert`, `update`, etc.).
  - Full SQL statements, table identifiers, and bind parameters are **never** used as metric labels.

---

## Authentication & Security

The `/metrics` endpoint is protected by an internal authentication guard (`backend/src/middleware/metricsAuth.js`). Access is permitted when **either** condition is met:

1. **Bearer Token Authentication**:
   - The request contains `Authorization: Bearer <token>` or `X-Metrics-Token: <token>`.
   - The token matches `process.env.METRICS_TOKEN` (or legacy `process.env.METRICS_SECRET`) checked using constant-time comparison (`crypto.timingSafeEqual`).
2. **Private Network Access**:
   - The client IP originates from loopback (`127.0.0.1`, `::1`) or private network ranges (RFC 1918 / ULA: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`).
   - Can be disabled in production by setting `METRICS_ALLOW_PRIVATE_NETWORK=false`.

Failed authentication returns `401 Unauthorized` with a `WWW-Authenticate: Bearer` challenge.

### Environment Variables

| Variable                        | Default   | Purpose                                                                    |
| ------------------------------- | --------- | -------------------------------------------------------------------------- |
| `METRICS_TOKEN`                 | _(unset)_ | Secret token required to scrape `/metrics`                                 |
| `METRICS_SECRET`                | _(unset)_ | Legacy alias for `METRICS_TOKEN`                                           |
| `METRICS_ALLOW_PRIVATE_NETWORK` | `true`    | Set to `false` to mandate token authentication even within private subnets |

**Recommended production configuration**:

```bash
METRICS_TOKEN=<generated-32-byte-hex-secret>
METRICS_ALLOW_PRIVATE_NETWORK=false
```

---

## Monitoring Stack Configuration

The repository includes ready-to-use Prometheus scrape jobs, alerting rules, and Grafana dashboards:

| File                                                           | Purpose                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `monitoring/prometheus/prometheus.yml`                         | Scrape job configuration targeting `backend:4000/metrics` every 15s                    |
| `monitoring/prometheus/rules/alerts.yml`                       | Prometheus alert definitions (p99 latency, 5xx error rate, pool exhaustion, WS spikes) |
| `monitoring/grafana/dashboards/marketpay-backend-metrics.json` | Comprehensive Grafana dashboard (uid `marketpay-backend-metrics`)                      |
| `monitoring/grafana/dashboards/marketpay-overview.json`        | High-level system overview dashboard                                                   |

Grafana automatically provisions dashboards placed in `monitoring/grafana/dashboards`.

---

## Verification & Testing

```bash
# Run unit tests verifying metrics registration, exposition, and auth
npx jest tests/metrics.test.js tests/poolMetrics.test.js --selectProjects unit

# Verify Prometheus configuration and alert rules
promtool check config monitoring/prometheus/prometheus.yml
promtool check rules  monitoring/prometheus/rules/alerts.yml

# Scrape the metrics endpoint locally
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
```
