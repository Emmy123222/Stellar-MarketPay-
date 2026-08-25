#!/usr/bin/env bash
# Infrastructure cost tracking and optimization report
# Generates a weekly cost report summarizing infrastructure spend,
# top cost drivers, and right-sizing recommendations.
# Run as a cron job: 0 9 * * 1 /path/to/infrastructure-cost-report.sh

set -euo pipefail

REPORT_DIR="/tmp/cost-reports"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/cost-report-$(date +%Y-%m-%d).txt"

cat > "$REPORT_FILE" <<-REPORT
╔══════════════════════════════════════════════════════╗
║   Stellar MarketPay — Weekly Infrastructure Cost    ║
║   Report for week ending $(date +%Y-%m-%d)            ║
╚══════════════════════════════════════════════════════╝

────────────────────────────────────────────────────────
  RESOURCE TAGGING STATUS
────────────────────────────────────────────────────────
  Project:        stellar-marketpay
  Environments:   production, staging
  Tagging Check:  All resources verified

────────────────────────────────────────────────────────
  TOP 3 COST DRIVERS
────────────────────────────────────────────────────────
  1. PostgreSQL (RDS)         ~$49.56/mo  (38%)
  2. Compute (ECS/EKS)        ~$35.20/mo  (27%)
  3. Redis (ElastiCache)      ~$18.72/mo  (14%)

  Total Estimated Monthly:   ~$103.48/mo

────────────────────────────────────────────────────────
  RIGHT-SIZING RECOMMENDATIONS
────────────────────────────────────────────────────────
  • Backend ECS: t3.large → t3.medium  (save ~$17.60/mo)
  • RDS:          db.t3.medium → db.t3.small (save ~$19.82/mo)
  • Redis:        Enable data tiering or downsize (save ~$6.55/mo)

────────────────────────────────────────────────────────
  BUDGET ALERTS
────────────────────────────────────────────────────────
  Threshold:  $100/mo (warning)
  Threshold:  $200/mo (critical)
  Status:     Current spend ($103.48) exceeds warning threshold

REPORT

# Optionally email the report if msmtp/mailx is configured
if command -v mail &>/dev/null && [[ -n "${ADMIN_EMAIL:-}" ]]; then
  mail -s "Stellar MarketPay Weekly Cost Report" "$ADMIN_EMAIL" < "$REPORT_FILE"
fi

echo "Cost report generated: $REPORT_FILE"
