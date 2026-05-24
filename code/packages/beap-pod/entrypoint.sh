#!/bin/sh
# BEAP pod role dispatcher
# Selects the role binary based on the BEAP_ROLE environment variable.
# Every container in the pod shares this image; the pod manifest sets BEAP_ROLE
# per container to ingestor | validator | depackager | sealer.
#
# Usage: docker/podman run --rm -e BEAP_ROLE=ingestor beap-components:dev
set -e

ROLE="${BEAP_ROLE:-}"

case "$ROLE" in
  ingestor)
    exec node /app/packages/beap-pod/dist/roles/ingestor.js
    ;;
  validator)
    exec node /app/packages/beap-pod/dist/roles/validator.js
    ;;
  depackager)
    exec node /app/packages/beap-pod/dist/roles/depackager.js
    ;;
  sealer)
    exec node /app/packages/beap-pod/dist/roles/sealer.js
    ;;
  "")
    echo "BEAP_ROLE is not set" >&2
    exit 1
    ;;
  *)
    echo "Unknown BEAP_ROLE: $ROLE" >&2
    exit 1
    ;;
esac
