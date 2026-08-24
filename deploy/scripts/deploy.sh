#!/bin/bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
NGINX_CONF="nginx/nginx.conf"
HEALTH_CHECK_SCRIPT="$(dirname "$0")/health-check.sh"
ROLLBACK_SCRIPT="$(dirname "$0")/rollback.sh"
SWITCH_SCRIPT="$(dirname "$0")/switch-traffic.sh"

MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-5}"
ROLLBACK_WINDOW="${ROLLBACK_WINDOW:-600}"

mkdir -p nginx

get_active_env() {
  if grep -q "server backend-green:4000" "$NGINX_CONF" 2>/dev/null; then
    echo "green"
  else
    echo "blue"
  fi
}

get_standby_env() {
  local active
  active=$(get_active_env)
  if [ "$active" = "green" ]; then
    echo "blue"
  else
    echo "green"
  fi
}

main() {
  local image_tag="${1:-latest}"
  local active standby

  active=$(get_active_env)
  standby=$(get_standby_env)

  echo "=== Blue-Green Deployment ==="
  echo "Active environment:   $active"
  echo "Standby environment:  $standby"
  echo "Image tag:            $image_tag"
  echo ""

  export IMAGE_TAG="$image_tag"
  export BACKEND_IMAGE_TAG="$image_tag"

  echo "--- Step 1: Pull latest images for $standby ---"
  docker compose -f "$COMPOSE_FILE" --profile "$standby" pull

  echo "--- Step 2: Starting standby environment ($standby) ---"
  docker compose -f "$COMPOSE_FILE" --profile "$standby" up -d

  echo "--- Step 3: Health-checking standby environment ($standby) ---"
  if ! "$HEALTH_CHECK_SCRIPT" "$standby" "$MAX_RETRIES" "$RETRY_INTERVAL"; then
    echo "ERROR: Health check failed for $standby environment."
    echo "--- Initiating automated rollback ---"
    "$ROLLBACK_SCRIPT" "$standby" "$active" "$COMPOSE_FILE" "$NGINX_CONF"
    exit 1
  fi

  echo "--- Step 4: Switching traffic to $standby ---"
  if ! "$SWITCH_SCRIPT" "$standby" "$COMPOSE_FILE" "$NGINX_CONF"; then
    echo "ERROR: Traffic switch failed."
    echo "--- Initiating automated rollback ---"
    "$ROLLBACK_SCRIPT" "$standby" "$active" "$COMPOSE_FILE" "$NGINX_CONF"
    exit 1
  fi

  echo "--- Step 5: Scheduling teardown of old environment ($active) in ${ROLLBACK_WINDOW}s ---"
  nohup bash -c "sleep $ROLLBACK_WINDOW && docker compose -f $COMPOSE_FILE --profile $active rm -s -f frontend-$active backend-$active" > /dev/null 2>&1 &

  echo ""
  echo "=== Deployment to $standby successful ==="
  echo "Active environment is now: $standby"
  echo "Old environment ($active) will be torn down in ${ROLLBACK_WINDOW}s."
}

main "$@"