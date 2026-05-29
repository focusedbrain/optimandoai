#!/usr/bin/env bash
# BEAP relay host bootstrap — version-controlled deploy for /opt/beap (wrdesk.com).
# Fail-closed: exits non-zero if Podman or BEAP ingestor isolation is unavailable.
#
# Install layout (default):
#   /opt/beap/deploy-relay-host.sh          — this script
#   /opt/beap/scripts/beap-isolation-preflight.sh
#   /opt/beap/licenses/                     — optional attribution (install-relay-licenses.sh)
#
# Usage (from monorepo checkout on relay VM):
#   sudo BEAP_REPO_ROOT=/path/to/checkout ./packages/coordination-service/deploy-bundle/deploy-relay-host.sh
#
# Or after copying to /opt/beap:
#   sudo BEAP_REPO_ROOT=/opt/beap/src ./deploy-relay-host.sh

set -euo pipefail

TAG="[BEAP_RELAY_DEPLOY]"
BEAP_REPO_ROOT="${BEAP_REPO_ROOT:-}"
BEAP_OPT_ROOT="${BEAP_OPT_ROOT:-/opt/beap}"
PODMAN_BIN="${PODMAN_BIN:-podman}"
COORD_IMAGE="${COORD_IMAGE:-beap-coordination:latest}"
INGESTOR_URL="${COORD_BEAP_INGESTOR_URL:-http://127.0.0.1:18100}"
POD_AUTH_SECRET="${POD_AUTH_SECRET:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "${TAG} FATAL: required command not found: $1" >&2
    exit 1
  fi
}

resolve_repo_root() {
  if [ -n "${BEAP_REPO_ROOT}" ] && [ -d "${BEAP_REPO_ROOT}/packages/beap-pod" ]; then
    echo "${BEAP_REPO_ROOT}"
    return 0
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -d "${here}/../../beap-pod" ]; then
    (cd "${here}/../.." && pwd)
    return 0
  fi
  echo "${TAG} FATAL: set BEAP_REPO_ROOT to a checkout containing packages/beap-pod" >&2
  exit 1
}

main() {
  echo "${TAG} BEAP relay host deploy — Podman + ingestor pod + isolation preflight"

  require_cmd "${PODMAN_BIN}"
  require_cmd envsubst
  require_cmd curl

  REPO_ROOT="$(resolve_repo_root)"
  PREFLIGHT="${REPO_ROOT}/packages/coordination-service/scripts/beap-isolation-preflight.sh"
  RELAY_MANIFEST="${REPO_ROOT}/packages/beap-pod/pod-relay-host.yaml"
  LICENSES_INSTALL="${REPO_ROOT}/packages/coordination-service/deploy-bundle/install-relay-licenses.sh"

  if [ ! -f "${PREFLIGHT}" ]; then
    echo "${TAG} FATAL: missing ${PREFLIGHT}" >&2
    exit 1
  fi
  if [ ! -f "${RELAY_MANIFEST}" ]; then
    echo "${TAG} FATAL: missing ${RELAY_MANIFEST}" >&2
    exit 1
  fi

  echo "${TAG} Step 1/4 — verify Podman engine"
  if ! "${PODMAN_BIN}" info >/dev/null 2>&1; then
    echo "${TAG} FATAL: ${PODMAN_BIN} info failed — install Podman first (https://podman.io/docs/installation)" >&2
    exit 1
  fi

  echo "${TAG} Step 2/4 — start BEAP relay ingestor pod (podman play kube)"
  if [ -z "${POD_AUTH_SECRET}" ]; then
    echo "${TAG} FATAL: POD_AUTH_SECRET must be set (e.g. export POD_AUTH_SECRET=\$(openssl rand -hex 32))" >&2
    exit 1
  fi
  export POD_AUTH_SECRET
  envsubst < "${RELAY_MANIFEST}" | "${PODMAN_BIN}" play kube -

  echo "${TAG} Step 3/4 — isolation preflight (Podman + ingestor /health)"
  COORD_BEAP_INGESTOR_URL="${INGESTOR_URL}" bash "${PREFLIGHT}"

  echo "${TAG} Step 4/4 — optional license attribution under ${BEAP_OPT_ROOT}/licenses"
  if [ -f "${LICENSES_INSTALL}" ]; then
    BEAP_RELAY_LICENSES_DIR="${BEAP_OPT_ROOT}/licenses" bash "${LICENSES_INSTALL}" || true
  else
    echo "${TAG} WARN: install-relay-licenses.sh not found — skip host license copy"
  fi

  echo "${TAG} OK — relay host ready for coordination-service (image=${COORD_IMAGE}, ingestor=${INGESTOR_URL})"
  echo "${TAG} Start coordination with COORD_BEAP_INGESTOR_URL=${INGESTOR_URL} (Node preflight runs at boot)."
}

main "$@"
