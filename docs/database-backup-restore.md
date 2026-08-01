# Database Backup & Restore

Stellar MarketPay uses automated PostgreSQL backups compressed with gzip and stored in S3-compatible object storage (AWS S3 or Cloudflare R2).

---

## Backup

### Automated (scheduled)

A GitHub Actions scheduled workflow runs every day at 03:00 UTC:

```yaml
.github/workflows/db-backup.yml
```

It can also be [triggered manually](${{ github.server_url }}/${{ github.repository }}/actions/workflows/db-backup.yml).

### Manual

```bash
./scripts/backup-db.sh
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | S3/R2 access key |
| `AWS_SECRET_ACCESS_KEY` | S3/R2 secret key |
| `AWS_ENDPOINT_URL` | S3-compatible endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`) |
| `AWS_REGION` | Region (default: `auto`) |
| `S3_BUCKET` | Target bucket name |
| `PGHOST` | PostgreSQL host |
| `PGPORT` | PostgreSQL port (default: `5432`) |
| `PGDATABASE` | Database name |
| `PGUSER` | Database user |
| `PGPASSWORD` | Database password |

The backup is stored at:

```
s3://<bucket>/db-backups/<database>-<YYYYMMDDTHHMMSSZ>.sql.gz
s3://<bucket>/db-backups/<database>-latest.sql.gz    (overwritten each run)
```

### Retention

Backups older than 30 days (configurable via `BACKUP_RETENTION_DAYS`) are automatically pruned.

### Production cron container

For production deployments that do not rely on GitHub Actions, a cron container
pattern is used:

```yaml
# docker-compose.prod.yml (snippet)
services:
  db-backup:
    image: postgres:16
    restart: unless-stopped
    volumes:
      - ./scripts:/scripts
      - ~/.aws:/root/.aws:ro
    environment:
      PGHOST: postgres
      PGPORT: '5432'
      PGDATABASE: stellarwork
      PGUSER: ${PGUSER}
      PGPASSWORD: ${PGPASSWORD}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_ENDPOINT_URL: ${AWS_ENDPOINT_URL}
      AWS_REGION: auto
      S3_BUCKET: ${S3_BUCKET}
    entrypoint: |
      sh -c '
        apt-get update -qq && apt-get install -y -qq awscli && apt-get clean
        echo "0 3 * * * root /scripts/backup-db.sh" > /etc/cron.d/marketpay-backup
        cron -f
      '
```

---

## Restore

### List available backups

```bash
./scripts/restore-db.sh --list
```

### Restore the latest backup

```bash
./scripts/restore-db.sh --latest
```

### Restore a specific backup

```bash
./scripts/restore-db.sh stellarwork-20260315T030000Z.sql.gz
```

### What happens

1. The backup is downloaded from S3/R2.
2. All existing connections to the target database are terminated.
3. The database is **dropped and recreated**.
4. The backup is restored via `pg_restore --clean --if-exists`.

### Verification checklist

After restoring:

1. **Run the application** — start the backend and verify health endpoint returns 200.
2. **Spot-check data** — query a few tables: `SELECT count(*) FROM jobs;`, `SELECT count(*) FROM users;`.
3. **Check recent activity** — ensure latest job postings and escrows are present.
4. **Run smoke tests** — `cd backend && npm test`.

---

## Required secrets (GitHub Actions)

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | S3/R2 access key ID |
| `AWS_SECRET_ACCESS_KEY` | S3/R2 secret access key |
| `AWS_ENDPOINT_URL` | e.g. `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | e.g. `stellar-marketpay-backups` |
| `PGHOST` | Database hostname |
| `PGPORT` | Database port |
| `PGDATABASE` | Database name |
| `PGUSER` | Database user |
| `PGPASSWORD` | Database password |
| `SLACK_WEBHOOK_URL` | (optional) Slack webhook for failure alerts |

---

## Architecture

```
┌─────────────┐     pg_dump -Fc -Z9     ┌──────────────────┐
│  PostgreSQL  │ ──────────────────────→ │  gzip'd custom   │
│   (prod)     │                         │  dump (.sql.gz)  │
└─────────────┘                         └────────┬─────────┘
                                                 │
                                        aws s3 cp
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  S3 / R2 Bucket  │
                                        │  (30-day ret.)   │
                                        └──────────────────┘
```
