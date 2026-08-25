#!/usr/bin/env bash
# Verify no duplicate migration versions exist.
set -euo pipefail

cd "$(dirname "$0")/../backend/src/db/migrations"

ls V*__*.up.sql | sed 's/__.*//' | sort | uniq -d > /tmp/duplicate_versions.txt

if [ -s /tmp/duplicate_versions.txt ]; then
  echo "ERROR: Duplicate migration versions found:"
  cat /tmp/duplicate_versions.txt
  exit 1
else
  echo "OK: All migration versions are unique."
fi
