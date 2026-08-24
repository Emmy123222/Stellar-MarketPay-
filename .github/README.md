# GitHub Actions Workflows

This directory contains CI/CD workflows for the Stellar MarketPay project.

## Workflow Reference

### Testing & Validation (No Secrets Required)

#### `ci.yml` — Continuous Integration
Runs on every push to `main`/`develop` and pull requests.

**What it does:**
- Lint and test backend (Node.js)
- Lint and type-check frontend (React)
- Build frontend for production
- Run Soroban contract tests (Rust)
- Scan for secrets using Gitleaks

**No secrets required.** Uses mock configurations for testing.

**Status:** ✅ Runs by default

---

#### `e2e.yml` — End-to-End & Accessibility Tests
Runs on pushes to `main`/`develop` and pull requests.

**What it does:**
- Run Playwright E2E tests (Chromium)
- Run dark mode E2E tests
- Run accessibility scans (WCAG compliance)

**No secrets required.** Uses mock contract and API.

**Status:** ✅ Runs by default

---

#### `security.yml` — Security Scanning
Runs on `main` pushes, PRs, and weekly schedule.

**What it does:**
- CodeQL analysis (JavaScript/TypeScript)
- npm audit (production dependencies)
- cargo audit (Rust dependencies)
- Trivy filesystem scan (container/OS vulnerabilities)

**No secrets required.** Uses GitHub-provided scanning tools.

**Status:** ✅ Runs by default

---

### Deployment (Requires Secrets Setup)

#### `deploy-staging.yml` — Deploy to Staging
**Example workflow** for deploying to staging environment.

**What it does:**
- Validates all required SSH secrets
- Deploys via SSH to staging VPS
- Runs blue-green deployment
- Sends Discord notification on success/failure

**Required Secrets:**
```
SSH_HOST           # Staging server hostname
SSH_USER           # SSH username (ubuntu, ec2-user, etc.)
SSH_KEY            # Private SSH key
APP_DIR            # App directory on VPS (/home/ubuntu/app)
```

**Optional Secrets:**
```
DISCORD_WEBHOOK_URL  # Discord notifications
```

**Status:** ❌ Example only (`.yml.example`). Copy to `.yml` and configure secrets to enable.

**Setup:** See [SETUP_SECRETS.md](./SETUP_SECRETS.md)

---

#### `deploy-prod.yml` — Deploy to Production
**Example workflow** for deploying to production environment.

**What it does:**
- Validates SSH, AWS, and database secrets
- Requires manual approval via GitHub environment
- Deploys via SSH to production VPS
- Validates database connectivity
- Sends Discord notification with detailed status

**Required Secrets:**
```
# SSH
SSH_HOST              # Production server hostname
SSH_USER              # SSH username
SSH_KEY               # Private SSH key
APP_DIR               # App directory on VPS

# AWS (for backups/artifacts)
AWS_ACCESS_KEY_ID          # AWS IAM access key
AWS_SECRET_ACCESS_KEY      # AWS IAM secret
AWS_REGION                 # AWS region (us-east-1)
S3_BUCKET                  # S3 bucket name

# Database
PGHOST                # PostgreSQL hostname (RDS endpoint)
PGPORT                # PostgreSQL port (5432)
PGDATABASE            # Database name
PGUSER                # Database user
PGPASSWORD            # Database password
```

**Optional Secrets:**
```
DISCORD_WEBHOOK_URL   # Deployment notifications
```

**Status:** ❌ Example only (`.yml.example`). Copy to `.yml` and configure secrets to enable.

**Setup:** See [SETUP_SECRETS.md](./SETUP_SECRETS.md)

---

## Directory Structure

```
.github/
├── workflows/
│   ├── ci.yml                      # Main CI pipeline (tests, lint, build)
│   ├── e2e.yml                     # E2E and accessibility tests
│   ├── security.yml                # Security scanning (CodeQL, npm audit, etc.)
│   ├── deploy-staging.yml.example  # Example: Deploy to staging
│   ├── deploy-prod.yml.example     # Example: Deploy to production
│   └── validate-secrets.yml        # Reusable secret validation workflow
├── ISSUE_TEMPLATE/                 # Issue templates
├── workflows/
│   └── [CI workflow files]
├── PULL_REQUEST_TEMPLATE.md         # PR template
├── SETUP_SECRETS.md                 # Quick secrets setup guide
└── README.md                        # This file
```

