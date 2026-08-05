#!/usr/bin/env bash
#
# cargo-fmt-check.sh
#
# Run `cargo fmt --check` for any Rust files staged in a commit.
# Invoked by lint-staged — see the "*.rs" entry in the root package.json.
#
# Why a wrapper? The Soroban contracts in this repo live in their own crates
# under contracts/ (there is no Cargo workspace at the repository root), so a
# bare `cargo fmt --check` run from the root would fail to locate a Cargo.toml.
# This script finds the Cargo package that owns each staged .rs file and runs
# `cargo fmt --check` from inside it, so it only runs when Rust files are
# actually staged (satisfying "run cargo fmt --check if any Rust files staged").

set -uo pipefail

# If the Rust toolchain is missing, we cannot check formatting. Warn and skip
# so that JavaScript/TypeScript-only contributors are not blocked.
if ! command -v cargo >/dev/null 2>&1; then
  echo "⚠️  cargo (Rust toolchain) is not installed — skipping 'cargo fmt --check'."
  echo "    Install Rust from https://rustup.rs to enable Rust formatting checks."
  exit 0
fi

# No arguments => no staged Rust files; nothing to do.
if [ "$#" -eq 0 ]; then
  exit 0
fi

# Map each Cargo package directory to the list of staged files it owns.
declare -A pkg_files

for file in "$@"; do
  dir=$(dirname "$file")
  # Walk up until we find the Cargo.toml that owns this file.
  while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ ! -f "$dir/Cargo.toml" ]; do
    dir=$(dirname "$dir")
  done

  if [ ! -f "$dir/Cargo.toml" ]; then
    echo "⚠️  Skipping $file — no Cargo.toml found for it."
    continue
  fi

  rel="${file#"$dir"/}"
  pkg_files["$dir"]+=" $rel"
done

rc=0
for dir in "${!pkg_files[@]}"; do
  echo "🦀 Checking Rust formatting in $dir (cargo fmt --check)"
  if ! ( cd "$dir" && cargo fmt --check ${pkg_files[$dir]} ); then
    rc=1
  fi
done

if [ "$rc" -ne 0 ]; then
  echo "❌ cargo fmt --check reported formatting issues."
  echo "   Run 'cargo fmt' inside the contract crate to fix them, then re-stage."
fi

exit "$rc"
