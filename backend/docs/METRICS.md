# Prometheus Metrics

The Express API exports Prometheus metrics on `GET /metrics` in the standard
text exposition format (`text/plain; version=0.0.4`).

## Required metrics

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `http_requests_total` | counter | `method`, `route`, `status_code` | Total HTTP requests handled by the API |
| `http_request_duration_ms` | histogram | `method`, `route`, `status_code` | Request latency in **milliseconds** |
| `active_websocket_connections` | gauge | `channel` | Open WebSocket connections (`realtime`, `scope`) |
| `pool_query_duration_ms` | histogram | `operation`, `status` | PostgreSQL query latency in **milliseconds** |

### Supporting metrics

| Metric | Type | Description |
| --- | --- | --- |
| `pool_queries_total` | counter | Queries executed through the shared pool |
| `pg_pool_total` / `pg_pool_idle` / `pg_pool_waiting` | gauge | Pool saturation |
| `marketpay_db_connections{state}` | gauge | Pool counts by state |
| `notification_queue_pending` | gauge | Outbound notification backlog |
| `marketpay_*` | various | Node.js/process default metrics |

Legacy series (`marketpay_http_requests_total`,
`marketpay_http_request_duration_seconds`, `ws_connections_active`) are still
emitted so the pre-existing dashboard and alert rules keep working.

## Cardinality safety

Two mechanisms keep label cardinality bounded:

* **Route labels** use the matched Express pattern (`/api/jobs/:id`). When the
  router has already unwound (404s, error handlers), the URL is normalised —
  numeric, UUID, Stellar-key, hex and long opaque segments collapse to `:id`.
* **SQL labels** use only the leading SQL verb (`select`, `insert`, …). Query
  text and bind parameters are never used as labels.

## Authentication

`/metrics` is internal-only. Access is granted when **either** check passes:

1. **Shared token** — `Authorization: Bearer <token>` or `X-Metrics-Token`,
   compared in constant time.
2. **Internal network** — the caller's IP is loopback or RFC1918/ULA private
   space.

A presented-but-incorrect token is always rejected, even from inside the
network. Failures return `401` with a `WWW-Authenticate` challenge (never
`403`, preserving the CSRF-bypass contract for operational endpoints).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `METRICS_TOKEN` | _(unset)_ | Bearer token required to scrape |
| `METRICS_SECRET` | _(unset)_ | Legacy alias for `METRICS_TOKEN` |
| `METRICS_ALLOW_PRIVATE_NETWORK` | `true` | Set `false` to force token auth |

**Recommended production setup:**

```bash
METRICS_TOKEN=<random-32-byte-secret>
METRICS_ALLOW_PRIVATE_NETWORK=false
```

Then uncomment the `authorization` block in
`monitoring/prometheus/prometheus.yml` and mount the same secret at
`/run/secrets/metrics_token`.

## Monitoring stack

| File | Purpose |
| --- | --- |
| `monitoring/prometheus/prometheus.yml` | `marketpay-backend` scrape job (`backend:4000/metrics`, 15s) |
| `monitoring/prometheus/rules/alerts.yml` | Alerts on latency, error rate, slow queries, WS spikes, scrape failure |
| `monitoring/grafana/dashboards/marketpay-backend-metrics.json` | 17-panel dashboard (uid `marketpay-backend-metrics`) |

Grafana auto-provisions dashboards from `/var/lib/grafana/dashboards`, which
`docker-compose.prod.yml` already mounts from `monitoring/grafana/dashboards`.

## Verification

```bash
# Unit tests
npx jest tests/metrics.test.js tests/poolMetrics.test.js --selectProjects unit

# Config validation
promtool check config monitoring/prometheus/prometheus.yml
promtool check rules  monitoring/prometheus/rules/alerts.yml

# Live scrape
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
```
