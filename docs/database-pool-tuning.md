# Database Connection Pool Tuning

This document provides recommended settings for the PostgreSQL connection pool to prevent connection exhaustion under load.

## Environment Variables

The following environment variables control the database connection pool behavior in `backend/src/db/pool.js`:

| Variable | Description | Default | Recommended (Production) |
|----------|-------------|---------|-------------------------|
| `DATABASE_POOL_MIN` | Minimum number of connections to maintain in the pool | 2 | 5-10 |
| `DATABASE_POOL_MAX` | Maximum number of connections in the pool | 10 | 20-50 |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | Time in milliseconds before an idle connection is closed | 30000 (30s) | 30000 (30s) |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | Time in milliseconds to wait for a connection before erroring | 5000 (5s) | 2000-5000 |

## Recommended Settings

### Development Environment
```bash
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=5000
```

### Production Environment

For production, tune the pool based on your PostgreSQL server's `max_connections` setting and expected load:

#### Small Application (< 100 concurrent users)
```bash
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=2000
```

#### Medium Application (100-500 concurrent users)
```bash
DATABASE_POOL_MIN=10
DATABASE_POOL_MAX=40
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=2000
```

#### Large Application (500+ concurrent users)
```bash
DATABASE_POOL_MIN=20
DATABASE_POOL_MAX=50
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=2000
```

## Calculation Guidelines

A common formula for determining the optimal pool size is:

```
pool_max = (total_connections - system_connections) / number_of_applications
```

Where:
- `total_connections` = PostgreSQL `max_connections` setting (default: 100)
- `system_connections` = Connections reserved for system tasks (typically 3-5)
- `number_of_applications` = Number of application instances connecting to the database

**Example:** With a PostgreSQL server configured for 100 connections and running 2 application instances:
```
pool_max = (100 - 5) / 2 = 47 (round to 45-50)
```

## Monitoring

Pool statistics are logged every 60 seconds and available via the `/metrics` endpoint:

```json
{
  "total": 10,
  "idle": 8,
  "waiting": 0
}
```

- **total**: Total connections currently in the pool
- **idle**: Connections not currently in use
- **waiting**: Number of requests waiting for an available connection

### Prometheus Metrics

The following Prometheus metrics are exposed at `/metrics`:

- `marketpay_db_connections{state="total|idle|waiting"}`: Current connection counts
- `pg_pool_total`: Total pool connections
- `pg_pool_idle`: Idle pool connections
- `pg_pool_waiting`: Waiting requests

### Alerting

The application automatically logs an error when the pool has more than 5 waiting requests for more than 10 seconds. You can configure a webhook alert via `POOL_ALERT_WEBHOOK_URL`.

## Troubleshooting

### High Waiting Count

If you consistently see a high `waiting` count:
1. Increase `DATABASE_POOL_MAX`
2. Check for long-running queries that are holding connections
3. Consider adding read replicas for read-heavy workloads

### Connection Timeouts

If you experience connection timeouts:
1. Increase `DATABASE_POOL_CONNECTION_TIMEOUT_MS`
2. Check database server performance
3. Verify network latency between application and database

### Idle Connection Exhaustion

If idle connections are not being reused effectively:
1. Decrease `DATABASE_POOL_IDLE_TIMEOUT_MS` to close idle connections faster
2. Review connection usage patterns in your application

## Testing

Run the pool tests to verify configuration and concurrent load handling:

```bash
cd backend
npm test -- pool.test.js
```

The tests verify:
- Pool configuration respects environment variables
- Pool stats are correctly reported
- Pool handles concurrent queries without connection exhaustion
- Connections are properly returned to the pool after use
