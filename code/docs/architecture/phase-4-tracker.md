# Phase 4 Tracker — Edge Deployment Wizard & Status Dashboard

> **Phase 4 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§4 wizard design — six steps, dashboard, settings shape)  
Phase 3 ref: `docs/architecture/phase-3-tracker.md`  
P3.8 building blocks: `apps/electron-vite-project/scripts/edge-cli.ts`, `apps/electron-vite-project/electron/main/edge-tier/`

---

## Hard rules

1. **Provider-agnostic.** The wizard supports any Linux VPS with root SSH access. It does **not** integrate with any provider API, does **not** store provider tokens, does **not** recommend any host, and has **no** one-click VPS path. If a step adds provider integration, stop — that is out of scope for Phase 4.

2. **Edge private key never on VM disk.** Keypair is generated in Electron, encrypted to a vault-derived key, transferred over SSH as part of a one-shot deploy command, and injected only into the `certifier` container environment at pod start. Strategy §2.5 is non-negotiable.

3. **Cert is a gate, not a substitute for validation.** (Carried from Phase 3.) LOCAL_VERIFY always runs the full validator after cert verification.

4. **Do not merge to `main`** until downstream phases sign off.

---

## Steps

- [x] **P4.0** — Confirm branch and create Phase 4 tracker *(this file)*
- [x] **P4.1** — SSH transport module (`/etc/os-release` distro probe, sudo check, remote exec; no provider APIs)
- [x] **P4.2** — Remote Podman installer (distro-native apt/dnf/yum, idempotent, structured install events)
- [x] **P4.3** — Remote pod deployer (ephemeral key delivery via env, health poll, rollback on failure)
- [x] **P4.4** — Wizard state machine + IPC handlers (six steps, streaming progress, AbortSignal cancel)
- [x] **P4.5** — Wizard UI (six-step flow, live log panels, provider-agnostic copy)
- [ ] **P4.6** — Status dashboard (replica list, health, per-replica actions, rotation, verification log; extends Phase 3 dev panel)
- [ ] **P4.7** — Phase 4 verification pass + manual test documentation

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P4.0 | ✅ done | P4.0: phase 4 tracker |
| P4.1 | ✅ done | P4.1: SSH client and distro probe |
| P4.2 | ✅ done | P4.2: Remote Podman installer |
| P4.3 | ✅ done | P4.3: Remote pod deployer with ephemeral key delivery |
| P4.4 | ✅ done | P4.4: wizard state machine and IPC handlers |
| P4.5 | ✅ done | P4.5: wizard UI for six-step flow |
| P4.6 | ⬜ pending | — |
| P4.7 | ⬜ pending | — |

---

## Phase 4 exit criteria (from strategy §7)

A paid user with a **Linux VPS they brought themselves** can deploy an edge replica and route traffic through it from the wizard alone — no terminal, no provider integration. Status dashboard manages replicas long-term (view, restart, redeploy, rotate keys, pause tier).

**Builds on Phase 3:** `edge-cli.ts` logic (generate-keypair, register-edge, deploy-edge) moves behind wizard UI handlers; `edge-tier/` settings, key storage, attestation, and pod lifecycle remain the backend.

**Not in Phase 4:** replica health-aware load balancing (Phase 5), telemetry export (Phase 6), provider API integrations (explicitly out of scope).

---

## Wizard steps ↔ implementation map

| Strategy §4.1 step | Tracker steps |
| --- | --- |
| Step 1 — Re-authenticate | P4.4 (IPC), P4.5 (UI) |
| Step 2 — Provide the VM | P4.5 (UI) |
| Step 3 — Probe and prepare | P4.1, P4.2, P4.4 (IPC), P4.5 (UI + live install log) |
| Step 4 — Replica count | P4.5 (UI) |
| Step 5 — Generate identity and deploy | P4.3 (deployer), P4.4 (IPC), P4.5 (UI + live deploy log) |
| Step 6 — Verify and switch over | P4.4 (IPC), P4.5 (UI) |
| §4.2 Status dashboard | P4.6 |
| End-of-phase verification | P4.7 |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P4.0

