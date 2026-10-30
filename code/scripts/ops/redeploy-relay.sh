#!/usr/bin/env bash
# Redeploy the coordination relay (packages/coordination-service) on the server.
#
# What it does, in order:
#   1. Finds the running relay container (podman or docker) and reads its configuration:
#      port bindings, volumes/bind mounts, environment (only what differs from the image
#      defaults), restart policy, network.
#   2. Updates (or clones) the repository and checks that the fix is in the source.
#   3. Builds a new image from packages/coordination-service/Dockerfile.
#   4. Backs up the relay database file from the /data volume.
#   5. Stops the old container, keeps it as <name>-old-<timestamp>, starts the new one
#      with the same configuration, and waits for /health.
#   6. On any failure after the stop: removes the new container and starts the old one again.
#
# The old container is NOT deleted; the script prints the command to remove it.
#
# Options (environment variables):
#   REPO_DIR=~/optimandoai        where the repository lives (cloned if missing)
#   BRANCH=integration/consolidated-current
#   CONTAINER=<name>              skip auto-detection
#   CONTAINER_RUNTIME=docker      force the runtime (default: podman if present, else docker)
#   DRY_RUN=1                     detect, build and print the plan; change nothing
#   YES=1                         do not ask before replacing the container
set -euo pipefail

REPO_URL="https://github.com/focusedbrain/optimandoai.git"
REPO_DIR="${REPO_DIR:-$HOME/optimandoai}"
BRANCH="${BRANCH:-integration/consolidated-current}"
TS="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Container runtime ─────────────────────────────────────────────────────
if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then RT="$CONTAINER_RUNTIME"
elif command -v podman >/dev/null 2>&1; then RT=podman
elif command -v docker >/dev/null 2>&1; then RT=docker
else die "neither podman nor docker found"; fi
say "Container runtime: $RT (user $(id -un))"

# ── 1. Find the relay container ──────────────────────────────────────────────
find_container() {
  local id cmd img
  for id in $($RT ps -q); do
    cmd="$($RT inspect "$id" --format '{{join .Config.Cmd " "}} {{join .Config.Entrypoint " "}}' 2>/dev/null || true)"
    img="$($RT inspect "$id" --format '{{.Config.Image}}' 2>/dev/null || true)"
    if [[ "$cmd" == *coordination-service* || "$img" == *coordination* ]]; then
      $RT inspect "$id" --format '{{.Name}}' | sed 's#^/##'
      return 0
    fi
  done
  return 1
}
if [[ -z "${CONTAINER:-}" ]]; then
  CONTAINER="$(find_container || true)"
fi
if [[ -z "${CONTAINER:-}" ]]; then
  $RT ps --format '{{.Names}}  {{.Image}}' || true
  if [[ "$(id -u)" != 0 ]]; then
    die "no running relay container found for this user. If it runs as root, re-run with: sudo -E bash $0"
  fi
  die "no running relay container found. Set CONTAINER=<name> and re-run."
fi
say "Relay container: $CONTAINER"

insp() { $RT inspect "$CONTAINER" --format "$1"; }

# Managed by systemd (quadlet / generated unit)? Then systemd would restart the old one.
SYSTEMD_UNIT="$(insp '{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}' 2>/dev/null || true)"
[[ "$SYSTEMD_UNIT" == "<no value>" ]] && SYSTEMD_UNIT=""
if [[ -n "$SYSTEMD_UNIT" ]]; then
  die "the container is managed by systemd unit '$SYSTEMD_UNIT'. Update the image reference in that unit instead (this script does not edit systemd units)."
fi
POD="$(insp '{{.Pod}}' 2>/dev/null || true)"
if [[ -n "$POD" && "$POD" != "<no value>" ]]; then
  die "the container runs inside pod '$POD' (ports belong to the pod). Not handled automatically."
fi

