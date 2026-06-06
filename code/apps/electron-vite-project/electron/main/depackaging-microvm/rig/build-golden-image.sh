#!/usr/bin/env bash
# =============================================================================
# Build 2a — Golden image build (minimal, headless) for the depackaging worker.
#
# STATUS: VERIFIED on the mini-PC (bare-metal AMD Ryzen, Ubuntu 24.04.4,
# kernel 6.17.0-29-generic, crosvm built from source HEAD 938fc36). Replaces the
# earlier Windows-authored draft. Boot/IO facts discovered here are recorded in
# README.md §5.
#
# WHAT THE GUEST NEEDS (proven): a Node binary + the single worker-bundle.cjs
# (~77 KB). No node_modules, no native addons. We reuse the HOST kernel
# (/boot/vmlinuz-$(uname -r)) because it has VIRTIO_BLK=y, VIRTIO_CONSOLE=y,
# EXT4_FS=y, SERIAL_8250=y BUILT-IN. vsock + overlayfs are MODULES (=m) in that
# kernel, so we stage the matching .ko into the rootfs and load them in init.
#
# OUTPUT (all under $OUT, git-ignored):
#   golden-base.ext4   — read-only base rootfs (node + bundle + busybox + modules)
#   vmlinuz            — copy of the host kernel (guest kernel)
# The writable overlay is created per-boot by crosvm-launch.sh and discarded.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HOME/build/rig}"
NODE_VER="${NODE_VERSION:-22.22.0}"
# KREL = the kernel whose image + modules the guest uses. Defaults to the running
# host kernel; override (e.g. KREL=6.17.0-29-generic) to pin the guest to a
# specific, readable kernel after a host kernel point-upgrade (see rig/PROVISIONING.md).
# The guest kernel image AND the staged .ko modules must come from the SAME KREL.
KREL="${KREL:-$(uname -r)}"
MODDIR="/lib/modules/${KREL}"
ROOTFS="${OUT}/rootfs"
IMG="${OUT}/golden-base.ext4"
IMG_SIZE="${IMG_SIZE:-400M}"

mkdir -p "${OUT}"

echo "[1/6] Build the worker bundle (platform-agnostic)"
node "${HERE}/buildWorkerBundle.mjs"

echo "[2/6] Fetch + extract Node ${NODE_VER} (linux-x64)"
NODE_TARBALL="${OUT}/node-v${NODE_VER}-linux-x64.tar.xz"
[ -f "${NODE_TARBALL}" ] || curl -fsSL -o "${NODE_TARBALL}" \
  "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
rm -rf "${OUT}/node-extract" && mkdir -p "${OUT}/node-extract"
tar -xf "${NODE_TARBALL}" -C "${OUT}/node-extract"
NODE_BIN="${OUT}/node-extract/node-v${NODE_VER}-linux-x64/bin/node"

