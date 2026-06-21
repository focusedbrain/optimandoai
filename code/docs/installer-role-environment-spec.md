# WR Desk installer — role & environment decision spec

**Status:** Decision spec for subsequent installer PRs (Prompt 0).  
**Scope:** Install/packaging surface only. Runtime role resolution (`useOrchestratorMode`, ledger, `ingestionOwnership`, `sandboxOutboundPolicy`) is **out of scope** — the installer writes a seed file; runtime override behavior is a separate epic.  
**Branch audited:** `feature/layered-sandbox` (read-only tree inspection).  
**Date:** 2026-06-19.

---

## 1. Verdict — NSIS custom role page readiness

**No** — the current tree is **not** ready for an NSIS custom role page without restructuring.

| Gap | Evidence |
|-----|----------|
| Default packaging is **unpacked `dir`**, not NSIS | `electron-builder.config.cjs:98` (`win.target: ['dir']`); `package.json:14` default `build` does not pass `--win nsis` |
| NSIS exists only as an **optional** script | `package.json:23` (`build:nsis`) |
| **No** custom `.nsi` / `.nsh` files | Glob search: zero `*.nsi` / `*.nsh` in repo |
| **No** `nsis.include` / `nsis.script` in active config | `electron-builder.config.cjs:106-109` — only `oneClick` + `allowToChangeInstallationDirectory` |
| **No** `build/` NSIS resources directory | `directories.buildResources: 'build'` (`electron-builder.config.cjs:65`) but no `build/` tree with installer assets |
| **No** Windows edition detection | No Home/Pro probe in installer or app code |
| Seed path ≠ default NSIS `$APPDATA` | Custom userData — see §4 |

**What later PRs need (minimum):**

1. Add `build/installer/` with custom NSIS include (electron-builder `nsis.include` or `script`).
2. Make NSIS the production Windows target (or dual-publish `dir` + `nsis`).
3. NSIS **custom pages** for: role acknowledgment (host-only on Windows), hypervisor manual-step disclosure, seed-file write.
4. NSIS seed writer targeting **`%USERPROFILE%\.opengiraffe\electron-data\orchestrator-mode.json`** (not `$APPDATA\WR Desk\...`).
5. Net-new Windows edition detection in installer (registry / `GetProductInfo` via NSIS plugin or pre-install helper).
6. Net-new Linux packaging pipeline (§5).

Custom NSIS pages **are possible** with electron-builder once `nsis.include` / custom script is added — electron-builder supports this without replacing electron-builder; the tree simply has not done it yet.

---

## 2. Confirmed facts (current tree)

### 2.1 Primary packaged app path

| Item | Finding | Citation |
|------|---------|----------|
| **WR Desk product** | `apps/electron-vite-project` | `electron-builder.config.cjs:58-59` (`appId: 'com.optimandoai.wrdesk'`, `productName: 'WR Desk™'`); `package.json:14-23` all build scripts run from this app via `scripts/run-electron-builder.cjs` |
| **`apps/desktop`** | Legacy **OpenGiraffe** sample (`com.opengiraffe.desktop`, `main.js` websocket demo). Not referenced by workspace build scripts for WR Desk. | `apps/desktop/package.json:2-15` |
| **Stale alternate config** | `electron-builder.json5` (different `appId`, NSIS default) is **not** used by `run-electron-builder.cjs` | `scripts/run-electron-builder.cjs:34` uses `electron-builder.config.cjs` only |

### 2.2 Current electron-builder config (active)

| Setting | Value | Citation |
|---------|-------|----------|
| Config file | `electron-builder.config.cjs` | `run-electron-builder.cjs:34` |
| `appId` | `com.optimandoai.wrdesk` | `electron-builder.config.cjs:58` |
| `productName` | `WR Desk™` | `electron-builder.config.cjs:59` |
| `executableName` | `WRDeskT` | `electron-builder.config.cjs:101` |
| `win.target` (default) | `['dir']` (unpacked) | `electron-builder.config.cjs:98` |
| Windows output (win32 build host) | `C:\build-output\build104` | `electron-builder.config.cjs:12-14`, `64` |
| Windows output (non-win32) | `apps/electron-vite-project/dist/release` | `electron-builder.config.cjs:64` |
| `linux` / `mac` targets | **Absent** from active config | `electron-builder.config.cjs` (no `linux`/`mac` keys) |
| Optional artifacts | `build:nsis`, `build:portable` | `package.json:22-23` |

