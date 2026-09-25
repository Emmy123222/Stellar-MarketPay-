#!/bin/bash
set -euo pipefail

ENV_NAME="${1:?Usage: health-check.sh <environment> [max_retries] [retry_interval]}"
MAX_RETRIES="${2:-30}"
RETRY_INTERVAL="${3:-5}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-/api/health}"
CONTAINER_NAME="backend-${ENV_NAME}"

echo "Health-checking backend-${ENV_NAME} on port ${BACKEND_PORT}..."
echo "Endpoint: ${HEALTH_ENDPOINT}"
echo "Max retries: ${MAX_RETRIES}, interval: ${RETRY_INTERVAL}s"

retries=0
while [ $retries -lt "$MAX_RETRIES" ]; do
  retries=$((retries + 1))

  HTTP_STATUS=$(docker exec "$CONTAINER_NAME" wget -qO- "http://localhost:${BACKEND_PORT}${HEALTH_ENDPOINT}" --spider 2>/dev/null && echo "200" || echo "000")

  if [ "$HTTP_STATUS" = "200" ]; then
    echo "backend-${ENV_NAME} is healthy (attempt ${retries}/${MAX_RETRIES})."
    exit 0
  fi

  echo "Health check attempt ${retries}/${MAX_RETRIES} failed (status: ${HTTP_STATUS}). Retrying in ${RETRY_INTERVAL}s..."
  sleep "$RETRY_INTERVAL"
done

echo "ERROR: backend-${ENV_NAME} failed health check after ${MAX_RETRIES} attempts."
exit 1