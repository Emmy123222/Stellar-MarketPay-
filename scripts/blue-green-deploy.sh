#!/bin/bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
NGINX_CONF="nginx/nginx.conf"
MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-5}"
ROLLBACK_WINDOW="${ROLLBACK_WINDOW:-600}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-/api/health}"
BACKEND_PORT="${BACKEND_PORT:-4000}"

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

save_nginx_config() {
  cp "$NGINX_CONF" "${NGINX_CONF}.bak"
}

restore_nginx_config() {
  if [ -f "${NGINX_CONF}.bak" ]; then
    mv "${NGINX_CONF}.bak" "$NGINX_CONF"
    docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || true
    echo "NGINX config restored from backup."
  fi
}

health_check() {
  local env_name="$1"
  local container="backend-${env_name}"
  local retries=0

  echo "Health-checking backend-${env_name} (${HEALTH_ENDPOINT})..."

  while [ $retries -lt "$MAX_RETRIES" ]; do
    retries=$((retries + 1))

    local status
    status=$(docker inspect --format='{{json .State.Health.Status}}' "$container" 2>/dev/null || echo '"unknown"')

    if [ "$status" = '"healthy"' ]; then
      local http_code
      http_code=$(docker exec "$container" wget -qO- "http://localhost:${BACKEND_PORT}${HEALTH_ENDPOINT}" --spider 2>/dev/null && echo "200" || echo "000")

      if [ "$http_code" = "200" ]; then
        echo "backend-${env_name} is healthy (attempt ${retries}/${MAX_RETRIES})."
        return 0
      fi
      echo "Container healthy but endpoint returned ${http_code}. Retrying..."
    else
      echo "Health status: ${status}. Retrying in ${RETRY_INTERVAL}s... (${retries}/${MAX_RETRIES})"
    fi

    sleep "$RETRY_INTERVAL"
  done

  echo "ERROR: backend-${env_name} failed health check after ${MAX_RETRIES} attempts."
  return 1
}

rollback() {
  local failed_env="$1"
  local active_env="$2"

  echo "=== Automated Rollback ==="
  echo "Failed environment: $failed_env"
  echo "Restoring active environment: $active_env"

  docker compose -f "$COMPOSE_FILE" --profile "$failed_env" rm -s -f "frontend-$failed_env" "backend-$failed_env" 2>/dev/null || true

  restore_nginx_config

  echo "=== Rollback complete ==="
  echo "Traffic restored to $active_env environment."
}

main() {
  local active standby

  active=$(get_active_env)
  standby=$(get_standby_env)

  echo "=== Blue-Green Deployment ==="
  echo "Active environment:   $active"
  echo "Standby environment:  $standby"
  echo ""

  save_nginx_config

  echo "--- Pulling latest images for $standby ---"
  docker compose -f "$COMPOSE_FILE" --profile "$standby" pull

  echo "--- Starting standby environment ($standby) ---"
  docker compose -f "$COMPOSE_FILE" --profile "$standby" up -d

  echo "--- Health-checking standby environment ($standby) ---"
  if ! health_check "$standby"; then
    rollback "$standby" "$active"
    exit 1
  fi

  echo "--- Switching NGINX upstream to $standby ---"
  cat <<EOF > "${NGINX_CONF}.tmp"
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream backend_upstream {
        server backend-${standby}:4000;
    }
    upstream frontend_upstream {
        server frontend-${standby}:3000;
    }

    server {
        listen 80;
        server_name _;

        location /api/ {
            proxy_pass http://backend_upstream;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        }

        location / {
            proxy_pass http://frontend_upstream;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        }
    }
}
EOF

  mv "${NGINX_CONF}.tmp" "$NGINX_CONF"

  echo "Reloading NGINX..."
  docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || true

  echo "--- Verifying traffic switch ---"
  sleep 2
  VERIFY_CODE=$(wget -qO- "http://localhost/api/health" --spider 2>/dev/null && echo "200" || echo "000")
  if [ "$VERIFY_CODE" != "200" ]; then
    echo "WARNING: Post-switch verification failed (status: ${VERIFY_CODE}). Initiating rollback."
    rollback "$standby" "$active"
    exit 1
  fi

  echo "--- Scheduling teardown of old environment ($active) in ${ROLLBACK_WINDOW}s ---"
  nohup bash -c "sleep $ROLLBACK_WINDOW && docker compose -f $COMPOSE_FILE --profile $active rm -s -f frontend-$active backend-$active" > /dev/null 2>&1 &

  echo ""
  echo "=== Deployment to $standby successful ==="
  echo "Active environment is now: $standby"
  echo "Old environment ($active) will be torn down in ${ROLLBACK_WINDOW}s."
}

main "$@"
