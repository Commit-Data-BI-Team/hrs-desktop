#!/usr/bin/env bash
set -euo pipefail

command_name="${1:?Pass a macOS npm build script, such as dist:mac:x64}"
case "$command_name" in
  dist:mac:arm64|dist:mac:x64) ;;
  *) echo "Unsupported macOS build script: $command_name" >&2; exit 2 ;;
esac

build_log="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/hrs-mac-build.log"
max_attempts=3

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if npm run "$command_name" -- --publish never 2>&1 | tee "$build_log"; then
    exit 0
  fi

  # Electron Builder sometimes finishes packaging but fails to detach its
  # temporary DMG on a GitHub-hosted Mac. Only that transient error is retried;
  # signing failures and other build errors still fail immediately.
  if ! grep -Eq "hdiutil: couldn't eject .*Resource busy" "$build_log"; then
    exit 1
  fi
  if ((attempt == max_attempts)); then
    echo "macOS DMG detach remained busy after $max_attempts attempts." >&2
    exit 1
  fi

  delay=$((attempt * 20))
  echo "::warning::Temporary macOS DMG was busy; retrying the build in ${delay}s (attempt $((attempt + 1))/$max_attempts)."
  sleep "$delay"
done
