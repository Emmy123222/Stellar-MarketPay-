#!/bin/bash
set -euo pipefail

FAILED_ENV="${1:?Usage: rollback.sh <failed_env> <active_env> <compose_file> <nginx_conf>}"
ACTIVE_ENV="${2:?Missing active environment}"
COMPOSE_FILE="${3:-docker-compose.prod.yml}"
NGINX_CONF="${4:-nginx/nginx.conf}"

echo "=== Automated Rollback ==="
echo "Failed environment: $FAILED_ENV"
echo "Restoring active environment: $ACTIVE_ENV"

echo "--- Stopping failed environment ($FAILED_ENV) ---"
docker compose -f "$COMPOSE_FILE" --profile "$FAILED_ENV" rm -s -f "frontend-$FAILED_ENV" "backend-$FAILED_ENV" 2>/dev/null || true

echo "--- Reloading NGINX to restore $ACTIVE_ENV upstream ---"
mkdir -p "$(dirname "$NGINX_CONF")"

cat <<EOF > "${NGINX_CONF}.tmp"
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream backend_upstream {
        server backend-${ACTIVE_ENV}:4000;
    }
    upstream frontend_upstream {
        server frontend-${ACTIVE_ENV}:3000;
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

docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || true

echo "=== Rollback complete ==="
echo "Traffic restored to $ACTIVE_ENV environment."
exit 1