## Getting Started

### For Contributors
No setup needed. The main workflows (CI, E2E, security) run automatically.

### For Deployment
1. **Read** [docs/ci-secrets.md](../docs/ci-secrets.md) for detailed secret reference
2. **Follow** [SETUP_SECRETS.md](./SETUP_SECRETS.md) for quick setup
3. **Copy** example workflows and customize for your environment:
   ```bash
   cp .github/workflows/deploy-staging.yml.example .github/workflows/deploy-staging.yml
   ```
4. **Configure** GitHub repository secrets
5. **Test** by triggering a manual workflow run

## Secrets Documentation

**Complete reference:** [docs/ci-secrets.md](../docs/ci-secrets.md)

Covers:
- All secrets used by each workflow
- Where to get credentials
- How to configure them
- Troubleshooting common issues
- Security best practices

**Quick setup:** [SETUP_SECRETS.md](./SETUP_SECRETS.md)

Checklist for:
- Staging deployment secrets
- Production deployment secrets
- Verification steps

## Common Tasks

### Add a New Workflow
1. Create `workflows/my-workflow.yml`
2. Document required secrets in [docs/ci-secrets.md](../docs/ci-secrets.md)
3. Update this README

### Debug a Failing Workflow
1. Check workflow logs in GitHub Actions
2. Look for secrets validation errors (see [ci-secrets.md](../docs/ci-secrets.md) troubleshooting)
3. Verify secrets are configured: Settings → Secrets and variables → Actions

### Add a New Secret
1. Document it in [docs/ci-secrets.md](../docs/ci-secrets.md)
2. Add validation step to workflow (see deploy examples)
3. Add setup instructions to [SETUP_SECRETS.md](./SETUP_SECRETS.md)
4. Notify team

### Enable Discord Notifications
1. Create Discord server and webhook
2. Add `DISCORD_WEBHOOK_URL` secret to GitHub
3. Webhook URL format: `https://discord.com/api/webhooks/{id}/{token}`

## Best Practices

- ✅ **Keep secrets minimal** — Only request what's needed
- ✅ **Use service accounts** — Don't use admin/root credentials
- ✅ **Rotate regularly** — Update SSH keys and passwords every 90 days
- ✅ **Document everything** — Update [docs/ci-secrets.md](../docs/ci-secrets.md) when adding secrets
- ✅ **Test locally first** — Verify SSH/AWS/DB access before committing workflows
- ✅ **Use environment protection** — Require approval for production deployments
- ✅ **Validate fast** — Check secrets early so failures are quick and clear

## Troubleshooting

### Workflow fails with "X is empty" mid-deployment
**Problem:** A required secret is not configured.

**Fix:**
1. Go to Settings → Secrets and variables → Actions
2. Verify all required secrets are present
3. Secret names are case-sensitive
4. Values should not have extra whitespace

### SSH: "Permission denied (publickey)"
**Problem:** SSH key is not authorized on the server.

**Fix:**
```bash
ssh-copy-id -i ~/.ssh/id_rsa user@host
```

### AWS: "InvalidAccessKeyId"
**Problem:** AWS credentials are invalid or expired.

**Fix:**
1. Regenerate access keys in AWS IAM Console
2. Update GitHub secrets with new credentials

### Database: "Connection refused"
**Problem:** Database host, port, or credentials are incorrect.

**Fix:**
```bash
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT 1;"
```

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [GitHub Actions Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Project Documentation](../docs/README.md)

## Support

Questions? Check:
1. [docs/ci-secrets.md](../docs/ci-secrets.md) — Secret reference and troubleshooting
2. [SETUP_SECRETS.md](./SETUP_SECRETS.md) — Quick setup guide
3. GitHub Actions logs for your specific run
4. Open an issue with workflow run link and error logs
