# CI Secrets Configuration

This document lists all secrets required by GitHub Actions workflows in this repository, their usage, and how to obtain or configure them.

## Overview

Secrets are sensitive values (API keys, credentials, deployment tokens) stored in GitHub and injected into workflows at runtime. Missing or misconfigured secrets cause workflow failures. This guide helps teams quickly identify and resolve secret-related issues.

## All Required Secrets

| Secret Name | Workflow(s) | Used By | Requirement | How to Obtain |
|---|---|---|---|---|
| **GITHUB_TOKEN** | All | Actions framework | Built-in | Automatically provided by GitHub |
| **SSH_HOST** | Deploy (staging) | SSH deployment | Deploy to staging | VPS/EC2 hostname or IP (`echo $HOSTNAME` on server) |
| **SSH_USER** | Deploy (staging) | SSH deployment | Deploy to staging | VPS/EC2 SSH user (typically `ubuntu`, `ec2-user`, `root`) |
| **SSH_KEY** | Deploy (staging) | SSH authentication | Deploy to staging | Private SSH key (run `cat ~/.ssh/id_rsa` on your local machine) |
| **APP_DIR** | Deploy (staging) | Deploy script path | Deploy to staging | Path on VPS where app is deployed (e.g., `/home/ubuntu/app` or `/opt/stellar-marketpay`) |
| **AWS_ACCESS_KEY_ID** | Deploy | AWS S3/services | S3 uploads / prod deploy | AWS IAM access key ID. Create via AWS Console → IAM → Users → Security credentials |
| **AWS_SECRET_ACCESS_KEY** | Deploy | AWS S3/services | S3 uploads / prod deploy | AWS IAM secret access key. Create with AWS_ACCESS_KEY_ID as a pair |
| **AWS_ENDPOINT_URL** | Deploy | AWS S3 alternative endpoint | Optional (S3-compatible storage) | S3-compatible service endpoint (e.g., MinIO, DigitalOcean Spaces). Leave blank for standard AWS S3 |
| **AWS_REGION** | Deploy | AWS region | Deploy to prod | AWS region code (e.g., `us-east-1`, `eu-west-1`) |
| **S3_BUCKET** | Deploy | S3 bucket name | Deploy to prod | S3 bucket name for artifact storage |
| **PGHOST** | Deploy | Database hostname | Deploy to prod | PostgreSQL host (e.g., `db.example.com` or RDS endpoint) |
| **PGPORT** | Deploy | Database port | Deploy to prod | PostgreSQL port (typically `5432`) |
| **PGDATABASE** | Deploy | Database name | Deploy to prod | PostgreSQL database name (e.g., `marketpay_prod`) |
| **PGUSER** | Deploy | Database user | Deploy to prod | PostgreSQL user account (with appropriate permissions) |
| **PGPASSWORD** | Deploy | Database password | Deploy to prod | PostgreSQL user password |
| **DISCORD_WEBHOOK_URL** | Deploy | Notifications | Deploy notifications | Discord webhook URL. Create in Discord → Server Settings → Integrations → Webhooks |

## Secret Groups by Workflow

### CI Workflow (`ci.yml`)

**Current Status:** No secrets required. This workflow runs tests and builds with mock data.

### E2E & Accessibility Workflow (`e2e.yml`)

**Current Status:** No secrets required. This workflow runs E2E tests with mock contract configuration.

### Security Workflow (`security.yml`)

**Current Status:** No secrets required. This workflow runs code scans and audits.

### Deploy Workflow (Staging) (`deploy-staging.yml`)

**Required Secrets:**
- `SSH_HOST` — VPS hostname
- `SSH_USER` — SSH username on VPS
- `SSH_KEY` — Private SSH key for authentication
- `APP_DIR` — Application directory path on VPS
- `DISCORD_WEBHOOK_URL` — Discord notifications (optional but recommended)

**Setup Instructions:**

