# GitHub Actions Secrets — Quick Reference Card

**Print this and stick it on your desk. Or just bookmark it.**

## 🚨 "X is empty" or "Secret not found" Error?

### Quick Fix (2 minutes)
1. Go to: **Settings → Secrets and variables → Actions**
2. Look for the missing secret name in the error message
3. Click **New repository secret**
4. Paste the value (do NOT type it)
5. Re-run the workflow

## Secrets by Workflow

### CI / E2E / Security Workflows
```
✓ NO SECRETS REQUIRED
These workflows run tests with mock data.
```

### Deploy (Staging)
```
REQUIRED:
  SSH_HOST      = staging.example.com
  SSH_USER      = ubuntu
  SSH_KEY       = [private key: cat ~/.ssh/id_rsa]
  APP_DIR       = /home/ubuntu/stellar-marketpay

OPTIONAL:
  DISCORD_WEBHOOK_URL  = [webhook URL]
```

### Deploy (Production)
```
REQUIRED - SSH:
  SSH_HOST      = prod.example.com
  SSH_USER      = ubuntu
  SSH_KEY       = [private key]
  APP_DIR       = /home/ubuntu/stellar-marketpay

REQUIRED - AWS:
  AWS_ACCESS_KEY_ID         = [from AWS IAM]
  AWS_SECRET_ACCESS_KEY     = [from AWS IAM]
  AWS_REGION                = us-east-1
  S3_BUCKET                 = marketpay-backups

REQUIRED - Database:
  PGHOST        = db.example.com (or RDS endpoint)
  PGPORT        = 5432
  PGDATABASE    = marketpay_prod
  PGUSER        = db_user
  PGPASSWORD    = [password]

OPTIONAL:
  DISCORD_WEBHOOK_URL  = [webhook URL]
```

## Where to Get Each Secret

| Secret | Source | Command |
|---|---|---|
| SSH_HOST | Your VPS/server hostname | `echo $HOSTNAME` (on server) |
| SSH_USER | SSH login username | Usually `ubuntu`, `ec2-user`, or `root` |
| SSH_KEY | Your SSH private key | `cat ~/.ssh/id_rsa` (on your computer) |
| APP_DIR | Where app is deployed | Check server: `pwd` in app directory |
| AWS_ACCESS_KEY_ID | AWS IAM Console | Create user → Security credentials → Access Keys |
| AWS_SECRET_ACCESS_KEY | AWS IAM Console | Create with Access Key ID |
| AWS_REGION | AWS region | Pick: `us-east-1`, `eu-west-1`, etc. |
| S3_BUCKET | S3 bucket name | AWS Console → S3 → bucket name |
| PGHOST | RDS endpoint or server | RDS Console or `psql -h $host -l` |
| PGPORT | Database port | Usually `5432` |
| PGDATABASE | Database name | Ask DBA or check schema |
| PGUSER | Database username | Ask DBA or check `.env` |
| PGPASSWORD | Database password | Ask DBA |
| DISCORD_WEBHOOK_URL | Discord server | Right-click channel → Integrations → Webhooks |

## Common Error Messages

### "SSH: Permission denied (publickey)"
```bash
# Fix: Copy your public key to the server
ssh-copy-id -i ~/.ssh/id_rsa.pub ubuntu@staging.example.com
```

### "AWS: InvalidAccessKeyId"
```bash
# Fix: Regenerate credentials in AWS IAM Console
# Verify with:
aws s3 ls --region us-east-1
```

### "Database: connection refused"
```bash
# Fix: Test connection locally
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT 1;"
```

## Most Common Mistakes

❌ **Copying only first 20 chars of SSH key**
→ Copy the ENTIRE private key (-----BEGIN to -----END)

❌ **Using public key (.pub) instead of private key**
→ Use `~/.ssh/id_rsa`, NOT `~/.ssh/id_rsa.pub`

❌ **Typing the secret instead of pasting**
→ Click GitHub secret field, paste, don't type

❌ **Secret name typo**
→ Check exact spelling (GitHub is case-sensitive)
→ Correct: `SSH_KEY`, not `ssh_key` or `SSH_KEY_ID`

❌ **Deploying to production without approval**
→ Set GitHub environment to require 1+ reviewer

## Documentation

| Document | When to Read |
|---|---|
| [docs/ci-secrets.md](../docs/ci-secrets.md) | Need detailed info on any secret |
| [.github/SETUP_SECRETS.md](./SETUP_SECRETS.md) | Setting up for first time |
| [.github/README.md](./README.md) | Understanding all workflows |

## Ultra Quick Setup (Staging)

```bash
# 1. Generate SSH key (if needed)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/staging -N ""

# 2. Copy public key to server
ssh-copy-id -i ~/.ssh/staging.pub ubuntu@staging.example.com

# 3. Add GitHub secrets
# Go to Settings → Secrets and variables → Actions
# Add: SSH_HOST, SSH_USER, SSH_KEY (from ~/.ssh/staging), APP_DIR

# 4. Test SSH access
ssh -i ~/.ssh/staging ubuntu@staging.example.com "echo OK"

# 5. Copy workflow
cp .github/workflows/deploy-staging.yml.example .github/workflows/deploy-staging.yml

# 6. Push and watch
git add .github/workflows/deploy-staging.yml
git commit -m "Enable staging deployments"
git push origin feature-branch
```

## Emergency Checklist

If deployment fails:

- [ ] Check error message in GitHub Actions logs
- [ ] Go to Settings → Secrets and variables → Actions
- [ ] Verify ALL required secrets are present (not just one)
- [ ] Check secret values are not empty
- [ ] If it's a new secret, wait 30 seconds for GitHub to sync
- [ ] Re-run workflow
- [ ] If still failing, check local access: `ssh`, `aws s3 ls`, `psql`
- [ ] Read troubleshooting in [docs/ci-secrets.md](../docs/ci-secrets.md)

## Need Help?

1. **Quick answer?** → Check "Common Error Messages" above
2. **How do I set up secrets?** → [.github/SETUP_SECRETS.md](./SETUP_SECRETS.md)
3. **What does this secret do?** → [docs/ci-secrets.md](../docs/ci-secrets.md)
4. **Which workflows need what?** → [.github/README.md](./README.md)

---

**Last Updated:** 2026-08-24  
**Maintained by:** DevOps / SRE  
**Next Review:** When adding new secrets
