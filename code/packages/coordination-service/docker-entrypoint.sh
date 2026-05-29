#!/usr/bin/env sh
# Node boot runs runRelayPodIsolationPreflight (packages/coordination-service/src/index.ts).
# Host-level gate: packages/coordination-service/scripts/beap-isolation-preflight.sh (systemd ExecStartPre).
set -eu
exec tini -- node packages/coordination-service/dist/index.js "$@"