1. Generate SSH key pair (if needed):
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/staging_key -N ""
   ```

2. Copy public key to VPS:
   ```bash
   ssh-copy-id -i ~/.ssh/staging_key.pub username@staging.example.com
   ```

3. Add GitHub secrets:
   - `SSH_HOST`: `staging.example.com`
   - `SSH_USER`: `ubuntu` (or your SSH user)
   - `SSH_KEY`: Contents of `~/.ssh/staging_key` (private key)
   - `APP_DIR`: `/home/ubuntu/stellar-marketpay` (or your app directory)

### Deploy Workflow (Production) (`deploy-prod.yml`)

**Required Secrets:**
- `SSH_HOST` — Production VPS hostname
- `SSH_USER` — SSH username on production VPS
- `SSH_KEY` — Private SSH key for production
- `APP_DIR` — Application directory path on production
- `AWS_ACCESS_KEY_ID` — AWS credentials for artifacts/backups
- `AWS_SECRET_ACCESS_KEY` — AWS credentials for artifacts/backups
- `AWS_ENDPOINT_URL` — (Optional) S3-compatible endpoint
- `AWS_REGION` — AWS region (e.g., `us-east-1`)
- `S3_BUCKET` — S3 bucket for backups/artifacts
- `PGHOST` — Production database hostname
- `PGPORT` — Production database port
- `PGDATABASE` — Production database name
- `PGUSER` — Production database user
- `PGPASSWORD` — Production database password
- `DISCORD_WEBHOOK_URL` — Deployment notifications

**Setup Instructions:**

1. **SSH Configuration** — Follow same steps as staging, but use production endpoints.

2. **AWS Credentials:**
   - Log in to AWS Console → IAM → Users → Create User
   - Attach policies: `AmazonS3FullAccess` (or scoped policy for specific bucket)
   - Generate access keys under "Security credentials"
   - Add to GitHub secrets:
     - `AWS_ACCESS_KEY_ID`: Your access key ID
     - `AWS_SECRET_ACCESS_KEY`: Your secret access key
     - `AWS_REGION`: Your AWS region
     - `S3_BUCKET`: Bucket name

3. **Database Configuration:**
   - If using RDS:
     - `PGHOST`: RDS endpoint (e.g., `marketpay-db.xxxxx.us-east-1.rds.amazonaws.com`)
     - `PGPORT`: `5432`
     - `PGDATABASE`: Database name
     - `PGUSER`: Master user (or application user with sufficient privileges)
     - `PGPASSWORD`: User password

4. **Discord Notifications** (optional):
   - Create Discord server (if needed)
   - Create channel for deployment notifications
   - Right-click channel → Integrations → Webhooks → New Webhook
   - Copy webhook URL to GitHub secret: `DISCORD_WEBHOOK_URL`

## Verifying Secrets

### Check Secret Presence

In GitHub UI:
1. Navigate to repository settings → Secrets and variables → Actions
2. Verify all required secrets appear in the list
3. Note: Secret **values** are masked and not displayed; only names are shown

### Test Secret Access in Workflow

Add a debug step (before deployment):
```yaml
- name: Verify secrets
  run: |
    [ -n "${{ secrets.SSH_HOST }}" ] || (echo "ERROR: SSH_HOST not set" && exit 1)
    [ -n "${{ secrets.SSH_USER }}" ] || (echo "ERROR: SSH_USER not set" && exit 1)
    [ -n "${{ secrets.SSH_KEY }}" ] || (echo "ERROR: SSH_KEY not set" && exit 1)
    [ -n "${{ secrets.APP_DIR }}" ] || (echo "ERROR: APP_DIR not set" && exit 1)
    echo "✓ All required secrets are configured"
```

### Manual Testing

Test SSH access locally:
```bash
ssh -i /path/to/private/key username@host "echo 'SSH works'"
```

Test AWS credentials:
```bash
aws s3 ls --region us-east-1
```

Test database connection:
```bash
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT 1;"
```

## Troubleshooting

### "Authentication failed" during SSH deployment

**Cause:** SSH_KEY is invalid or SSH_USER/SSH_HOST are incorrect.

**Fix:**
1. Verify SSH key is copied to VPS: `ssh-copy-id -i ~/.ssh/key.pub user@host`
2. Test locally: `ssh -i ~/.ssh/key user@host "whoami"`
3. Check GitHub secret contains **private** key (not public key)
4. Ensure key has no extra whitespace or line breaks when pasting

### "AWS credentials not valid" during S3 upload

**Cause:** AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is incorrect.

**Fix:**
1. Verify credentials in AWS IAM console
2. Check keys have not been rotated/deleted
3. Test locally: `aws s3 ls --region $AWS_REGION`
4. Verify user has S3 permissions

### "Database connection refused" during deploy

**Cause:** PGHOST, PGPORT, PGUSER, PGDATABASE, or PGPASSWORD is incorrect.

**Fix:**
1. Test locally: `psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT 1;"`
2. Verify RDS security group allows inbound on port 5432 from deploy server
3. Confirm database user password has no special characters that need escaping

### Workflow fails with "x is empty" mid-deployment

**Cause:** A required secret was not set in GitHub.

**Fix:**
1. Check **all** required secrets for your workflow in repository settings
2. Ensure secret names match exactly (GitHub is case-sensitive)
3. Verify secret values are not empty (paste, don't type)
4. Test by triggering workflow again

## Security Best Practices

1. **Rotate Credentials Regularly** — Update SSH keys, database passwords, and AWS access keys periodically (every 90 days).

2. **Use Service Accounts** — For AWS and database credentials, create dedicated service accounts with minimal required permissions. Don't use admin/root credentials.

3. **Scope Repository Secrets** — When adding secrets, configure them at the repository level (not organization level) unless needed by multiple repos.

4. **Audit Secret Access** — GitHub logs when workflows access secrets. Review audit logs quarterly.

5. **Restrict Deployment Permissions** — Use GitHub environment protection rules to require approvals before production deployments.

6. **Encrypt SSH Keys** — Use SSH key passphrases locally, but GitHub secrets handle encryption at rest.

7. **Never Log Secrets** — Ensure deploy scripts never echo or log secret values. GitHub masks known secrets in logs, but rely on this as a safety net, not protection.

## Adding New Secrets

When adding a new secret:

1. **Document it** — Add entry to the "All Required Secrets" table above
2. **Add workflow reference** — Update the relevant workflow section
3. **Include instructions** — Explain how to obtain and format the value
4. **Test access** — Add a validation step in the workflow to fail fast if missing
5. **Update team** — Notify team members of the new requirement via documentation update

## References

- [GitHub Actions: Using secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [GitHub Actions: Encrypted secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitHub Actions: Environment protection rules](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
