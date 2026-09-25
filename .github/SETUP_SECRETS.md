# GitHub Actions Secrets Setup Guide

Quick reference for configuring secrets for CI/CD workflows.

## 📋 Checklist

### For CI Workflows (No Secrets Required)
- [x] CI workflow (`ci.yml`) — runs tests with mock data, no secrets needed
- [x] E2E workflow (`e2e.yml`) — runs tests with mock contract, no secrets needed
- [x] Security workflow (`security.yml`) — scans code, no secrets needed

### For Deploy Workflows (Requires Setup)
- [ ] SSH deployment secrets (for staging/production)
- [ ] AWS credentials (for S3/artifact storage)
- [ ] Database credentials (for production only)
- [ ] Discord webhook (for notifications, optional)

## 🚀 Quick Setup (Staging)

### Step 1: Generate SSH Key (if you don't have one)
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/staging_deploy -N ""
```

### Step 2: Copy SSH Key to VPS
```bash
ssh-copy-id -i ~/.ssh/staging_deploy.pub ubuntu@staging.example.com
```

### Step 3: Add GitHub Secrets
1. Go to your repository on GitHub
2. Settings → Secrets and variables → Actions
3. Click "New repository secret" and add:

| Name | Value |
|---|---|
| `SSH_HOST` | `staging.example.com` |
| `SSH_USER` | `ubuntu` |
| `SSH_KEY` | Contents of `~/.ssh/staging_deploy` (private key) |
| `APP_DIR` | `/home/ubuntu/stellar-marketpay` |

### Step 4: Enable Staging Deploy Workflow
```bash
cp .github/workflows/deploy-staging.yml.example .github/workflows/deploy-staging.yml
```

### Step 5: Test
Push to `develop` branch and watch the workflow run.

## 🔒 Full Setup (Production)

### Prerequisites
- SSH access to production VPS
- AWS account with S3 access
- PostgreSQL database credentials
- Discord server (optional, for notifications)

### Step 1: SSH Setup
Follow staging steps above, but use production values:
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/prod_deploy -N ""
ssh-copy-id -i ~/.ssh/prod_deploy.pub ubuntu@prod.example.com
```

### Step 2: AWS Credentials
1. Log in to AWS Console
2. IAM → Users → Create user (e.g., "marketpay-deploy")
3. Attach policy: `AmazonS3FullAccess` (or scoped policy for specific bucket)
4. Click user → Security credentials → Create access key
5. Copy Access Key ID and Secret Access Key

### Step 3: GitHub Secrets
Add to repository secrets:

**SSH Secrets:**
```
SSH_HOST = prod.example.com
SSH_USER = ubuntu
SSH_KEY = [contents of ~/.ssh/prod_deploy]
APP_DIR = /home/ubuntu/stellar-marketpay
```

**AWS Secrets:**
```
AWS_ACCESS_KEY_ID = [from AWS IAM]
AWS_SECRET_ACCESS_KEY = [from AWS IAM]
AWS_REGION = us-east-1
S3_BUCKET = marketpay-backups
```

**Database Secrets:**
```
PGHOST = marketpay-db.xxxxx.us-east-1.rds.amazonaws.com
PGPORT = 5432
PGDATABASE = marketpay_prod
PGUSER = marketpay_app
PGPASSWORD = [strong password]
```

**Optional - Discord Notifications:**
```
DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/...
```

### Step 4: Create Production Environment
1. Settings → Environments → New environment
2. Name: `production`
3. Protection rules:
   - [x] Require reviewers: Check
   - [x] Number of reviewers: 1 (or more)
   - [x] Dismiss stale pull request approvals: Check

### Step 5: Enable Production Deploy Workflow
```bash
cp .github/workflows/deploy-prod.yml.example .github/workflows/deploy-prod.yml
```

### Step 6: Test
Go to Actions → Deploy Production → Run workflow (manual trigger).

## 🧪 Verify Secrets

### Test SSH Access
```bash
ssh -i ~/.ssh/staging_deploy ubuntu@staging.example.com "echo 'SSH works'"
ssh -i ~/.ssh/prod_deploy ubuntu@prod.example.com "echo 'SSH works'"
```

### Test AWS Credentials
```bash
export AWS_ACCESS_KEY_ID=your_key_id
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
aws s3 ls
```

### Test Database Connection
```bash
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT 1;"
```

### Test Discord Webhook
```bash
curl -X POST "https://discord.com/api/webhooks/..." \
  -H "Content-Type: application/json" \
  -d '{"content":"Test message"}'
```

## 🔍 Troubleshooting

### Workflow fails with "SSH_HOST is empty"
→ Secret not configured. Go to Settings → Secrets and verify all SSH secrets exist.

### SSH: "Permission denied (publickey)"
→ Public key not on VPS. Run: `ssh-copy-id -i ~/.ssh/staging_deploy.pub user@host`

### AWS: "InvalidAccessKeyId"
→ AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is wrong. Regenerate in AWS Console.

### Database: "connection refused"
→ Check security group allows port 5432 from deploy server IP. Or database password is wrong.

## 📚 Full Documentation

See **[docs/ci-secrets.md](../docs/ci-secrets.md)** for:
- Complete secret reference table
- Detailed setup instructions for each workflow
- Security best practices
- Adding new secrets

## 🆘 Need Help?

1. Check [docs/ci-secrets.md](../docs/ci-secrets.md) for setup details
2. Run workflow in debug mode: `jobs: debug: runs-on: ubuntu-latest; steps: - run: env | sort`
3. Open an issue with workflow run link
