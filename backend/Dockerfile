FROM node:20-alpine

# Install wget for the HEALTHCHECK command
RUN apk add --no-cache wget

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4000

# Readiness / liveness probe:
#   - Runs every 30 s, allows 5 s to respond
#   - 3 consecutive failures → container marked unhealthy
#   - 10 s start period gives the app time to boot before probes begin
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health | grep -q '"status":"healthy"' || exit 1

CMD ["node", "src/server.js"]
