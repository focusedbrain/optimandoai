#!/usr/bin/env bash
# BEAP Coordination Service - Safe Podman Deploy
#
# Run on the relay server. The canonical copy lives in the repository at
# code/scripts/ops/deploy-podman.sh.
#
# Conservative deploy:
# - pulls origin/<BRANCH> (default: integration/consolidated-current)
# - verifies pnpm build approvals in pnpm-workspace.yaml
# - builds image with Podman
# - stops old container only after successful image build
# - backs up the relay database while the container is stopped
# - starts new container
# - requires final HTTP 200 health result
# - prints green Success 200 banner on success
# - prints red Failed to Deploy banner on failure
#
# This script does NOT modify repository files.
# This script does NOT patch Dockerfile.
# This script does NOT run git diff.
# This script does NOT use Python.
#
# Overrides (environment variables): BRANCH, CODE_DIR, COORD_OIDC_ISSUER,
# COORD_OIDC_JWKS_URL, COORD_OIDC_AUDIENCE.

set -Eeuo pipefail

# --- Configuration ---
CODE_DIR="${CODE_DIR:-/opt/beap/code}"
BRANCH="${BRANCH:-integration/consolidated-current}"

CONTAINER="beap-coordination"
IMAGE_NAME="beap-coordination"
IMAGE_LATEST="${IMAGE_NAME}:latest"
IMAGE_PREVIOUS="${IMAGE_NAME}:previous"

PORT="51249"
HEALTH_URL="http://localhost:${PORT}/health"

DOCKERFILE_PATH="packages/coordination-service/Dockerfile"

DATA_VOLUME="beap-coordination-data"

# The app signs in at auth.optirando.com (src/auth/oidcConfig.ts); Keycloak puts that
# host into the token's `iss`, and the relay verifies `iss` exactly. auth.wrdesk.com
# (pre-rebrand) is no longer reachable.
OIDC_ISSUER="${COORD_OIDC_ISSUER:-https://auth.optirando.com/realms/wrdesk}"
OIDC_JWKS_URL="${COORD_OIDC_JWKS_URL:-${OIDC_ISSUER}/protocol/openid-connect/certs}"
OIDC_AUDIENCE="${COORD_OIDC_AUDIENCE:-wrdesk-orchestrator}"

HEALTH_RETRIES=15
HEALTH_INTERVAL=2

PNPM_VERSION="10.28.2"

REQUIRED_ALLOW_BUILDS=(
  "better-sqlite3"
  "canvas"
  "esbuild"
  "electron"
)

# --- Colors / banners ---
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
NC=$'\033[0m'

SUCCESS_LINE="----------------------------------------------------------------------------------------------------------- Success 200 ------------------------------------------------------------------------"
FAILED_LINE="------------------------------------------------------------- Failed to Deploy ------------------------------------------------------------------"

DEPLOY_FINISHED=0

print_success_banner() {
  echo ""
  echo "${GREEN}${SUCCESS_LINE}${NC}"
  echo ""
}

print_failed_banner() {
  echo ""
  echo "${RED}${FAILED_LINE}${NC}"
  echo ""
}

# --- Logging ---
log()  { echo "[deploy] $*"; }
warn() { echo "${YELLOW}[deploy][WARN] $*${NC}" >&2; }
err()  { echo "${RED}[deploy][ERROR] $*${NC}" >&2; }

fail() {
  err "$*"
  print_failed_banner
  DEPLOY_FINISHED=1
  exit 1
}

on_error() {
  local exit_code=$?
  if [[ "$DEPLOY_FINISHED" -eq 0 ]]; then
    err "Unexpected deploy failure. Exit code: ${exit_code}"
    print_failed_banner
  fi
  exit "$exit_code"
}

trap on_error ERR

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed"
}

