#!/usr/bin/env bash
# scripts/backup-db.sh
#
# Stellar MarketPay — Automated PostgreSQL backup with gzip + S3/R2 upload.
#
# Usage:
#   ./scripts/backup-db.sh                    # uses env vars (default)
#   ./scripts/backup-db.sh --db-name=mydb     # override database name
#   ./scripts/backup-db.sh --upload-only      # skip pg_dump, upload existing
#
# Required env vars:
#   AWS_ACCESS_KEY_ID       — S3/R2-compatible access key
#   AWS_SECRET_ACCESS_KEY   — S3/R2-compatible secret key
#   AWS_ENDPOINT_URL        — S3 endpoint (e.g. https://<account>.r2.cloudflarestorage.com)
#   AWS_REGION              — region (default: auto)
#   S3_BUCKET               — target bucket
#   S3_PREFIX               — object key prefix (default: "db-backups")
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
#
# Optional:
#   BACKUP_RETENTION_DAYS   — delete backups older than N days (default: 30)
#   BACKUP_DIR              — local temp directory (default: /tmp/marketpay-backups)

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
DB_NAME="${PGDATABASE:-stellarwork}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/marketpay-backups}"
S3_PREFIX="${S3_PREFIX:-db-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="${DB_NAME}-${TIMESTAMP}.sql.gz"
LOCAL_PATH="${BACKUP_DIR}/${FILENAME}"
S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}"
LATEST_S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/${DB_NAME}-latest.sql.gz"

# ─── Pre-flight checks ────────────────────────────────────────────────────────
command -v pg_dump    >/dev/null 2>&1 || { echo "ERROR: pg_dump not found";  exit 1; }
command -v aws        >/dev/null 2>&1 || { echo "ERROR: aws CLI not found";  exit 1; }
command -v gzip       >/dev/null 2>&1 || { echo "ERROR: gzip not found";     exit 1; }

for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY S3_BUCKET PGHOST PGUSER PGPASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

mkdir -p "${BACKUP_DIR}"

# ─── Dump ─────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--upload-only" ]; then
  echo "[backup] Dumping database ${DB_NAME} to ${LOCAL_PATH} …"
  pg_dump \
    --host="${PGHOST}" \
    --port="${PGPORT:-5432}" \
    --dbname="${DB_NAME}" \
    --username="${PGUSER}" \
    --no-password \
    --format=custom \
    --compress=9 \
    --verbose \
    --file="${LOCAL_PATH}" \
    2>&1 | sed 's/^/[pg_dump] /'

  echo "[backup] Dump complete: $(du -h "${LOCAL_PATH}" | cut -f1)"
fi

# ─── Upload ────────────────────────────────────────────────────────────────────
echo "[backup] Uploading to ${S3_PATH} …"

aws_args=(
  --endpoint-url "${AWS_ENDPOINT_URL:-https://s3.amazonaws.com}"
  --region "${AWS_REGION:-auto}"
)

aws s3 cp "${aws_args[@]}" "${LOCAL_PATH}" "${S3_PATH}"

# Also upload as latest (overwrite)
echo "[backup] Updating ${LATEST_S3_PATH} …"
aws s3 cp "${aws_args[@]}" "${LOCAL_PATH}" "${LATEST_S3_PATH}"

echo "[backup] Upload complete."

# ─── Retention: prune old backups ─────────────────────────────────────────────
echo "[backup] Pruning backups older than ${RETENTION_DAYS} days …"
CUTOFF=$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%dT%H%M%SZ 2>/dev/null ||
         date -u -v "-${RETENTION_DAYS}d" +%Y%m%dT%H%M%SZ)

aws s3 ls "${aws_args[@]}" "s3://${S3_BUCKET}/${S3_PREFIX}/" \
  | while read -r _ _ _ key; do
      # Extract timestamp from filename: DB-YYYYMMDDTHHMMSSZ.sql.gz
      TS=$(echo "$key" | grep -oP '\d{8}T\d{6}Z' || true)
      if [ -n "$TS" ] && [ "$TS" \< "$CUTOFF" ] && [ "$key" != "${DB_NAME}-latest.sql.gz" ]; then
        echo "[backup] Deleting old backup: ${key}"
        aws s3 rm "${aws_args[@]}" "s3://${S3_BUCKET}/${S3_PREFIX}/${key}"
      fi
    done

echo "[backup] Done."

# ─── Cleanup local ─────────────────────────────────────────────────────────────
rm -f "${LOCAL_PATH}"
