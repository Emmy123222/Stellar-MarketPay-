<<<<<<< HEAD
# CDN Setup Documentation

## Environment Variables
- `NEXT_PUBLIC_CDN_URL` – Base URL for static assets served via CDN.
- `IMAGE_CDN_URL` – Base URL for profile image CDN (can be same as above).

## Configuration
The Next.js configuration (`frontend/next.config.mjs`) now uses `assetPrefix` and a custom image loader that references these variables. Cache‑Control headers are added for immutable hashed assets and a shorter TTL for profile images.

## Deployment Steps
1. Deploy a CDN (e.g., Cloudflare) pointing to the Vercel/Next.js deployment.
2. Set the environment variables in your hosting platform.
3. Verify that asset URLs include the CDN prefix and that the correct `Cache‑Control` headers are present.

---

# Infrastructure Notes

## PostgreSQL Read Replica Setup

The backend separates read and write traffic through two named pools exported
from `backend/src/db/pool.js`.

| Export | Pool | Usage |
|---|---|---|
| `writePool` | Primary | `INSERT`, `UPDATE`, `DELETE`, transaction clients |
| `readPool` | Replica (falls back to primary if unavailable) | `SELECT` queries |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Connection string for the primary (write) PostgreSQL instance |
| `DATABASE_READ_URL` | No | Connection string for the read replica. When absent, all reads also go to the primary. |

### Provisioning a Read Replica

**AWS RDS (recommended)**

1. Open your RDS cluster in the console.
2. Choose **Actions → Create read replica**.
3. Copy the replica endpoint and set it as `DATABASE_READ_URL` in your environment.

**Self-managed PostgreSQL**

1. On the primary, enable WAL streaming:
   ```
   wal_level = replica
   max_wal_senders = 3
   ```
2. Create a replication slot and start the replica with `pg_basebackup`.
3. Set `DATABASE_READ_URL` to the replica's connection string.

### Failover Behaviour

If the read replica is unreachable (connection refused, timeout, or
`57P01 admin_shutdown`), `readPool` transparently retries the query against
the primary so the application stays available. A warning is logged:

```
[pg:read] Replica unavailable, falling back to primary for this query
```

No code changes are required in services; the fallback is handled inside
`backend/src/db/pool.js`.

### Local Development

Leave `DATABASE_READ_URL` unset. Both `readPool` and `writePool` will point
to the same local Postgres instance defined by `DATABASE_URL`.
>>>>>>> main