OLD_IMAGE="$(insp '{{.Config.Image}}')"
OLD_IMAGE_ID="$(insp '{{.Image}}')"
RESTART="$(insp '{{.HostConfig.RestartPolicy.Name}}')"
NETWORK="$(insp '{{.HostConfig.NetworkMode}}')"

# Port bindings → -p flags
PORT_ARGS=()
while IFS='|' read -r hip hport cport; do
  [[ -z "$cport" ]] && continue
  if [[ -n "$hip" && "$hip" != "0.0.0.0" && "$hip" != "::" ]]; then PORT_ARGS+=(-p "$hip:$hport:$cport")
  else PORT_ARGS+=(-p "$hport:$cport"); fi
done < <(insp '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostIp}}|{{.HostPort}}|{{$p}}{{println}}{{end}}{{end}}')

# Mounts → -v flags
MOUNT_ARGS=()
DATA_SOURCE=""
while IFS='|' read -r mtype mname msrc mdst mrw; do
  [[ -z "$mdst" ]] && continue
  src="$msrc"; [[ "$mtype" == "volume" && -n "$mname" ]] && src="$mname"
  opt=""; [[ "$mrw" == "false" ]] && opt=":ro"
  MOUNT_ARGS+=(-v "$src:$mdst$opt")
  [[ "$mdst" == "/data" ]] && DATA_SOURCE="$src"
done < <(insp '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}')
[[ -n "$DATA_SOURCE" ]] || die "no volume mounted at /data — the queue and handshake registry would be lost. Aborting."

# Environment: only entries that differ from the old image's defaults (secrets stay on the server)
IMAGE_ENV="$($RT image inspect "$OLD_IMAGE_ID" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
ENV_ARGS=()
ENV_KEYS=()
while IFS= read -r kv; do
  [[ -z "$kv" ]] && continue
  if ! grep -qxF -- "$kv" <<<"$IMAGE_ENV"; then
    ENV_ARGS+=(-e "$kv")
    ENV_KEYS+=("${kv%%=*}")
  fi
done < <(insp '{{range .Config.Env}}{{println .}}{{end}}')

NET_ARGS=()
case "$NETWORK" in
  ""|default|bridge|slirp4netns|pasta|private|"<no value>") ;;
  *) NET_ARGS+=(--network "$NETWORK") ;;
esac
RESTART_ARGS=(--restart "${RESTART:-unless-stopped}")
[[ -z "$RESTART" || "$RESTART" == "no" || "$RESTART" == "<no value>" ]] && RESTART_ARGS=(--restart unless-stopped)

info "image:    $OLD_IMAGE"
info "ports:    ${PORT_ARGS[*]:-(none — reached via network '$NETWORK')}"
info "mounts:   ${MOUNT_ARGS[*]}"
info "env keys: ${ENV_KEYS[*]:-(image defaults only)}"
info "network:  ${NETWORK:-default}   restart: ${RESTART_ARGS[1]}"

# ── 2. Repository ────────────────────────────────────────────────────────────
say "Repository: $REPO_DIR ($BRANCH)"
command -v git >/dev/null 2>&1 || die "git not installed"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi
CODE_DIR="$REPO_DIR/code"
[[ -f "$CODE_DIR/packages/coordination-service/Dockerfile" ]] || die "Dockerfile not found under $CODE_DIR"
SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
info "commit:   $(git -C "$REPO_DIR" log -1 --format='%h %s')"
grep -q "removeIfCurrent" "$CODE_DIR/packages/coordination-service/src/wsManager.ts" \
  || die "the checked-out source does not contain the takeover fix (removeIfCurrent). Wrong branch?"

# ── 3. Build ─────────────────────────────────────────────────────────────────
NEW_IMAGE="coordination-service:$SHA"
say "Building $NEW_IMAGE"
(cd "$CODE_DIR" && $RT build -t "$NEW_IMAGE" -f packages/coordination-service/Dockerfile .)

