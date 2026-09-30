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

## GitHub Actions Workflow (`deploy.yml`)

The repository uses a single, unified deployment workflow (`deploy.yml`) for all environments, triggered manually via `workflow_dispatch`.

### Workflow Inputs

When triggering the deployment, you must provide the following inputs:

- `environment`: The target environment (e.g., `staging`, `production`).
- `image_tag`: The specific Docker image tag to deploy.
- `rollback`: (Boolean) If true, redeploys the specified `image_tag` as a rollback.

### Deployment Execution

1. **Trigger**: Manually start the workflow and provide the required inputs.
2. **Approval Gate**: If targeting `production`, GitHub environment protection rules enforce required reviewer approval before proceeding.
3. **Deploy**: The workflow connects to the target environment via SSH and executes the `deploy/deploy.sh` script.
4. **Blue-Green Health Gate**: The deploy script brings up the standby environment and polls its `/api/health` endpoint. 
   - **Success**: If the health check passes, traffic is switched to the new environment.
   - **Failure**: If the health check fails, an automated rollback occurs, leaving the active environment untouched.
5. **Notification**: A deployment status notification (success or rollback) is sent to Discord.

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
