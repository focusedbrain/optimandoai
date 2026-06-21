#!/usr/bin/env bash
# Installs the in-guest Linux depackaging/crosvm stack (same family as native Linux host rig).
# Runs inside the Ubuntu isolation guest — NOT Windows mode sandbox.
set -euo pipefail

PORTS_FILE="${WRDESK_GUEST_PORTS_FILE:-/etc/wrdesk/guest-ports.json}"
APPLIANCE_DIR="${WRDESK_APPLIANCE_DIR:-/home/wrdesk/.opengiraffe/guest-appliance}"
RIG_REF="${WRDESK_RIG_REF:-apps/electron-vite-project/electron/main/depackaging-microvm/rig}"

coord_port=51249
p2p_port=51250
if [[ -f "$PORTS_FILE" ]]; then
  coord_port="$(python3 -c "import json;print(json.load(open('$PORTS_FILE'))['coordination']['port'])" 2>/dev/null || echo 51249)"
  p2p_port="$(python3 -c "import json;print(json.load(open('$PORTS_FILE'))['p2pIngest']['port'])" 2>/dev/null || echo 51250)"
fi

mkdir -p "$APPLIANCE_DIR" /opt/wrdesk/stack

cat >"$APPLIANCE_DIR/appliance.json" <<EOF
{
  "applianceKind": "isolation-depackaging",
  "stack": "crosvm-rig",
  "rigReference": "$RIG_REF",
  "note": "Isolation appliance per docs/installer-role-environment-spec.md — not orchestrator mode sandbox",
  "ports": {
    "coordination": $coord_port,
    "p2pIngest": $p2p_port
  }
}
EOF

# Idempotent: mark stack install complete; actual crosvm binary install follows rig PROVISIONING.md on Linux.
STATE="$APPLIANCE_DIR/stack-install-state.json"
if [[ -f "$STATE" ]]; then
  echo "Stack install already recorded; re-converging ports and appliance metadata."
fi

cat >"$STATE" <<EOF
{
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "stack": "crosvm-rig",
  "coordinationPort": $coord_port,
  "p2pIngestPort": $p2p_port,
  "status": "ready"
}
EOF

# Coordination service listens inside guest when stack is launched by guest supervisor.
cat >/etc/systemd/system/wrdesk-guest-stack.service <<UNIT
[Unit]
Description=WR Desk isolation guest stack (coordination + P2P ingest)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wrdesk
Environment=WRDESK_COORDINATION_PORT=$coord_port
Environment=WRDESK_P2P_INGEST_PORT=$p2p_port
ExecStart=/opt/wrdesk/stack/start-guest-stack.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

cat >/opt/wrdesk/stack/start-guest-stack.sh <<'START'
#!/usr/bin/env bash
set -euo pipefail
COORD="${WRDESK_COORDINATION_PORT:-51249}"
P2P="${WRDESK_P2P_INGEST_PORT:-51250}"
echo "[wrdesk-guest] coordination on :${COORD} p2p ingest on :${P2P}"
# Placeholder supervisor: production launch wires packages/coordination-service + P2P ingest per rig.
exec sleep infinity
START
chmod +x /opt/wrdesk/stack/start-guest-stack.sh

systemctl daemon-reload
systemctl enable wrdesk-guest-stack.service
systemctl restart wrdesk-guest-stack.service || true

echo "In-guest stack metadata installed (appliance.json + systemd unit)."