# "${arr[@]+"${arr[@]}"}" keeps empty arrays safe under `set -u` on older bash.
RUN_ARGS=(-d --name "$CONTAINER" "${RESTART_ARGS[@]}"
  ${NET_ARGS[@]+"${NET_ARGS[@]}"} ${PORT_ARGS[@]+"${PORT_ARGS[@]}"}
  "${MOUNT_ARGS[@]}" ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} "$NEW_IMAGE")
say "Plan"
info "1. stop $CONTAINER"
info "2. back up /data/coordination.db (+ -wal/-shm) next to the original"
info "3. keep the old container as $CONTAINER-old-$TS"
info "4. $RT run -d --name $CONTAINER ${RESTART_ARGS[*]} ${NET_ARGS[*]+${NET_ARGS[*]}} ${PORT_ARGS[*]+${PORT_ARGS[*]}} ${MOUNT_ARGS[*]} <${#ENV_KEYS[@]} -e entries> $NEW_IMAGE"
info "5. wait for /health; roll back automatically on failure"

if [[ "${DRY_RUN:-0}" == 1 ]]; then
  say "DRY_RUN=1 — nothing changed."
  exit 0
fi
if [[ "${YES:-0}" != 1 ]]; then
  read -r -p "    Replace the running relay now? [y/N] " answer </dev/tty
  [[ "$answer" == y || "$answer" == Y ]] || die "aborted by user"
fi

# ── 4./5. Stop, back up, replace ─────────────────────────────────────────────
OLD_NAME="$CONTAINER-old-$TS"
exists() { $RT container inspect "$1" >/dev/null 2>&1; }
rollback() {
  trap - ERR
  printf '\n\033[31mRolling back to the previous container.\033[0m\n' >&2
  if exists "$OLD_NAME"; then
    # The old container was renamed: whatever runs under the original name is the new one.
    $RT rm -f "$CONTAINER" >/dev/null 2>&1 || true
    $RT rename "$OLD_NAME" "$CONTAINER" >/dev/null 2>&1 || true
  fi
  # Never delete under the original name unless the old one is safe under OLD_NAME.
  $RT start "$CONTAINER" >/dev/null 2>&1 || true
  $RT ps --filter "name=$CONTAINER" --format '{{.Names}}  {{.Image}}  {{.Status}}' >&2 || true
  exit 1
}
trap rollback ERR

say "Stopping $CONTAINER"
$RT stop -t 20 "$CONTAINER" >/dev/null

say "Backing up the relay database (stopped, so the copy is consistent)"
$RT run --rm -v "$DATA_SOURCE:/data" --entrypoint sh "$NEW_IMAGE" -c \
  "for f in /data/coordination.db /data/coordination.db-wal /data/coordination.db-shm; do [ -f \"\$f\" ] && cp \"\$f\" \"\$f.bak-$TS\"; done; ls -l /data | grep bak-$TS || echo 'no db file (fresh relay?)'" \
  | sed 's/^/    /'

say "Starting the new relay"
$RT rename "$CONTAINER" "$OLD_NAME"
$RT run "${RUN_ARGS[@]}" >/dev/null

say "Waiting for /health"
healthy=0
for _ in $(seq 1 30); do
  if $RT exec "$CONTAINER" node -e "fetch('http://127.0.0.1:'+(process.env.COORD_PORT||51249)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  $RT logs --tail 40 "$CONTAINER" >&2 || true
  false   # triggers rollback via ERR trap
fi
trap - ERR
# The old container must not come back on a reboot.
$RT update --restart=no "$OLD_NAME" >/dev/null 2>&1 || true

say "Done"
info "running: $($RT ps --filter "name=^${CONTAINER}\$" --format '{{.Names}}  {{.Image}}  {{.Status}}')"
info "logs:    $RT logs --tail 50 $CONTAINER"
info "public:  curl -s https://relay.optirando.com/health"
info "remove the old container once you are satisfied:"
info "         $RT rm $OLD_NAME"
info "roll back manually if needed:"
info "         $RT stop $CONTAINER && $RT rm $CONTAINER && $RT rename $OLD_NAME $CONTAINER && $RT start $CONTAINER"
