#!/bin/bash
# rebuild.sh - Kill Electron, clear cache, rebuild and start dev
cd "$(dirname "$0")"

pkill -f electron 2>/dev/null
sleep 1
pkill -9 -f electron 2>/dev/null
rm -rf dist/ dist-electron/ out/ .vite/ node_modules/.vite
pnpm build && ELECTRON_ENABLE_LOGGING=1 pnpm dev
