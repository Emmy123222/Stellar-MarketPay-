#!/usr/bin/env bash
# scripts/restore-db.sh
#
# Stellar MarketPay — Restore a PostgreSQL backup from S3/R2.
#
# Usage:
#   ./scripts/restore-db.sh <backup-key>          # restore a specific backup
#   ./scripts/restore-db.sh --latest               # restore the latest backup
#   ./scripts/restore-db.sh --list                 # list available backups
#
# Required env vars:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   AWS_ENDPOINT_URL, S3_BUCKET
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
#
# WARNING: This will DROP and recreate the target database.

set -euo pipefail

S3_PREFIX="${S3_PREFIX:-db-backups}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/marketpay-restore}"
DB_NAME="${PGDATABASE:-stellarwork}"

command -v pg_restore >/dev/null 2>&1 || { echo "ERROR: pg_restore not found"; exit 1; }
command -v aws        >/dev/null 2>&1 || { echo "ERROR: aws CLI not found";    exit 1; }
command -v gzip       >/dev/null 2>&1 || { echo "ERROR: gzip not found";       exit 1; }

for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY S3_BUCKET PGHOST PGUSER PGPASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

aws_args=(
  --endpoint-url "${AWS_ENDPOINT_URL:-https://s3.amazonaws.com}"
  --region "${AWS_REGION:-auto}"
)

mkdir -p "${BACKUP_DIR}"

# ─── List mode ─────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--list" ]; then
  echo "[restore] Available backups in s3://${S3_BUCKET}/${S3_PREFIX}/:"
  aws s3 ls "${aws_args[@]}" "s3://${S3_BUCKET}/${S3_PREFIX}/" \
    | sort -r \
    | awk '{ printf "  %s  %s  %s\n", $1, $2, $4 }'
  exit 0
fi

# ─── Determine key to restore ──────────────────────────────────────────────────
if [ "${1:-}" = "--latest" ]; then
  BACKUP_KEY="${DB_NAME}-latest.sql.gz"
elif [ -n "${1:-}" ]; then
  BACKUP_KEY="$1"
else
  echo "[restore] Usage: $0 [--latest | --list | <backup-key>]"
  exit 1
fi

S3_URI="s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_KEY}"
LOCAL_FILE="${BACKUP_DIR}/${BACKUP_KEY}"

echo "[restore] Downloading ${S3_URI} …"
aws s3 cp "${aws_args[@]}" "${S3_URI}" "${LOCAL_FILE}"

echo "[restore] Downloaded: $(du -h "${LOCAL_FILE}" | cut -f1)"

# ─── Confirm ───────────────────────────────────────────────────────────────────
echo ""
echo "WARNING: This will DROP and recreate database '${DB_NAME}' on ${PGHOST}:${PGPORT:-5432}"
read -r -p "Are you sure? Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "[restore] Aborted."
  rm -f "${LOCAL_FILE}"
  exit 1
fi

# ─── Restore ───────────────────────────────────────────────────────────────────
echo "[restore] Terminating existing connections to ${DB_NAME} …"
psql --host="${PGHOST}" --port="${PGPORT:-5432}" --username="${PGUSER}" --dbname="postgres" \
  -c "SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
       WHERE pg_stat_activity.datname = '${DB_NAME}'
         AND pid <> pg_backend_pid();" 2>/dev/null || true

echo "[restore] Dropping and recreating database ${DB_NAME} …"
psql --host="${PGHOST}" --port="${PGPORT:-5432}" --username="${PGUSER}" --dbname="postgres" \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql --host="${PGHOST}" --port="${PGPORT:-5432}" --username="${PGUSER}" --dbname="postgres" \
  -c "CREATE DATABASE ${DB_NAME};"

echo "[restore] Restoring from ${LOCAL_FILE} …"
pg_restore \
  --host="${PGHOST}" \
  --port="${PGPORT:-5432}" \
  --dbname="${DB_NAME}" \
  --username="${PGUSER}" \
  --no-password \
  --verbose \
  --clean \
  --if-exists \
  --exit-on-error \
  "${LOCAL_FILE}" \
  2>&1 | sed 's/^/[pg_restore] /'

echo "[restore] Restore complete."
rm -f "${LOCAL_FILE}"