**Note:** Rig evidence shows ad-hoc `linux-unpacked` builds (`rig-evidence/.../sandbox-app.log.trimmed:1`) and `dist-clean-artifacts.cjs` mentions linux-unpacked cleanup — Linux artifacts were produced manually/dev-side, not from checked-in production config.

### 2.3 NSIS capability

| Item | Value | Citation |
|------|-------|----------|
| Custom `.nsi` / `.nsh` | **None** in repo | Glob: 0 files |
| `nsis.include` / `nsis.script` | **Not configured** | `electron-builder.config.cjs:106-109` |
| `nsis.oneClick` | `false` | `electron-builder.config.cjs:107` |
| `nsis.allowToChangeInstallationDirectory` | `true` | `electron-builder.config.cjs:108` |
| `buildResources` | `'build'` (directory missing / empty for installer) | `electron-builder.config.cjs:65` |

Legacy `electron-builder.json5` has fuller NSIS (`perMachine: false`, `deleteAppDataOnUninstall: false`) but is not the active packaging path.

### 2.4 Seed file target

| Item | Detail | Citation |
|------|--------|----------|
| Filename | `orchestrator-mode.json` | `orchestratorModeStore.ts:17` |
| Read/write path | `path.join(app.getPath('userData'), FILE_NAME)` | `orchestratorModeStore.ts:93-94`, `179-181` |
| **Canonical userData (all OS)** | `%USERPROFILE%\.opengiraffe\electron-data` (Windows) / `~/.opengiraffe/electron-data` (Linux/macOS) | `bootstrapUserData.ts:24-30` (`getWrDeskUserDataPath()`, `app.setPath('userData', ...)`) |
| Lazy-init default `mode` | **`'host'`** when file missing or `mode` absent | `orchestratorModeStore.ts:129-130` |
| First persist trigger | `getOrchestratorMode()` writes file when `instanceId` or `pairingCode` missing | `orchestratorModeStore.ts:206-210` |

**Contradiction vs naive installer assumption:** NSIS `$APPDATA` (typically `%APPDATA%\WR Desk` or similar) **does not** match Electron `userData` for this product. Installer seed **must** use the `.opengiraffe/electron-data` path.

### 2.5 OS / edition detection (install-time vs first-launch)

| Signal | Where | Available when | Citation |
|--------|-------|----------------|----------|
| `process.platform` | Electron main | First app launch (main process) | `main.ts:1305` (Chromium sandbox flag only) |
| Windows Home vs Pro | **Not implemented** | Would need NSIS/plugin or helper at install | — |
| `os.platform()` | critical-jobs context | First launch / job dispatch | `critical-jobs/context.ts:85` |
| `/dev/kvm` | critical-jobs | First launch (sync file probe) | `critical-jobs/context.ts:79-90` |
| `navigator.userAgent` | Extension settings | Post-install UI only | `content-script.tsx:32067-32069` |

Install-time NSIS can read registry for Windows edition; first-launch main can re-validate with `process.platform` and optional WMI/PowerShell — neither exists today.

### 2.6 Hypervisor backend reality

| Backend | Status | Citation |
|---------|--------|----------|
| **crosvm** (Linux + KVM) | **Implemented** — `CrosvmProvider`, `MicroVMExecutor` | `hypervisorProvider.ts:6-7` |
| **Hyper-V** | **Deferred** (comment/stub only) | `hypervisorProvider.ts:6-7`; `rig/DEFERRED.md:146-148` |
| **VirtualBox** | **Deferred** | `hypervisorProvider.ts:6-7`; `rig/DEFERRED.md:146-148` |
| Linux microVM routing gate | `os.platform() === 'linux'` && `/dev/kvm` | `critical-jobs/context.ts:79-90` |

---

## 3. Decision matrix (installer behavior)

Rules encoded in this matrix:

- **Sandbox orchestrator runs ONLY on native Linux.** No exceptions. Windows installers never offer or accept sandbox role; UI shows sandbox unavailable with one-line reason.
- **VirtualBox / VMware are never bundled** (PUEL / redistribution). Installer detects presence and links user to install; VirtualBox is the recommended FOSS option.
- Installer writes seed `orchestrator-mode.json` **before first app launch** so lazy-init never silently defaults.
- Required manual steps (enable Hyper-V, install hypervisor, import Ubuntu image) are **surfaced with explicit instructions**, not assumed.

