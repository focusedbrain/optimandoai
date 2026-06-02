#!/usr/bin/env bash
# =============================================================================
# Build 2a — Golden image build (minimal, headless) for the depackaging worker.
#
# STATUS: UNVERIFIED DRAFT authored on the Windows dev box. It has NOT been run
# on the mini-PC. crosvm CLI flags, kernel config, and rootfs tooling MUST be
# confirmed on the rig (that discovery is the whole point of Build 2a). Treat
# this as a documented starting point, not gospel — correct it against reality
# and update this file.
#
# WHAT IS ALREADY PROVEN (off-rig, Windows): the worker bundles to a single
# standalone JS (rig/dist/worker-bundle.cjs, ~77 KB) and runs under bare Node
# v22 producing a valid signed JobResult (see rig/smokeTest.mjs). So the guest
# only needs: a Node binary + that one bundle. No node_modules. No native deps.
#
# GOAL: a read-only base rootfs containing { node, worker-bundle.cjs, init } that
# boots under crosvm, plus an EPHEMERAL writable overlay on top (the nuke
# primitive Build 2b depends on).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${HERE}/rootfs"
NODE_VERSION="${NODE_VERSION:-22.22.0}"   # match the host major proven off-rig (v22)
ARCH="x86_64"

echo "[1/5] Bundle the worker (platform-agnostic; safe to run anywhere)"
# Produces rig/dist/worker-bundle.cjs
node "${HERE}/buildWorkerBundle.mjs"

echo "[2/5] Stage a minimal rootfs"
# Minimal options (pick one on the rig and record what worked):
#   (a) Alpine minirootfs  — smallest; busybox init; ~5 MB base.
#   (b) buildroot          — reproducible, more setup.
#   (c) debootstrap minbase — familiar, larger.
# DRAFT uses Alpine minirootfs (download URL/version to be pinned on the rig).
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"/{bin,sbin,proc,sys,dev,opt/worker}
# curl -fsSL https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/${ARCH}/alpine-minirootfs-3.20.x-${ARCH}.tar.gz \
#   | tar -xz -C "${BUILD_DIR}"

echo "[3/5] Drop in a static Node binary + the worker bundle"
# Use the official static-ish Node build (no system libs needed beyond glibc/musl
# matching the rootfs). Record exact URL + checksum on the rig.
#   curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | ...
#   cp node "${BUILD_DIR}/bin/node"
cp "${HERE}/dist/worker-bundle.cjs" "${BUILD_DIR}/opt/worker/worker-bundle.cjs"

echo "[4/5] Install the guest init"
# The init runs the worker against the IN/OUT contract. Build 2a: read the job
# over stdin/console and write the result back (vsock wiring is Build 2b). The
# guest has NO network. See rig/README.md for the contract.
cat > "${BUILD_DIR}/init" <<'INIT'
#!/bin/sh
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sys /sys 2>/dev/null || true
# Build 2a smoke: prove node + bundle are present and executable inside the guest.
# (Full job I/O over vsock is wired in Build 2b.)
echo "guest-up: $(/bin/node --version 2>&1)"
echo "worker-bundle present: $([ -f /opt/worker/worker-bundle.cjs ] && echo yes || echo NO)"
# Trivial invocation: feed an empty object, confirm the worker starts and emits JSON.
echo '{"jobId":"guest-boot","inputBytes_b64":"","sandboxPeerX25519PubB64":""}' \
  | /bin/node /opt/worker/worker-bundle.cjs || echo "worker exited non-zero (expected: empty key -> error JSON)"
# Build 2a stops here. Do NOT add lifecycle/job-loop logic — that's Build 2b.
poweroff -f 2>/dev/null || true
INIT
chmod +x "${BUILD_DIR}/init"

echo "[5/5] Pack the read-only base image"
# Two shapes; confirm which crosvm prefers on the rig:
#   (a) initramfs (cpio.gz) passed via --initrd — simplest, fully in RAM, naturally
#       ephemeral; good for the hello-world + smoke stage.
#   (b) ext4 rootfs on virtio-blk passed READ-ONLY via --root, with a SEPARATE
#       writable scratch disk as the overlay (guest mounts overlayfs). This is the
#       RO-base + ephemeral-overlay layout Build 2b's nuke depends on.
# DRAFT emits an initramfs for the boot proof; switch to (b) for the overlay proof.
# ( cd "${BUILD_DIR}" && find . | cpio -o -H newc | gzip > "${HERE}/golden-initramfs.cpio.gz" )

echo "DRAFT build script complete (commands above are commented pending rig verification)."
echo "Next: run on the mini-PC, uncomment/correct per actual crosvm + distro, record what worked."
