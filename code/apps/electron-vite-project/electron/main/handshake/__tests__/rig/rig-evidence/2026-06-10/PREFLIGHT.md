# Prompt 5 rig pre-flight — mini-PC (2026-06-10)

**Machine:** Linux mini-PC (bare-metal rig)  
**Branch:** `feature/layered-sandbox`  
**HEAD:** `643609d47534fcb3e31d29d3f2992f7ea742a003` (`643609d4`)  
**Synced from Windows push:** yes (`git pull --ff-only` fast-forward 991b7976..643609d4)

---

## Step 0 — Sync

| Check | Result |
|---|---|
| `git pull --ff-only` | **PASS** |
| HEAD equals Windows push (`643609d4` or later) | **PASS** — `643609d4` |

---

## Step 1 — Pre-flight checklist

| Check | Result | Notes |
|---|---|---|
| `/dev/kvm` accessible (no sudo) | **PASS** | ACL `user:konge:rw-` present |
| `/dev/vhost-vsock` accessible (no sudo) | **FAIL** | `crw-rw---- root:kvm` — user `konge` NOT in `kvm` group; no per-user ACL on device post-reboot |
| `pnpm session:start` rebuild | **PASS** | `build commit=643609d4…` `stamp=build007` `builtAt=2026-06-10T18:17:36.132Z` |
| `[RUNTIME_IDENTITY] commit` matches HEAD | **PASS** (build line) | App not launched this session — build stamp matches HEAD |
| Relay `/health` | **PASS** | `http://127.0.0.1:51249/health` → `status: ok` |
| `E_IMAGE_BUNDLE_MISMATCH` preflight | **PASS** | `crosvmImageBundlePreflight.test.ts` 6/6 green (~35ms); committed marker `bf7eb844…` == golden sidecar `~/build/rig/golden-base.ext4.marker` |
| Golden image stale? | **NO** | Markers match; image dated 2026-06-06 — bundle sha unchanged at HEAD |

### Operator fix required (vhost-vsock)

Post-reboot ACL did not survive. Run as root (then re-verify without sudo):

```bash
# Immediate (current boot):
sudo setfacl -m u:konge:rw /dev/vhost-vsock

# Durable (survives reboot — from rig/PROVISIONING.md §3):
sudo usermod -aG kvm konge
echo vhost_vsock | sudo tee /etc/modules-load.d/wrdesk-vhost-vsock.conf
echo 'KERNEL=="vhost-vsock", RUN+="/usr/bin/setfacl -m u:konge:rw /dev/vhost-vsock"' \
  | sudo tee /etc/udev/rules.d/99-wrdesk-vhost-vsock.rules
sudo udevadm control --reload && sudo modprobe vhost_vsock && sudo udevadm trigger --name-match=vhost-vsock
```

Verify (all four must pass, no sudo):

```bash
id | tr ',' '\n' | grep -i kvm
test -r /dev/kvm -a -w /dev/kvm && echo "kvm rw OK"
test -r /dev/vhost-vsock -a -w /dev/vhost-vsock && echo "vhost-vsock rw OK"
lsmod | grep -q vhost_vsock && echo "vhost_vsock loaded"
```

**Session halted on this blocker** for Parts A/B microVM legs until operator confirms the fix.

---

## Parts A / B / C — live status

| Part | Result | Blocker |
|---|---|---|
| **A** — Build C final leg (depackage-email → microVM → signed result) | **NOT RUN** | `/dev/vhost-vsock` permission denied; microVM rig tests **7 skipped** |
| **B** — A2 live ingestion | **NOT RUN** | (1) vhost-vsock for paid microVM path; (2) `fetchOpaque`/`deliverToHost` still fail-closed stubs — deliver needs host-side `/beap/ingest` routing (see README); (3) read-client OAuth consent — operator pending |
| **C** — RIG-1..4 Outlook `/$value` live gates | **NOT RUN** | Live Microsoft Graph account + operator; code tests 12 pass / 4 rig-skip unchanged |

**Configuration attempted:** single mini-PC (`pnpm session:start` relay at `192.168.178.29:51249`); two-box Windows host not paired this session due to pre-flight halt.

---

## Code tests run (not live proof)

```
crosvmImageBundlePreflight.test.ts   6 passed
outlookRfc822Fidelity.test.ts       12 passed, 4 skipped (RIG-1..4)
a2SandboxIngestion.test.ts           6 passed, 1 skipped (E2E needs Electron ABI)
dispatcher.microvm.email.rig.test.ts 1 passed, 3 skipped (vhost-vsock)
crosvmProvider.rig.test.ts           2 passed, 4 skipped (vhost-vsock)
```

---

## INV-5

No OAuth tokens, message bodies, or `p2p_auth_token` values in this directory.
