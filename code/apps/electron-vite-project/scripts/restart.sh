#!/bin/bash
# Restart Electron app: kill processes, clean cache, start dev (survives terminal close)
set -e
cd "$(dirname "$0")/.."

echo "1. Killing electron & vite..."
pkill -9 -f electron 2>/dev/null || true
pkill -9 -f "node.*vite" 2>/dev/null || true
sleep 2

echo "2. Cleaning cache..."
rm -rf dist/ dist-electron/ out/ .vite/ node_modules/.vite

echo "3. Starting pnpm dev (detached)..."
setsid nohup pnpm dev >> /tmp/electron.log 2>&1 </dev/null &
disown 2>/dev/null || true

echo "Done. App starting in background. Log: tail -f /tmp/electron.log"
