#!/usr/bin/env bash
# Kill WR Desk dev / packaged processes on Linux and macOS.
# Targeted patterns only — does NOT run blanket `pkill electron` (avoids killing Cursor IDE).
# MV3 extension code runs inside Chrome; reload the extension in chrome://extensions after restarts.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[kill-wr-desk-unix] project root: $ROOT"

# Orchestrator HTTP (Electron main)
fuser -k 51248/tcp 2>/dev/null || true

# Unique path marker — must NOT use bare `pkill -f` here: the script path and parent
# (node kill-wr-desk.cjs / bash restart.sh) also contain this string and would be killed.
MARKER="electron-vite-project"
for pid in $(pgrep -f "$MARKER" 2>/dev/null || true); do
  [ "$pid" = "$$" ] && continue
  [ "$pid" = "$PPID" ] && continue
  kill -9 "$pid" 2>/dev/null || true
done

# Packaged app names (electron-builder)
pkill -9 -f "WR Desk" 2>/dev/null || true
pkill -9 -f "com.wrcode.desktop" 2>/dev/null || true

sleep 1
echo "[kill-wr-desk-unix] done"
