#!/usr/bin/env bash
# =============================================================================
# Build 2a — crosvm launch wrapper (boot proof + worker image).
#
# STATUS: UNVERIFIED DRAFT (authored on Windows; never run on the mini-PC).
# crosvm's CLI changes across versions — the flags below are the SHAPE, not
# confirmed syntax. Run `crosvm run --help` on the rig and correct these.
# This is the spike's manual boot wrapper, NOT CrosvmProvider lifecycle logic
# (that's Build 2b).
#
# HARD CONSTRAINTS this wrapper must keep:
#   - NO network device  => default-deny egress on the depackaging VM.
#   - read-only base      => --root passed read-only.
#   - ephemeral overlay   => a fresh writable scratch disk per boot, discarded after.
#   - NO virtio-fs / shared folder for untrusted content (WSL2-style coupling is
#     rejected). Host<->guest bytes go over vsock (Build 2b) — see README §4.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CROSVM="${CROSVM:-crosvm}"
KERNEL="${KERNEL:-${HERE}/vmlinux}"           # kernel with virtio-blk + vsock (CONFIG_VHOST_VSOCK)
MODE="${1:-hello}"                            # hello | worker

case "${MODE}" in
  hello)
    # §2.2 — prove crosvm boots ANYTHING before involving the worker image.
    # Minimal kernel + initramfs to a shell / known init. Time the boot.
    echo "[hello] booting trivial guest (no net). Expect a shell or init banner."
    # shellcheck disable=SC2086
    time "${CROSVM}" run \
      --disable-sandbox \
      --mem 512 \
      --cpus 1 \
      --initrd "${HERE}/hello-initramfs.cpio.gz" \
      -p "init=/init console=ttyS0" \
      "${KERNEL}"
    ;;

  worker)
    # §3.3 — boot the golden image; confirm node + worker-bundle present & runnable.
    # RO base + ephemeral overlay scratch disk (discarded on exit).
    OVERLAY="$(mktemp -u "${TMPDIR:-/tmp}/wrdesk-overlay-XXXXXX.img")"
    # Create a small empty writable scratch disk for the overlay (size on rig).
    truncate -s 256M "${OVERLAY}"
    cleanup() { rm -f "${OVERLAY}"; echo "[worker] overlay nuked: ${OVERLAY}"; }
    trap cleanup EXIT

    echo "[worker] booting golden image (no net, RO base, ephemeral overlay)."
    # shellcheck disable=SC2086
    time "${CROSVM}" run \
      --disable-sandbox \
      --mem 1024 \
      --cpus 2 \
      --root "${HERE}/golden-base.ext4" \
      --rwdisk "${OVERLAY}" \
      --vsock 3 \
      -p "init=/init console=ttyS0 root=/dev/vda ro overlay=/dev/vdb" \
      "${KERNEL}"
    # NOTE: NO --net / --tap-* flag anywhere => zero egress.
    # NOTE: --vsock CID=3 reserves the host<->guest socket channel for Build 2b's
    #       job I/O. Confirm `--vsock` is accepted by this crosvm build (§4).
    ;;

  *)
    echo "usage: $0 [hello|worker]" >&2
    exit 2
    ;;
esac