| Environment | Detected how | Role choice offered | Isolation backend | Manual steps (installer must surface) | Seed `mode` written |
|-------------|--------------|---------------------|-------------------|---------------------------------------|---------------------|
| **Windows Home** | NSIS: `GetProductInfo` / registry → Home SKU | **Host only** — Sandbox shown disabled: *"Sandbox runs only on Linux."* | **VirtualBox** (recommended FOSS) or **VMware Workstation** — user-installed; Ubuntu guest runs Linux-side orchestrator/isolation stack | 1) Install VirtualBox or VMware if absent (link + detect). 2) Import/provision Ubuntu guest image via bundled provisioning script. 3) Start guest before first depackaging use. | `host` (Windows seed file) |
| **Windows Pro** | NSIS: Pro/Enterprise/Education SKU | **Host only** — same sandbox-disabled copy | **Hyper-V** | 1) Enable Hyper-V feature if disabled (DISM/`Enable-WindowsOptionalFeature` instructions). 2) Import/provision Ubuntu guest on Hyper-V. 3) Start guest before first depackaging use. | `host` |
| **Linux (native)** | Package install on Linux; first-launch `process.platform === 'linux'` | **Host or Sandbox** — real radio choice on installer/first-run page | **crosvm** + `/dev/kvm` when present | If `/dev/kvm` missing: instruct user to enable BIOS virtualization + `kvm` group (`usermod -aG kvm $USER`); sandbox choice disabled until KVM available | `host` or `sandbox` per user choice |
| **macOS** | *Out of scope for this epic* | Host only (future) | None in v1 | — | `host` |

### Seed file fields (minimum viable)

Installer (or Linux postinst) writes `orchestrator-mode.json` with at least:

```json
{
  "mode": "host",
  "deviceName": "<hostname-or-prompt>",
  "instanceId": "<uuid-v4>",
  "pairingCode": "<6-digit-decimal>",
  "connectedPeers": []
}
```

Shape must satisfy `validateForWrite` / `buildConfigFromRaw` (`orchestratorModeStore.ts:234-271`, `122-162`). If installer omits `instanceId`/`pairingCode`, first launch will mint them but **`mode` must not be left to default silently**.

Optional installer metadata sidecar (recommended, not read by current app): `installer-seed.json` alongside with `{ "hypervisor": "virtualbox"|"hyper-v"|"crosvm", "windowsEdition": "home"|"pro", "seededAt": "ISO-8601" }` for support diagnostics.

---

## 4. Seed file path per OS (resolved)

| OS | Absolute path | NSIS `$APPDATA` match? |
|----|---------------|------------------------|
| **Windows** | `%USERPROFILE%\.opengiraffe\electron-data\orchestrator-mode.json` | **No** — must not use `$APPDATA` alone |
| **Linux** | `$HOME/.opengiraffe/electron-data/orchestrator-mode.json` | N/A |
| **macOS** (future) | `$HOME/.opengiraffe/electron-data/orchestrator-mode.json` | N/A |

**Resolution rule for installer PRs:** Use `getWrDeskUserDataPath()` semantics (`bootstrapUserData.ts:24-26`) — `path.join(os.homedir(), '.opengiraffe', 'electron-data')` — in all seed writers. NSIS should expand `$PROFILE` (not `$APPDATA`) on Windows.

**Pre-launch write timing:**

- **Windows NSIS:** write in `Section -Post` or custom page finish, before `Exec` of `WRDeskT.exe`.
- **Linux:** `postinst` script (deb) or AppImage first-run wrapper — write before launching Electron.
- **Idempotency:** If file exists, installer must **not** overwrite (upgrade path); only seed on fresh install.

---

## 5. Windows Home — installer ↔ Linux-guest boundary

This is the least-specified path; later PRs depend on this definition.

### 5.1 Two runtime surfaces

| Surface | OS | Role (`mode`) | Responsibility |
|---------|-----|---------------|----------------|
| **Windows Host app** | Windows (Home/Pro) | Always `host` | Full WR Desk UI, email send, handshakes, Host AI, VM provisioning/launcher, passes depackaging jobs to guest |
| **Linux guest appliance** | Ubuntu in VirtualBox/VMware (Home) or Hyper-V (Pro) | N/A — not the Electron `orchestrator-mode.json` on Windows; guest may have its **own** Linux seed if a Linux orchestrator package is installed inside VM | crosvm-capable depackaging/isolation execution, headless services, cloned-BEAP inbox path when product defines dedicated sandbox VM |

### 5.2 Windows installer scope (Home)