# --- Health check with visible HTTP status ---
health_check() {
  local attempt
  local status="000"
  local body_file="/tmp/beap-coordination-health-body.txt"

  rm -f "$body_file"

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    status="$(curl -sS -o "$body_file" -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")"

    log "Health check attempt ${attempt}/${HEALTH_RETRIES}: HTTP ${status}"

    if [[ "$status" == "200" ]]; then
      log "Health check passed: HTTP 200"
      log "Health response body:"
      cat "$body_file" || true
      echo ""
      return 0
    fi

    sleep "$HEALTH_INTERVAL"
  done

  err "Health check failed. Last HTTP status: ${status}"
  err "Last health response body:"
  cat "$body_file" >&2 || true
  echo "" >&2

  return 1
}

# --- Build failure diagnostics ---
show_build_failure_help() {
  local build_log="$1"

  if grep -q "ERR_PNPM_IGNORED_BUILDS" "$build_log"; then
    err ""
    err "Detected ERR_PNPM_IGNORED_BUILDS."
    err "pnpm blocked native/tooling build scripts."
    err "Fix must be committed in code/pnpm-workspace.yaml under allowBuilds."
    err "Expected allowBuilds entries: ${REQUIRED_ALLOW_BUILDS[*]}"
  fi

  if grep -q "ERR_PNPM_LOCKFILE_CONFIG_MISMATCH\|ERR_PNPM_OUTDATED_LOCKFILE" "$build_log"; then
    err ""
    err "Detected pnpm lockfile/config mismatch."
    err "Regenerate/update pnpm-lock.yaml on dev with the same pnpm version and commit it."
    err "Expected pnpm version: ${PNPM_VERSION}"
  fi

  if grep -q "Cannot find module\|MODULE_NOT_FOUND" "$build_log"; then
    err ""
    err "Detected module resolution failure during build."
  fi

  if grep -q "node-gyp\|gyp ERR" "$build_log"; then
    err ""
    err "Detected native module build failure."
  fi
}

# --- Run container ---
run_container() {
  local image="$1"

  podman run -d \
    --name "$CONTAINER" \
    --restart=always \
    -p "${PORT}:${PORT}" \
    -v "${DATA_VOLUME}:/data" \
    -e COORD_HOST=0.0.0.0 \
    -e COORD_PORT="$PORT" \
    -e COORD_DB_PATH=/data/coordination.db \
    -e COORD_OIDC_ISSUER="$OIDC_ISSUER" \
    -e COORD_OIDC_JWKS_URL="$OIDC_JWKS_URL" \
    -e COORD_OIDC_AUDIENCE="$OIDC_AUDIENCE" \
    "$image" >/dev/null
}

