# Deployment Pipeline

## Overview
This repository now uses three GitHub Actions workflows for CI/CD:
- `.github/workflows/deploy-staging.yml`: auto deploys to staging on every push to `main`.
- `.github/workflows/deploy-production.yml`: manual production promotion through `workflow_dispatch` and GitHub `production` environment approval.
- `.github/workflows/rollback.yml`: manual rollback to a previous image tag.

## Staging Flow
1. Build frontend Docker image.
2. Push image to GHCR (`ghcr.io/<owner>/<repo>:<sha>`).
3. SSH to staging VPS and run `docker compose -f docker-compose.prod.yml up -d`.
4. Send Discord notification for success/failure.

## Production Flow
1. Trigger `Deploy Production` workflow manually.
2. Provide image tag from staging run.
3. GitHub environment `production` gate enforces required reviewer approval.
4. SSH deploy to production VPS.
5. Send Discord notification for success/failure.

## Rollback Flow
1. Trigger `Rollback Deploy` workflow manually.
2. Provide known-good `image_tag` and target env.
3. Workflow redeploys that tag over SSH.
4. Sends Discord status notification.

## Required GitHub Secrets
- `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_APP_DIR`
- `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_APP_DIR`
- `DISCORD_WEBHOOK_URL`

## Environment Configuration
- Configure GitHub `staging` and `production` environments.
- Set `production` environment to require at least one reviewer.
- Ensure runners can access GHCR and VPS hosts.