1. Installs **Windows** `WRDeskT.exe` + resources to chosen Program Files path.
2. Writes **Windows** seed: `%USERPROFILE%\.opengiraffe\electron-data\orchestrator-mode.json` with `mode: "host"`.
3. Ships **non-redistributable** assets: Ubuntu guest image checksum/manifest, provisioning scripts (`provision-guest.ps1` / `provision-guest.sh`), VirtualBox/Hyper-V VM definition templates.
4. **Does not** install VirtualBox/VMware/Hyper-V binaries.
5. On finish page: detect hypervisor → if missing, show download links (VirtualBox primary on Home); if present, offer **"Provision Linux guest"** button running bundled script.
6. Windows app first launch: reads `mode: host`; VM subsystem status shown in settings (future UI epic).

### 5.3 Handoff Windows → guest

```
[Windows WR Desk Host]  --SSH/virtio/guest-agent/API-->  [Ubuntu guest]
        |                                                      |
   mode=host (seed)                              Linux orchestrator OR depackaging-only worker
   UI + pairing + send                           crosvm/KVM depackaging when guest is Linux appliance
```

- **Provisioning script** (Windows-side, elevated where needed): create VM, attach disk image, configure networking (host-only or NAT per security spec), install/start guest agent.
- **Guest image** contains pre-baked Linux runtime (Electron linux-unpacked or headless worker — **product decision in Linux packaging PR**). Guest is **not** configured as sandbox on the Windows host; it is an **isolation appliance** the host orchestrates.
- **Dedicated remote sandbox** (A2 multi-machine) remains a **separate native Linux install** with `mode: sandbox` — not the same as the Win Home inner VM, though both may run Linux.

### 5.4 What Windows installer does *not* do

- Does not set `mode: sandbox` on Windows.
- Does not bundle VirtualBox/VMware/Hyper-V.
- Does not silently create/start VM without user acknowledgment on finish page.

---

## 6. Linux packaging (net-new)

**Decision:** Linux installer packaging is **net-new** in the active `electron-builder.config.cjs`.

**Recommended primary format:** **AppImage**

- Single artifact, no root required for install, common for Electron Linux distribution.
- Secondary: **`.deb`** for Ubuntu/Debian apt workflows (enterprise deployments).
- **Not recommended as primary:** raw `tar.gz` only (no desktop integration); may ship as CI artifact alongside AppImage.

**Linux installer must:**

1. Offer Host vs Sandbox role page (Sandbox disabled if `/dev/kvm` not accessible at install — with fix instructions).
2. Write seed to `$HOME/.opengiraffe/electron-data/orchestrator-mode.json` before first launch.
3. Never offer sandbox artifact on Windows/macOS builders.

**Build script additions (future):** `build:linux-appimage`, `build:linux-deb` invoking `run-electron-builder.cjs --linux AppImage` / `deb` with new `linux` section in config.

---

## 7. Net-new artifacts (subsequent PR checklist)

| PR / artifact | Description |
|---------------|-------------|
| `build/installer/installer.nsh` (or `.nsi`) | Custom NSIS pages: welcome, role (host-only + sandbox disabled note), hypervisor manual steps, seed write |
| `build/installer/seed-orchestrator-mode.ps1` | Generates JSON (uuid, pairing code) → `%USERPROFILE%\.opengiraffe\electron-data\` |
| `build/installer/detect-windows-edition.nsh` | Home vs Pro branching for hypervisor copy |
| `build/installer/detect-hypervisor.ps1` | VirtualBox/VMware/Hyper-V presence checks |
| `electron-builder.config.cjs` updates | `nsis.include`, production `win.target: nsis`, `linux` targets |
| `scripts/build-linux-appimage.cjs` | Linux packaging entry |
| `build/linux/postinst.sh` | deb postinst seed writer |
| `build/guest/` | Ubuntu image manifest, checksum, provisioning scripts (Win Home/Pro) |
| `docs/installer-role-environment-spec.md` | This document |
| `docs/installer-manual-steps.md` | User-facing hypervisor/KVM enablement copy (linked from installer UI) |

**Explicitly out of scope for installer PRs (separate epics):**

- Runtime ledger/mode reconciliation
- `useOrchestratorMode` behavior changes
- Hyper-V/VirtualBox **execution** backends in `hypervisorProvider.ts`
- Extension Settings orchestrator toggle wiring

---

## 8. STOP

This document is decision-only. **No application code, installer scripts, or packaging changes** are included in Prompt 0.
