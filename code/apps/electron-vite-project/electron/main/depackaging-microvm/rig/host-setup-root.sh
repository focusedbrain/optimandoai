#!/usr/bin/env bash
# =============================================================================
# Build 2a — ONE-TIME root setup for crosvm bring-up (mini-PC, Ubuntu 24.04).
#
# This is the ONLY part of the spike that needs root. Review it, then run ONCE:
#
#     sudo bash host-setup-root.sh
#
# It does exactly three things, all auditable below:
#   1. Install the build toolchain + libraries crosvm's source build needs.
#   2. Grant THIS user read/write on /dev/vhost-vsock via an ACL — mirroring the
#      ACL the system already grants on /dev/kvm. (No group change, no re-login;
#      takes effect immediately. Note: a plain ACL does not survive reboot — the
#      udev rule at the bottom makes it persistent, optional.)
#   3. Make a guest-bootable kernel image world-readable so the unprivileged
#      build steps can copy/inspect it.
#
# It does NOT: enable passwordless sudo, run crosvm, modify the orchestrator,
# or touch any product code. After this runs once, the rest of Build 2a runs as
# the normal user with no further privilege.
# =============================================================================
set -euo pipefail

TARGET_USER="${SUDO_USER:-konge}"

echo "==> [1/3] Installing crosvm build dependencies (apt)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update
# Dependency set per the crosvm book (Debian/Ubuntu). Lets the default build
# succeed; features we don't need (gpu/media) can be disabled at build time.
apt-get install -y --no-install-recommends \
  build-essential \
  pkg-config \
  clang \
  libclang-dev \
  libcap-dev \
  libdbus-1-dev \
  libssl-dev \
  protobuf-compiler \
  cmake \
  meson \
  ninja-build \
  nasm \
  curl \
  git \
  ca-certificates

echo "==> [2/3] Granting ${TARGET_USER} access to /dev/vhost-vsock (vsock channel)…"
modprobe vhost_vsock || true
if [ -e /dev/vhost-vsock ]; then
  setfacl -m "u:${TARGET_USER}:rw" /dev/vhost-vsock
  echo "    ACL set:"
  getfacl -p /dev/vhost-vsock | sed 's/^/    /'
else
  echo "    WARNING: /dev/vhost-vsock not present even after modprobe." >&2
fi

# Optional persistence across reboot (the spike does not require it):
UDEV_RULE=/etc/udev/rules.d/99-wrdesk-vhost-vsock.rules
echo "    Writing persistent udev rule -> ${UDEV_RULE}"
echo "KERNEL==\"vhost-vsock\", RUN+=\"/usr/bin/setfacl -m u:${TARGET_USER}:rw /dev/vhost-vsock\"" > "${UDEV_RULE}"

echo "==> [3/3] Making the guest kernel image readable for unprivileged copy…"
KREL="$(uname -r)"
chmod +r "/boot/vmlinuz-${KREL}" "/boot/config-${KREL}" 2>/dev/null || true
ls -l "/boot/vmlinuz-${KREL}" "/boot/config-${KREL}" 2>/dev/null | sed 's/^/    /' || true

echo "==> Done. Everything else in Build 2a runs WITHOUT sudo."
echo "    To undo the persistent vsock rule later:  sudo rm ${UDEV_RULE}"