- Step titles P4.1–P4.7 derived from strategy §4 (SSH module, Podman installer, remote deployer, wizard backend + UI, dashboard, verification). Titles may be refined when individual prompts are run; deviations will be noted here.
- Phase 3 dev UI (`EdgeTierAdminPanel.tsx`) is read-only; P4.6 promotes it to the full status dashboard per §4.2.
- Supported distros at launch: Debian/Ubuntu/Fedora/RHEL family (strategy §9 decision #4). Probe via `/etc/os-release` over SSH.

### P4.1

- **Dependency:** `ssh2@1.16.0` (pinned) in `apps/electron-vite-project` main-process dependencies.
- **Module:** `electron/main/edge-tier/ssh/` — `SshClient` (connect, run, SFTP upload, progress events, disconnect-on-error), `probeTarget()` + pure `interpretProbeCommands()` / `classifyDistro()` for tests.
- **Launch support:** Debian, Ubuntu, Fedora, RHEL, Rocky, Alma. Refused at probe: Alpine, Arch, openSUSE (+ clear message).
- **Missing Podman** recorded in probe but does **not** fail verdict (installer is a later step).
- **No provider APIs.** SSH to user-supplied VPS only.
- **Tests:** 16 pass (fixtures for each supported/unsupported distro, sudo cases, mock SSH runner, mock ssh2 client disconnect).
- **edge-cli.ts** still shells out to `ssh` for now; wizard uses `SshClient` + `deployEdgePod`. CLI migration optional in P4.8.

### P4.2

- **Module:** `electron/main/edge-tier/ssh/install-podman.ts` — `installPodman(client, probe)` async generator yielding structured `InstallEvent` (`log` | `stage` | `done` | `error`).
- **Package managers:** Debian/Ubuntu `apt-get`; Fedora `dnf`; RHEL family `dnf` with `yum` fallback. `sudo -n` when probe is non-root. No third-party repos, no curl|bash, no signature bypass.
- **Idempotent:** skips install when `podman --version` reports major ≥ 4.
- **Post-install:** version verify (refuses < 4.0); optional `systemctl --user enable --now podman.socket` (non-fatal on failure).
- **Tests:** 12 pass in `ssh/__tests__/install-podman.test.ts` (distro commands, idempotency, version-too-old, event stream shape).

### P4.3

- **Module:** `electron/main/edge-tier/ssh/deploy.ts` — `deployEdgePod(args)` async generator yielding `DeployEvent` (`log` | `stage` | `done` | `error` + optional `replica_state`).
- **Secret delivery:** manifest uploaded with `${PLACEHOLDER}` tokens only; `env VAR=… envsubst < manifest | podman play kube -` on one history-disabled command line. No secret files, no heredocs, no `fs.writeFile` of keys.
- **Health:** polls `podman exec` `/health` on all four containers for up to 60 s.
- **Rollback:** on failure, best-effort `podman pod stop/rm` + `rm` manifest.
- **Tests:** 7 pass in `ssh/__tests__/deploy.test.ts` (happy path, start_pod failure, health timeout, command snapshot).

### P4.4

- **Module:** `electron/main/wizard/` — `stateMachine.ts` (reducer + six steps + multi-replica loop), `handlers.ts` (authenticate/probe/install/deploy/verify), `ipc.ts` (renderer invoke + progress push channels).
- **IPC channels:** `wizard:authenticate`, `wizard:setVmCredentials`, `wizard:probe`, `wizard:installPodman` + `wizard:installPodman-progress`, `wizard:generateAndDeploy` + `wizard:generateAndDeploy-progress`, `wizard:verifyAndSwitch`, `wizard:cancel`, `wizard:getState`, `wizard:setReplicaCount`, `wizard:reset`.
- **Security:** SSH private key stored main-process only (`sshSession.ts`); zeroed after deploy; `assertNoSecretsInRendererPayload` guards all renderer-bound state/progress.
- **Cancel:** `wizard:cancel` aborts long-running install/deploy; deploy teardown runs on cancel.
- **Verify:** synthetic edge→local via `@repo/pod-client` edge routing; enables `edge_tier` on success (`verify.ts`).
- **Tests:** 19 pass in `wizard/__tests__/` (state machine, handler delegation, cancellation, secret leak guards).

### P4.5

- **Module:** `src/edge-tier-wizard/` — `WizardShell.tsx` + six step components + `LiveLogPanel.tsx`.
- **Entry:** "Set up edge tier" button in `EdgeTierAdminPanelForm`.
- **Preload:** `window.wizard` bridge (invoke + install/deploy progress listeners); `edge-tier:get-local-pod-requirement` gate at wizard entry.
- **Copy:** provider names only in `copy.ts` STEP2 help (alphabetized illustrative list); snapshot + grep guard tests.
- **Tests:** 13 pass in renderer (`edge-tier-wizard/__tests__/` + updated `EdgeTierAdminPanel.test.tsx`).