# --- Database backup (container stopped, so the copy is consistent) ---
backup_database() {
  local image="$1"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"

  log "Backing up relay database in volume ${DATA_VOLUME} (suffix .bak-${stamp})..."
  podman run --rm \
    -v "${DATA_VOLUME}:/data" \
    --entrypoint sh \
    "$image" -c "
      found=0
      for f in /data/coordination.db /data/coordination.db-wal /data/coordination.db-shm; do
        if [ -f \"\$f\" ]; then cp \"\$f\" \"\$f.bak-${stamp}\"; found=1; fi
      done
      if [ \"\$found\" = 1 ]; then ls -l /data | grep 'bak-${stamp}'; else echo 'No database file yet (fresh relay).'; fi
    " || fail "Database backup failed. Old container is stopped; start it again with: podman start ${CONTAINER}"
  log "Restore if ever needed: stop the container, copy coordination.db.bak-${stamp} back to coordination.db in the volume."
}

# --- Rollback ---
rollback_previous() {
  warn "Attempting rollback to previous image: $IMAGE_PREVIOUS"

  podman stop "$CONTAINER" 2>/dev/null || true
  podman rm "$CONTAINER" 2>/dev/null || true

  if ! podman image exists "$IMAGE_PREVIOUS"; then
    err "No previous image available for rollback."
    return 1
  fi

  run_container "$IMAGE_PREVIOUS"
  sleep 2

  if ! podman ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    err "Rollback container failed to stay running."
    podman logs --tail 100 "$CONTAINER" >&2 || true
    return 1
  fi

  if ! health_check; then
    err "Rollback container failed health check."
    podman logs --tail 150 "$CONTAINER" >&2 || true
    return 1
  fi

  warn "Rollback succeeded. Previous image is running."
  return 0
}

# --- Preflight ---
log "=== BEAP COORDINATION DEPLOY ==="
log "Code dir: $CODE_DIR"
log "Branch: $BRANCH"
log "Container: $CONTAINER"
log "Image latest: $IMAGE_LATEST"
log "Image previous: $IMAGE_PREVIOUS"
log "Port: $PORT"
log "Health URL: $HEALTH_URL"
log "Dockerfile: $DOCKERFILE_PATH"
log "Data volume: $DATA_VOLUME"
log "OIDC issuer: $OIDC_ISSUER"
log "OIDC JWKS: $OIDC_JWKS_URL"
log "OIDC audience: $OIDC_AUDIENCE"
log "pnpm version build arg: $PNPM_VERSION"

require_cmd git
require_cmd podman
require_cmd curl

[[ -d "$CODE_DIR" ]] || fail "Code dir does not exist: $CODE_DIR"
cd "$CODE_DIR"

# The relay must be able to fetch the signing keys, otherwise it rejects every token.
JWKS_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$OIDC_JWKS_URL" 2>/dev/null || echo "000")"
[[ "$JWKS_STATUS" == "200" ]] || fail "OIDC JWKS not reachable from this server (HTTP ${JWKS_STATUS}): $OIDC_JWKS_URL"
log "OIDC JWKS reachable: HTTP 200"

# --- Repo update ---
log "Updating repository from origin/${BRANCH}..."

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/${BRANCH}" >/dev/null
git reset --hard "origin/${BRANCH}"

COMMIT="$(git rev-parse --short HEAD)"
FULL_COMMIT="$(git rev-parse HEAD)"
NEW_IMAGE="${IMAGE_NAME}:${COMMIT}"

log "Repo commit: $FULL_COMMIT"
log "Recent commits:"
git log --oneline -5

# --- Required files ---
[[ -f "$DOCKERFILE_PATH" ]] || fail "Dockerfile not found: $DOCKERFILE_PATH"
[[ -f "package.json" ]] || fail "Workspace root package.json not found"
[[ -f "pnpm-lock.yaml" ]] || fail "pnpm-lock.yaml not found"
[[ -f "pnpm-workspace.yaml" ]] || fail "pnpm-workspace.yaml not found"

# --- Validate pnpm-workspace.yaml allowBuilds ---
log "Checking pnpm-workspace.yaml allowBuilds..."

grep -q "^allowBuilds:" pnpm-workspace.yaml \
  || fail "pnpm-workspace.yaml does not contain top-level allowBuilds."

for dep in "${REQUIRED_ALLOW_BUILDS[@]}"; do
  grep -q "^[[:space:]]*${dep}:[[:space:]]*true[[:space:]]*$" pnpm-workspace.yaml \
    || fail "pnpm-workspace.yaml missing allowBuilds entry: ${dep}: true"
done

log "pnpm-workspace.yaml allowBuilds contains: ${REQUIRED_ALLOW_BUILDS[*]}"

# package.json pnpm.onlyBuiltDependencies is not authoritative for this deploy,
# but warn if missing because it can still be useful documentation.
if ! grep -q '"onlyBuiltDependencies"' package.json; then
  warn "package.json has no pnpm.onlyBuiltDependencies block. Continuing because pnpm-workspace.yaml allowBuilds is present."
fi

# --- Validate Dockerfile basics, without modifying it ---
log "Checking Dockerfile basics..."

grep -q "pnpm install" "$DOCKERFILE_PATH" \
  || fail "Dockerfile does not appear to run pnpm install."

if ! grep -q "PNPM_VERSION" "$DOCKERFILE_PATH"; then
  warn "Dockerfile does not reference PNPM_VERSION."
  warn "The build arg PNPM_VERSION=${PNPM_VERSION} may be ignored."
  warn "Continuing because this deploy script must not modify repo files."
fi

log "Relevant Dockerfile lines:"
grep -n "FROM\|PNPM_VERSION\|corepack\|pnpm install\|frozen-lockfile" "$DOCKERFILE_PATH" || true

# --- Build new image first ---
BUILD_LOG="/tmp/beap-coordination-build-${COMMIT}-$(date +%Y%m%d-%H%M%S).log"

log "Building new image first. Old container remains running during build."
log "New image: $NEW_IMAGE"
log "Build log: $BUILD_LOG"

if ! podman build \
  --no-cache \
  --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
  -t "$NEW_IMAGE" \
  -f "$DOCKERFILE_PATH" \
  . 2>&1 | tee "$BUILD_LOG"; then

  err "Build failed."
  err "Old container was not stopped."
  err "Last 120 build log lines:"
  tail -120 "$BUILD_LOG" >&2 || true

  show_build_failure_help "$BUILD_LOG"
  fail "Image build failed."
fi

log "Build succeeded: $NEW_IMAGE"

# --- Prepare rollback image ---
if podman image exists "$IMAGE_LATEST"; then
  log "Tagging current latest image as rollback image: $IMAGE_PREVIOUS"
  podman tag "$IMAGE_LATEST" "$IMAGE_PREVIOUS" || warn "Could not tag previous image."
else
  warn "No existing latest image found. Rollback image will not be available."
fi

# --- Replace running container ---
log "Stopping old container..."
podman stop "$CONTAINER" 2>/dev/null || true

backup_database "$NEW_IMAGE"

podman rm "$CONTAINER" 2>/dev/null || true

log "Starting new container from image: $NEW_IMAGE"
run_container "$NEW_IMAGE"

sleep 2

if ! podman ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  err "New container failed to stay running."
  err "Container logs:"
  podman logs --tail 150 "$CONTAINER" >&2 || true

  rollback_previous || fail "Deploy failed and rollback failed."
  fail "Deploy failed. Rollback was attempted."
fi

# --- Health check ---
log "Running health check: $HEALTH_URL"

if ! health_check; then
  err "New container failed health check."
  err "Container logs:"
  podman logs --tail 150 "$CONTAINER" >&2 || true

  rollback_previous || fail "Deploy failed and rollback failed."
  fail "Deploy failed. Rollback was attempted."
fi

# --- Promote image after successful health ---
log "Promoting $NEW_IMAGE to $IMAGE_LATEST"
podman tag "$NEW_IMAGE" "$IMAGE_LATEST"

# --- Final HTTP 200 verification ---
FINAL_HEALTH_BODY="/tmp/beap-coordination-final-health-body.txt"
FINAL_HTTP_STATUS="$(curl -sS -o "$FINAL_HEALTH_BODY" -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")"

log ""
log "=== FINAL HEALTH RESULT ==="
log "Health URL: $HEALTH_URL"
log "Final HTTP status: $FINAL_HTTP_STATUS"

if [[ "$FINAL_HTTP_STATUS" != "200" ]]; then
  err "FINAL RESULT: FAILED - expected HTTP 200, got HTTP ${FINAL_HTTP_STATUS}"
  err "Final health response body:"
  cat "$FINAL_HEALTH_BODY" >&2 || true
  echo "" >&2
  fail "Final health verification failed."
fi

log "FINAL RESULT: HTTP 200 OK"
log "Final health response body:"
cat "$FINAL_HEALTH_BODY" || true
echo ""

# --- Final report ---
log ""
log "=== DEPLOY COMPLETE ==="
log "Commit: $FULL_COMMIT"
log "Running image: $NEW_IMAGE"
log "Latest tag: $IMAGE_LATEST"
log "Container: $CONTAINER"
log "Port: $PORT"
log "Health: $HEALTH_URL"
log "OIDC issuer: $OIDC_ISSUER"
log "Build log: $BUILD_LOG"
echo ""

podman ps --filter "name=$CONTAINER"

echo ""
log "Last container logs:"
podman logs --tail 30 "$CONTAINER"

DEPLOY_FINISHED=1
print_success_banner
exit 0
