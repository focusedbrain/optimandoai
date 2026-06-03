#!/usr/bin/env bash
# =============================================================================
# Build 2a — crosvm launch wrapper. VERIFIED on the mini-PC (Ubuntu 24.04.4,
# kernel 6.17.0-29-generic, crosvm source HEAD 938fc36). Replaces the earlier
# Windows-authored draft (old --root/--rwdisk/--cid flags are DEPRECATED on this
# crosvm; this uses the modern --block / --vsock).
#
# This is the spike's manual boot wrapper, NOT CrosvmProvider lifecycle (2b).
#
# HARD CONSTRAINTS kept:
#   - NO network device (no --net)        => default-deny egress.
#   - read-only base (--block ro=true)    => base never mutates.
#   - ephemeral overlay (mktemp + trap rm)=> writable scratch discarded on exit.
#   - NO virtio-fs / shared folder for untrusted content (WSL2 coupling rejected).
#     Host<->guest bytes go over vsock (proven by vsock-echo.sh).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HOME/build/rig}"
CROSVM="${CROSVM:-$HOME/build/crosvm/target/release/crosvm}"
KERNEL="${KERNEL:-${OUT}/vmlinuz}"
MODE="${1:-worker}"
CID="${CID:-3}"               # guest vsock context id
SERIAL="type=stdout,hardware=serial,num=1,console=true,stdin=true"

case "${MODE}" in
  hello)
    timeout 30 "${CROSVM}" run \
      --disable-sandbox -m 512 -c 1 \
      --initrd "${OUT}/hello-initramfs.cpio.gz" \
      -p "rdinit=/init console=ttyS0" \
      --serial "${SERIAL}" \
      "${KERNEL}"
    ;;

  worker)
    BASE="${OUT}/golden-base.ext4"
    # Ephemeral writable overlay: fresh, formatted, discarded on exit.
    OVERLAY="$(mktemp "${TMPDIR:-/tmp}/wrdesk-overlay-XXXXXX.img")"
    truncate -s 256M "${OVERLAY}"
    mkfs.ext4 -q -F "${OVERLAY}"
    cleanup() { rm -f "${OVERLAY}"; echo "[launch] overlay discarded: ${OVERLAY}"; }
    trap cleanup EXIT
    echo "[launch] booting golden worker image (RO base + ephemeral overlay, vsock CID=${CID}, NO net)"
    time timeout 60 "${CROSVM}" run \
      --disable-sandbox -m 1024 -c 2 \
      --block "path=${BASE},ro=true,root=true" \
      --block "path=${OVERLAY}" \
      --vsock "${CID}" \
      -p "root=/dev/vda ro console=ttyS0 init=/init" \
      --serial "${SERIAL}" \
      "${KERNEL}"
    # NOTE: no --net anywhere => zero egress. --vsock reserves the host<->guest
    # socket channel (see vsock-echo.sh for the proven round-trip).
    ;;

  *)
    echo "usage: $0 [hello|worker]" >&2
    exit 2
    ;;
esac
