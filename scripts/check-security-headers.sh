#!/usr/bin/env bash
set -euo pipefail

# Usage: check-security-headers.sh <url>
# Example: check-security-headers.sh http://localhost:3000

URL="${1:-http://localhost:3000}"

echo "Checking security headers for: ${URL}"

# Fetch headers with curl, following redirects and printing only headers.
HEADERS=$(curl -sSL -D - "${URL}" -o /dev/null 2>/dev/null || true)

if [ -z "${HEADERS}" ]; then
  echo "ERROR: Failed to fetch headers from ${URL}" >&2
  exit 1
fi

# Required headers and the values they must contain.
REQUIRED_HEADERS=(
  "Strict-Transport-Security:max-age=31536000"
  "X-Content-Type-Options:nosniff"
  "X-Frame-Options:SAMEORIGIN"
  "Referrer-Policy:strict-origin-when-cross-origin"
  "Permissions-Policy:camera=()"
)

MISSING=0

for entry in "${REQUIRED_HEADERS[@]}"; do
  header="${entry%%:*}"
  expected="${entry##*:}"
  # Case-insensitive search for the header line.
  value=$(echo "${HEADERS}" | grep -i "^${header}:" || true)
  if [ -z "${value}" ]; then
    echo "MISSING: ${header}"
    MISSING=$((MISSING + 1))
  elif ! echo "${value}" | grep -qi "${expected}"; then
    echo "MISMATCH: ${value} (expected to contain: ${expected})"
    MISSING=$((MISSING + 1))
  else
    echo "OK: ${value}"
  fi
done

if [ ${MISSING} -gt 0 ]; then
  echo ""
  echo "ERROR: ${MISSING} required security header(s) missing or incorrect." >&2
  exit 1
fi

echo ""
echo "All required security headers are present."
