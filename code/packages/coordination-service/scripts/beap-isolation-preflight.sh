#!/usr/bin/env sh
# Relay host deploy/boot gate — BEAP capsule isolation via Podman + ingestor pod.
# Wire as: systemd ExecStartPre=, compose command wrapper, or coordination docker-entrypoint.sh
# Exit non-zero on failure; coordination-service must not serve untrusted capsules without this.

set -eu

TAG="[BEAP_ISOLATION_PREFLIGHT]"
INGESTOR_URL="${COORD_BEAP_INGESTOR_URL:-http://127.0.0.1:18100}"
HEALTH_URL="${INGESTOR_URL%/}/health"
PODMAN_BIN="${PODMAN_BIN:-podman}"

if [ "${COORD_BEAP_ISOLATION_SKIP:-}" = "1" ]; then
  echo "${TAG} FATAL: COORD_BEAP_ISOLATION_SKIP is forbidden — relay must use ingestor pod isolation." >&2
  exit 1
fi

if [ "${COORD_TEST_MODE:-}" = "1" ] && [ "${NODE_ENV:-}" != "production" ]; then
  echo "${TAG} SKIP — COORD_TEST_MODE (non-production test only)"
  exit 0
fi

if [ "${COORD_TEST_MODE:-}" = "1" ] && [ "${NODE_ENV:-}" = "production" ]; then
  echo "${TAG} FATAL: COORD_TEST_MODE must not be set in production." >&2
  exit 1
fi

if ! command -v "${PODMAN_BIN}" >/dev/null 2>&1; then
  echo "${TAG} FATAL: ${PODMAN_BIN} not found on PATH." >&2
  echo "${TAG} Install Podman on the relay host (do not bundle inside coordination image)." >&2
  echo "${TAG} See https://podman.io/docs/installation" >&2
  exit 1
fi

if ! "${PODMAN_BIN}" info >/dev/null 2>&1; then
  echo "${TAG} FATAL: ${PODMAN_BIN} info failed — engine not healthy." >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  if ! curl -sf --max-time 10 "${HEALTH_URL}" >/dev/null; then
    echo "${TAG} FATAL: ingestor not healthy at ${HEALTH_URL}" >&2
    echo "${TAG} Start BEAP relay pod: envsubst < packages/beap-pod/pod-relay-host.yaml | podman play kube -" >&2
    exit 1
  fi
else
  echo "${TAG} WARN: curl missing — skipping HTTP health probe (Node preflight still required)" >&2
fi

echo "${TAG} OK — container runtime present; ingestor health reachable at ${HEALTH_URL}"
exit 0
