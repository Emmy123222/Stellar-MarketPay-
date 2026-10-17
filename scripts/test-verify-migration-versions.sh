#!/usr/bin/env bash
# Exercise the migration version checker against isolated fixtures.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="$script_dir/verify-migration-versions.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir "$tmp_dir/unique" "$tmp_dir/duplicate"
touch "$tmp_dir/unique/V1__first.up.sql" "$tmp_dir/unique/V2__second.up.sql"
touch "$tmp_dir/duplicate/V1__first.up.sql" "$tmp_dir/duplicate/V1__second.up.sql"

"$checker" "$tmp_dir/unique"
if "$checker" "$tmp_dir/duplicate"; then
  echo "ERROR: duplicate migration versions unexpectedly passed" >&2
  exit 1
fi

echo "OK: Migration version checker handles unique and duplicate fixtures."
