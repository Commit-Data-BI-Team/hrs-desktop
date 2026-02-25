#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="HRS Desktop.app"
APP_TARGET="/Applications/$APP_NAME"

if [[ "${1:-}" != "" ]]; then
  DMG_PATH="$1"
else
  DMG_PATH="$(find "$DIST_DIR" -maxdepth 1 -type f -name "*.dmg" -print0 | xargs -0 ls -t | head -n 1)"
fi

if [[ -z "${DMG_PATH:-}" || ! -f "$DMG_PATH" ]]; then
  echo "No DMG found. Build first with: npm run dist:mac"
  exit 1
fi

MOUNT_POINT="$(mktemp -d /tmp/hrs-dmg.XXXXXX)"
ATTACHED=0

cleanup() {
  if [[ "$ATTACHED" -eq 1 ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
  rmdir "$MOUNT_POINT" 2>/dev/null || true
}
trap cleanup EXIT

echo "Mounting DMG: $DMG_PATH"
hdiutil attach "$DMG_PATH" -nobrowse -mountpoint "$MOUNT_POINT" -quiet
ATTACHED=1

APP_SOURCE="$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "$APP_NAME" | head -n 1)"

if [[ -z "${APP_SOURCE:-}" || ! -d "$APP_SOURCE" ]]; then
  echo "Could not find $APP_NAME inside mounted DMG."
  exit 1
fi

echo "Installing to: $APP_TARGET"
osascript -e 'tell application "HRS Desktop" to quit' >/dev/null 2>&1 || true
pkill -f "HRS Desktop.app" >/dev/null 2>&1 || true

sudo rm -rf "$APP_TARGET"
sudo ditto "$APP_SOURCE" "$APP_TARGET"
xattr -dr com.apple.quarantine "$APP_TARGET" >/dev/null 2>&1 || true

echo "Installed successfully."
