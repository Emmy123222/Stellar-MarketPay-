#!/usr/bin/env bash
# Verify no duplicate migration versions exist.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
migrations_dir="${1:-$repo_root/backend/src/db/migrations}"

if [[ ! -d "$migrations_dir" ]]; then
  echo "ERROR: Migration directory not found: $migrations_dir" >&2
  exit 2
fi

# Use find instead of ls so an empty directory and filenames with spaces are safe.
duplicates="$(find "$migrations_dir" -maxdepth 1 -type f -name 'V*__*.up.sql' -print \
  | sed 's#^.*/##; s/__.*//' \
  | sort \
  | uniq -d)"

if [[ -n "$duplicates" ]]; then
  echo "ERROR: Duplicate migration versions found in $migrations_dir:"
  while IFS= read -r version; do
    [[ -n "$version" ]] || continue
    find "$migrations_dir" -maxdepth 1 -type f -name "${version}__*.up.sql" -print | sort
  done <<< "$duplicates"
  exit 1
fi

echo "OK: All migration versions are unique."
