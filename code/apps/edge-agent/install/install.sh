#!/usr/bin/env bash
# WR Desk Edge Agent installer (Stream C — stub; full Podman + package install in PR3/PR10)
set -euo pipefail

echo "WR Desk Edge Agent installer"
echo "Supported: Debian, Ubuntu, Fedora, RHEL, Rocky, Alma"
echo ""
echo "This script will (in a future release):"
echo "  - Install Podman if missing"
echo "  - Install wrdesk-edge-agent to /usr/local/bin"
echo "  - Install systemd unit wrdesk-edge-agent.service"
echo "  - Open firewall TCP 8443 (pairing API) if using ufw/firewalld"
echo "  - Start the agent and print setup URL http://127.0.0.1:8090/ (SSH tunnel)"
echo ""
echo "For development, run: pnpm --filter @app/edge-agent build && pnpm --filter @app/edge-agent start"
echo ""
# Optional: set BEAP_IMAGE_DIGEST before running to pull by digest (must match expected-image-digest.json).
if [[ -n "${BEAP_IMAGE_DIGEST:-}" ]] && [[ "${BEAP_IMAGE_DIGEST}" != sha256:0000000000000000000000000000000000000000000000000000000000000000 ]]; then
  DIGEST_HEX="${BEAP_IMAGE_DIGEST#sha256:}"
  echo "Pulling beap-components@${BEAP_IMAGE_DIGEST} ..."
  podman pull "beap-components@sha256:${DIGEST_HEX}"
  podman tag "beap-components@sha256:${DIGEST_HEX}" beap-components:dev
else
  echo "Set BEAP_IMAGE_DIGEST after: pnpm --filter @app/edge-agent run update-image-digest"
fi
