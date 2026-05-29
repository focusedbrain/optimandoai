#!/usr/bin/env sh
# Install BEAP relay third-party notices on the wrdesk.com host filesystem.
#
# This is an OPTIONAL PROVISIONING STEP — run after relay deploy.
# It does not modify or replace the main relay deploy script.
#
# Usage (from repo checkout):
#   sudo ./packages/coordination-service/deploy-bundle/install-relay-licenses.sh
#
# Override destination:
#   BEAP_RELAY_LICENSES_DIR=/opt/beap/licenses sudo -E ./install-relay-licenses.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PKG_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DEST="${BEAP_RELAY_LICENSES_DIR:-/opt/beap/licenses}"

NOTICES_SRC="$PKG_ROOT/THIRD-PARTY-NOTICES"
LICENSES_SRC="$PKG_ROOT/licenses"

if [ ! -f "$NOTICES_SRC" ]; then
  echo "[install-relay-licenses] FATAL: missing $NOTICES_SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
install -m 0644 "$NOTICES_SRC" "$DEST/beap-coordination-THIRD-PARTY-NOTICES"

if [ -d "$LICENSES_SRC" ]; then
  rm -rf "$DEST/beap-coordination-licenses"
  mkdir -p "$DEST/beap-coordination-licenses"
  for f in "$LICENSES_SRC"/*; do
    [ -f "$f" ] || continue
    install -m 0644 "$f" "$DEST/beap-coordination-licenses/$(basename "$f")"
  done
fi

echo "[install-relay-licenses] OK — relay notices installed under $DEST"
echo "  - $DEST/beap-coordination-THIRD-PARTY-NOTICES"
echo "  - $DEST/beap-coordination-licenses/ (if present)"