echo "[3/6] Stage the rootfs tree"
rm -rf "${ROOTFS}"
mkdir -p "${ROOTFS}"/{bin,lib,lib64,proc,sys,dev,work,opt/worker}
mkdir -p "${ROOTFS}/lib/x86_64-linux-gnu"
mkdir -p "${ROOTFS}/lib/modules"
# Node + its glibc shared libs (copied from host; guest shares the glibc world).
cp "${NODE_BIN}" "${ROOTFS}/bin/node"
for lib in $(ldd "${NODE_BIN}" | awk '/=>/ {print $3} /ld-linux/ {print $1}'); do
  [ -f "${lib}" ] || continue
  case "${lib}" in
    /lib64/*) cp -L "${lib}" "${ROOTFS}/lib64/" ;;
    *)        cp -L "${lib}" "${ROOTFS}/lib/x86_64-linux-gnu/" ;;
  esac
done
# Static busybox for the shell + coreutils (no lib deps).
cp /bin/busybox "${ROOTFS}/bin/busybox"
for applet in sh mount umount echo cat ls insmod poweroff sleep mkdir; do
  ln -sf busybox "${ROOTFS}/bin/${applet}"
done
# The worker payload.
cp "${HERE}/dist/worker-bundle.cjs" "${ROOTFS}/opt/worker/worker-bundle.cjs"
# Shared image/bundle marker = sha256 of the staged worker bundle. Stamp it INTO
# the image (/opt/worker/BUILD_MARKER) AND emit a host-readable sidecar beside the
# packed image (see step [6/6]). CrosvmProvider compares the sidecar against the
# bundle the orchestrator expects and fails fast (E_IMAGE_BUNDLE_MISMATCH) on a
# stale image instead of booting it into a vsock timeout.
BUNDLE_SHA256="$(sha256sum "${ROOTFS}/opt/worker/worker-bundle.cjs" | awk '{print $1}')"
printf '%s\n' "${BUNDLE_SHA256}" > "${ROOTFS}/opt/worker/BUILD_MARKER"
# Build 2b: the static guest-side vsock job server (wires the vsock connection
# onto node's stdin/stdout — same JSON contract, transport = socket).
gcc -static -O2 -o "${ROOTFS}/bin/vsock-job-server" "${HERE}/vsock-job-server.c"
# Build 2b: the static host-side vsock client CrosvmProvider spawns (Node has no
# native AF_VSOCK). Lives in $OUT (overridable via CrosvmProviderConfig).
gcc -static -O2 -o "${OUT}/vsock-host-client" "${HERE}/vsock-host-client.c"

echo "[4/6] Stage vsock + overlay kernel modules (decompressed for busybox insmod)"
MODOUT="${ROOTFS}/lib/modules"
stage_mod() { # $1 = .ko.zst path
  local z="$1"; local base; base="$(basename "${z%.zst}")"
  zstd -q -d -f "${z}" -o "${MODOUT}/${base}"
}
stage_mod "${MODDIR}/kernel/net/vmw_vsock/vsock.ko.zst"
stage_mod "${MODDIR}/kernel/net/vmw_vsock/vmw_vsock_virtio_transport_common.ko.zst"
stage_mod "${MODDIR}/kernel/net/vmw_vsock/vmw_vsock_virtio_transport.ko.zst"
stage_mod "${MODDIR}/kernel/fs/overlayfs/overlay.ko.zst"
ls -l "${MODOUT}"

echo "[5/6] Install the guest init (Build 2b: vsock job server -> worker; fire-and-forget)"
# JOB_PORT must match CrosvmProvider's vsockPort (default 5252).
cat > "${ROOTFS}/init" <<'INIT'
#!/bin/sh
/bin/busybox mount -t proc proc /proc 2>/dev/null
/bin/busybox mount -t sysfs sys /sys 2>/dev/null
/bin/busybox mount -t devtmpfs dev /dev 2>/dev/null
/bin/busybox mount -t tmpfs tmpfs /tmp 2>/dev/null
# vsock guest driver is a module (=m) in the reused host kernel — load in order.
/bin/busybox insmod /lib/modules/vsock.ko 2>/dev/null
/bin/busybox insmod /lib/modules/vmw_vsock_virtio_transport_common.ko 2>/dev/null
/bin/busybox insmod /lib/modules/vmw_vsock_virtio_transport.ko 2>/dev/null
# Ephemeral writable overlay disk (vdb), mounted for the worker's scratch; the
# whole disk is discarded by CrosvmProvider on nuke (RO base never mutates).
[ -b /dev/vdb ] && /bin/busybox mount /dev/vdb /work 2>/dev/null
# Serve exactly one job over vsock, then power off (create->run->nuke).
/bin/vsock-job-server 5252 /bin/node /opt/worker/worker-bundle.cjs
/bin/busybox poweroff -f
INIT
chmod +x "${ROOTFS}/init"

echo "[6/6] Pack the read-only base ext4 (mke2fs -d, no loop-mount / no root)"
rm -f "${IMG}"
mkfs.ext4 -q -L golden-base -d "${ROOTFS}" "${IMG}" "${IMG_SIZE}"
cp -f "/boot/vmlinuz-${KREL}" "${OUT}/vmlinuz"
# Host-readable consistency marker beside the image (cheap preflight; no mount).
printf '%s\n' "${BUNDLE_SHA256}" > "${IMG}.marker"
echo "DONE:"
ls -lh "${IMG}" "${OUT}/vmlinuz" "${IMG}.marker"
echo "  bundle marker = ${BUNDLE_SHA256}"
echo "Boot it with: ${HERE}/crosvm-launch.sh worker"
