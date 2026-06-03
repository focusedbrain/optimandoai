#!/usr/bin/env bash
# =============================================================================
# Build 2a — §4 headline proof: host<->guest I/O over virtio-vsock (NO shared FS).
# VERIFIED on the mini-PC (Ubuntu 24.04.4, kernel 6.17.0-29-generic, crosvm HEAD
# 938fc36, /dev/vhost-vsock ACL granted to the user).
#
# Builds a tiny initramfs: busybox + the guest vsock modules (=m in this kernel)
# + a static vsock-echo server. Boots crosvm in the background with --vsock CID,
# then a host-side AF_VSOCK Python client connects, sends a JSON line, and
# verifies the echo. Proves the channel both directions with NO filesystem
# sharing and NO network device (zero egress).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HOME/build/rig}"
CROSVM="${CROSVM:-$HOME/build/crosvm/target/release/crosvm}"
KERNEL="${KERNEL:-${OUT}/vmlinuz}"
KREL="$(uname -r)"
MODDIR="/lib/modules/${KREL}"
CID="${CID:-3}"
PORT="${PORT:-1234}"
W="${OUT}/vsock"; rm -rf "${W}"; mkdir -p "${W}"

echo "[1/4] Compile static guest vsock-echo server"
gcc -static -O2 -o "${W}/vsock-echo" "${HERE}/vsock-echo.c"
file "${W}/vsock-echo" | cut -d, -f1-3

echo "[2/4] Build vsock initramfs (busybox + vsock modules + echo server)"
R="${W}/root"; mkdir -p "${R}"/{bin,lib/modules,proc,sys,dev}
cp /bin/busybox "${R}/bin/"; ln -sf busybox "${R}/bin/sh"
cp "${W}/vsock-echo" "${R}/bin/vsock-echo"
for m in vsock vmw_vsock_virtio_transport_common vmw_vsock_virtio_transport; do
  zstd -q -d -f "${MODDIR}/kernel/net/vmw_vsock/${m}.ko.zst" -o "${R}/lib/modules/${m}.ko"
done
cat > "${R}/init" <<INIT
#!/bin/sh
/bin/busybox mount -t proc proc /proc 2>/dev/null
/bin/busybox mount -t sysfs sys /sys 2>/dev/null
/bin/busybox mount -t devtmpfs dev /dev 2>/dev/null
/bin/busybox insmod /lib/modules/vsock.ko
/bin/busybox insmod /lib/modules/vmw_vsock_virtio_transport_common.ko
/bin/busybox insmod /lib/modules/vmw_vsock_virtio_transport.ko
echo "GUEST vsock modules loaded; net ifaces (expect loopback only):"
/bin/busybox ip link 2>/dev/null || /bin/busybox cat /proc/net/dev
/bin/vsock-echo ${PORT}
/bin/busybox poweroff -f
INIT
chmod +x "${R}/init"
( cd "${R}" && find . | /bin/busybox cpio -o -H newc 2>/dev/null | gzip > "${W}/vsock-initramfs.cpio.gz" )

echo "[3/4] Boot crosvm (background) with --vsock ${CID}, NO --net"
( "${CROSVM}" run \
    --disable-sandbox -m 256 -c 1 \
    --initrd "${W}/vsock-initramfs.cpio.gz" \
    -p "rdinit=/init console=ttyS0" \
    --serial "type=stdout,hardware=serial,num=1,console=true,stdin=true" \
    --vsock "${CID}" \
    "${KERNEL}" > "${W}/guest.log" 2>&1 ) &
CROSVM_PID=$!

echo "[4/4] Host-side AF_VSOCK client -> guest cid=${CID} port=${PORT} (with retry)"
python3 - "$CID" "$PORT" <<'PY'
import socket, sys, time
cid, port = int(sys.argv[1]), int(sys.argv[2])
payload = b'{"probe":"build2a-vsock","n":42}\n'
deadline = time.time() + 15
last = None
while time.time() < deadline:
    try:
        s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        s.settimeout(3)
        s.connect((cid, port))
        s.sendall(payload)
        data = b""
        while not data.endswith(b"\n"):
            chunk = s.recv(4096)
            if not chunk: break
            data += chunk
        s.close()
        print("HOST sent:", payload)
        print("HOST recv:", data)
        if data == payload:
            print("VSOCK ROUND-TRIP: PASS")
            sys.exit(0)
        print("VSOCK ROUND-TRIP: MISMATCH"); sys.exit(2)
    except (ConnectionRefusedError, OSError) as e:
        last = e; time.sleep(0.3)
print("VSOCK ROUND-TRIP: FAIL (no connect):", last); sys.exit(1)
PY
RC=$?

wait "$CROSVM_PID" 2>/dev/null || true
echo "--- guest serial log ---"; cat "${W}/guest.log" | grep -vE '^\[ +[0-9]+\.' | tail -15
echo "vsock round-trip exit code: ${RC}"
exit "${RC}"
