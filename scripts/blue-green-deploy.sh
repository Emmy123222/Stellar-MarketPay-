#!/bin/bash
set -e

# Constants
COMPOSE_FILE="docker-compose.prod.yml"
NGINX_CONF="nginx/nginx.conf"

# Ensure nginx dir exists
mkdir -p nginx

# Determine current active environment
if grep -q "server backend-green:4000" "$NGINX_CONF" 2>/dev/null; then
  ACTIVE_ENV="green"
  TARGET_ENV="blue"
else
  ACTIVE_ENV="blue"
  TARGET_ENV="green"
fi

echo "Active environment is: $ACTIVE_ENV"
echo "Deploying to target environment: $TARGET_ENV"

# Pull latest images for target
echo "Pulling latest images..."
docker compose -f "$COMPOSE_FILE" --profile "$TARGET_ENV" pull

# Start target environment
echo "Starting target environment ($TARGET_ENV)..."
docker compose -f "$COMPOSE_FILE" --profile "$TARGET_ENV" up -d

# Wait for backend healthcheck
echo "Waiting for backend-$TARGET_ENV to be healthy..."
RETRIES=30
while [ $RETRIES -gt 0 ]; do
  STATUS=$(docker inspect --format='{{json .State.Health.Status}}' "stellarmarketpay-backend-$TARGET_ENV-1" 2>/dev/null || docker inspect --format='{{json .State.Health.Status}}' "backend-$TARGET_ENV" 2>/dev/null || echo '"unknown"')
  if [ "$STATUS" == '"healthy"' ]; then
    echo "backend-$TARGET_ENV is healthy!"
    break
  fi
  echo "Current status: $STATUS. Retrying in 5s... ($RETRIES left)"
  sleep 5
  ((RETRIES--))
done

if [ $RETRIES -eq 0 ]; then
  echo "Target environment failed to become healthy. Rolling back (stopping $TARGET_ENV)."
  docker compose -f "$COMPOSE_FILE" --profile "$TARGET_ENV" rm -s -f "frontend-$TARGET_ENV" "backend-$TARGET_ENV"
  exit 1
fi

# Update NGINX Config atomically
echo "Switching NGINX upstream to $TARGET_ENV..."

cat <<EOF > "$NGINX_CONF.tmp"
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream backend_upstream {
        server backend-$TARGET_ENV:4000;
    }
    upstream frontend_upstream {
        server frontend-$TARGET_ENV:3000;
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

mv "$NGINX_CONF.tmp" "$NGINX_CONF"

# Reload NGINX
echo "Reloading NGINX..."
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload || true

echo "Deployment to $TARGET_ENV successful."

# Keep the old environment for 10 minutes (rollback window) then tear it down
echo "Scheduling teardown of old environment ($ACTIVE_ENV) in 10 minutes..."
nohup bash -c "sleep 600 && docker compose -f $COMPOSE_FILE --profile $ACTIVE_ENV rm -s -f frontend-$ACTIVE_ENV backend-$ACTIVE_ENV" > /dev/null 2>&1 &

echo "Done."
