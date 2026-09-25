#!/bin/bash
set -euo pipefail

TARGET_ENV="${1:?Usage: switch-traffic.sh <environment>}"
COMPOSE_FILE="${2:-docker-compose.prod.yml}"
NGINX_CONF="${3:-nginx/nginx.conf}"

echo "Switching NGINX upstream to $TARGET_ENV..."

mkdir -p "$(dirname "$NGINX_CONF")"

cat <<EOF > "${NGINX_CONF}.tmp"
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream backend_upstream {
        server backend-${TARGET_ENV}:4000;
    }
    upstream frontend_upstream {
        server frontend-${TARGET_ENV}:3000;
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

echo "Traffic switched to $TARGET_ENV."
exit 0