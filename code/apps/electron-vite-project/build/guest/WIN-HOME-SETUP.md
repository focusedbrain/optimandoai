# WR Desk — Windows Home isolation guest setup

Manual checklist for Windows **Home** edition. The Windows app remains **`mode: host`** (launcher/provisioner with full UI). The Ubuntu guest is an **isolation appliance** — not Windows `mode: sandbox`.

WR Desk **does not** bundle or install VirtualBox, VMware, or the Ubuntu image.

---

## Prerequisites

- [ ] WR Desk Windows installer completed (Host role seeded as `mode: host`).
- [ ] Windows Home edition (Hyper-V path is separate; not covered here).
- [ ] Administrator rights to install a hypervisor and run provisioning scripts.

---

## Step 1 — Install a hypervisor (manual)

Choose **one**:

### Recommended: VirtualBox (open source)

1. Open: https://www.virtualbox.org/wiki/Downloads
2. Download **Windows hosts** installer from Oracle (official site only).
3. Run the installer; accept defaults unless your IT policy requires otherwise.
4. **Verify:** open PowerShell and run:
   ```powershell
   & "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" --version
   ```
   Expected: version string (e.g. `7.x`).

### Alternative: VMware Workstation

1. Open: https://www.vmware.com/products/workstation-pro.html
2. Download and install from VMware (official site only).
3. **Verify:**
   ```powershell
   & "${env:ProgramFiles(x86)}\VMware\VMware Workstation\vmrun.exe" -T ws list
   ```
   Expected: list output (may be empty if no VMs running).

---

## Step 2 — Detect hypervisor

From the WR Desk app directory (or repo `apps/electron-vite-project`):

```powershell
powershell -ExecutionPolicy Bypass -File build\guest\detect-hypervisor.ps1
```

**Checkpoint:** output is `virtualbox` or `vmware`.

If output is `none`:

```powershell
powershell -ExecutionPolicy Bypass -File build\guest\show-manual-steps.ps1 -Recheck
```

Provisioning **stays blocked** until detection succeeds.

---

## Step 3 — Provision Ubuntu isolation guest

```powershell
powershell -ExecutionPolicy Bypass -File build\guest\provision-win-home-guest.ps1
```

This script:

1. Reads `build/guest/ubuntu-cloud-image.manifest.json` (URL + SHA256 only).
2. Downloads the image from **https://cloud-images.ubuntu.com/** at provision time.
3. Verifies SHA256 before use.
4. Creates or updates the VM with NAT forwards:
   - **51249** — coordination (from `packages/coordination-service/src/config.ts`)
   - **51250** — P2P ingest when co-located (from `scripts/session/configure-coordination-worker.cjs`)
5. Records state under `%USERPROFILE%\.opengiraffe\guest-state\provision-state.json`.

**Checkpoint:** `provision-state.json` exists; `applianceKind` is `isolation-depackaging` (not sandbox).

**Idempotent:** safe to re-run; existing VM gets port forwards re-converged.

---

## Step 4 — In-guest Linux stack

On first guest boot, cloud-init runs `in-guest-install-stack.sh` (same **crosvm rig family** as native Linux: `electron/main/depackaging-microvm/rig`).

**One-time (if provisioning failed on cloud-init ISO):** WSL + `cloud-image-utils` builds the ISO:

```powershell
powershell -ExecutionPolicy Bypass -File build\guest\build-cloud-init-iso.ps1
```

Inside WSL Ubuntu: `sudo apt install cloud-image-utils`

Guest metadata: `/home/wrdesk/.opengiraffe/guest-appliance/appliance.json`

**Checkpoint inside guest (SSH/console):**

```bash
cat /home/wrdesk/.opengiraffe/guest-appliance/appliance.json
systemctl is-enabled wrdesk-guest-stack.service
```

Expected: `applianceKind: isolation-depackaging`, service enabled.

---

## Step 5 — Launch and handoff

```powershell
powershell -ExecutionPolicy Bypass -File build\guest\launch-win-home-guest.ps1
```

- Starts the VM if stopped.
- Writes `%USERPROFILE%\.opengiraffe\electron-data\win-home-guest-handoff.json` with `orchestratorUiUrl` (default `http://127.0.0.1:51249/`).
- Opens the guest orchestrator UI in the default browser.

**Checkpoint:** Windows Task Manager shows **no** WR Desk orchestrator/coordination process on Windows — only the Electron host launcher and the hypervisor VM.

---

## Verification summary

| Check | Expected |
|-------|----------|
| Hypervisor detection | `virtualbox` or `vmware` |
| Ubuntu image in installer/repo | **No** — manifest only |
| Image checksum | Matches manifest SHA256 |
| Coordination port | 51249 |
| P2P ingest port (guest) | 51250 |
| `orchestrator-mode.json` on Windows | `mode: host` only |
| Guest role | `isolation-depackaging`, not sandbox |
| Re-run provision | No error; converges |

---

## Troubleshooting

- **Detection still `none`:** confirm hypervisor install path and re-run `show-manual-steps.ps1 -Recheck`.
- **Checksum failure:** delete `%USERPROFILE%\.opengiraffe\guest-cache\` and re-provision.
- **VMware:** first run may require manual VM creation from the downloaded `.img`; see script output for port-forward rules.
- **UI not loading:** wait for guest boot; confirm NAT rules map host 51249 → guest 51249.

---

## Files (source of truth)

| File | Purpose |
|------|---------|
| `build/guest/ubuntu-cloud-image.manifest.json` | Official image URL + SHA256 |
| `build/guest/wrdesk-guest-ports.json` | Port constants |
| `build/guest/detect-hypervisor.ps1` | Detection (no install) |
| `build/guest/provision-win-home-guest.ps1` | Main provision entry |
| `build/guest/launch-win-home-guest.ps1` | Start VM + browser handoff |

See also: `docs/installer-role-environment-spec.md` §5 (Windows host ↔ Linux guest boundary).
