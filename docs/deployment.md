# Deployment Pipeline

## Overview

This repository uses a **blue-green deployment strategy** for zero-downtime releases. Two identical environments (blue and green) run behind a load balancer. During a deployment, the inactive environment is updated, health-checked, and then traffic is switched atomically. If the new environment fails health checks, an automated rollback restores the previous active environment.

## Blue-Green Architecture

```
                    ┌──────────────┐
                    │   Load Balancer │ (NGINX / Cloudflare)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐ ┌────▼────┐
         │  Blue    │ │  Green   │
         │ (active) │ │ (standby)│
         │          │ │          │
         │ frontend │ │ frontend │
         │ backend  │ │ backend  │
         │ postgres │ │ postgres │
         │ redis    │ │ redis    │
         └──────────┘ └──────────┘
```

- **Blue** and **Green** are full, independent environments running on Docker Compose with profiles.
- At any time, one environment is **active** (serving traffic) and the other is **standby**.
- Deployments target the **standby** environment.
- After a successful deployment and health check, the load balancer switches traffic to the newly deployed environment.
- The previous active environment is kept running for a **10-minute rollback window** before being torn down.

### Environment Naming

Services are named with a color suffix: `frontend-blue`, `backend-blue`, `frontend-green`, `backend-green`.

NGINX upstreams point to the active environment's services:
- `backend-blue:4000` or `backend-green:4000`
- `frontend-blue:3000` or `frontend-green:3000`

## Deployment Flow (Blue-Green)

1. **Determine active environment** — inspect NGINX config to find which color is currently serving traffic.
2. **Identify standby environment** — the opposite color is the deployment target.
3. **Pull latest images** — pull the new Docker image for the standby environment.
4. **Start standby environment** — bring up the standby services with the new image.
5. **Health check** — poll the standby backend's `/api/health` endpoint until it responds with HTTP 200 or retries are exhausted.
6. **Switch traffic** — atomically update the NGINX upstream configuration to point to the standby environment and reload NGINX.
7. **Rollback window** — keep the old active environment running for 10 minutes. If issues are detected, trigger rollback.
8. **Teardown old environment** — after the rollback window expires, remove the old environment's containers.

## Health Check

The health check verifies the standby backend is ready before traffic is switched:

- Endpoint: `http://backend-<standby>:4000/api/health`
- Interval: 5 seconds
- Timeout: 10 seconds per attempt
- Max retries: 30 (2.5 minutes total)
- Success condition: HTTP 200 response
- Failure action: automated rollback (stop standby, keep active)

## Rollback

If the health check fails or a post-switch verification fails:

1. Stop and remove the standby (new) environment containers.
2. Reload NGINX to restore the original upstream configuration.
3. Keep the old active environment running.
4. Send a Discord notification with the rollback status.

## Staging Flow

1. Build frontend Docker image.
2. Push image to GHCR (`ghcr.io/<owner>/<repo>:<sha>`).
3. SSH to staging VPS and run `deploy/deploy.sh` (blue-green).
4. Send Discord notification for success/failure.

## Production Flow

1. Trigger `Deploy Production` workflow manually.
2. Provide image tag from staging run.
3. GitHub environment `production` gate enforces required reviewer approval.
4. SSH deploy to production VPS using `deploy/deploy.sh` (blue-green).
5. Health check the green environment before switching the load balancer.
6. Automated rollback if health check fails.
7. Send Discord notification for success/failure.

## Rollback Flow

1. Trigger `Rollback Deploy` workflow manually.
2. Provide known-good `image_tag` and target env.
3. Workflow redeploys that tag over SSH using the opposite color.
4. Sends Discord status notification.

## Required GitHub Secrets

- `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_APP_DIR`
- `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_APP_DIR`
- `DISCORD_WEBHOOK_URL`

## Environment Configuration

- Configure GitHub `staging` and `production` environments.
- Set `production` environment to require at least one reviewer.
- Ensure runners can access GHCR and VPS hosts.

## Deploy Scripts

The `deploy/` directory contains the blue-green deployment scripts:

| Script | Purpose |
|---|---|
| `deploy/deploy.sh` | Main orchestrator — determines active/standby, deploys, health-checks, switches traffic |
| `deploy/health-check.sh` | Polls the standby backend's health endpoint |
| `deploy/rollback.sh` | Stops the failed standby and restores the active environment |
| `deploy/switch-traffic.sh` | Atomically updates NGINX config and reloads |

See each script's inline documentation for usage details.
