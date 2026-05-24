# Phase 4 — Manual end-to-end test (wizard + dashboard)

Branch: `phase-1/pod-becomes-hot-path`  
Date documented: 2026-05-24

This procedure proves the full **six-step edge deployment wizard** and **status dashboard** against a real Linux VPS the tester brings themselves. It is the final gate on Phase 4.

**Tester record (do not commit):** keep a private note of the VPS hostname/IP, provider, distro, and pass/fail per section below.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Podman Desktop or native Podman** | Installed locally on the machine running the BEAP Electron app. Local pod must start after vault unlock (`beap-pod-local-verify` when edge tier is enabled). |
| **Linux VPS with root SSH** | Any provider or self-hosted server. Tester supplies host, port (default 22), user (`root` or sudo-capable user), and private key. Supported distros: Debian, Ubuntu, Fedora, RHEL, Rocky, Alma. |
| **BEAP app built and running** | On **Linux** (recommended for pod + Electron dev): `pnpm install`, build pod image per `packages/beap-pod/README.md`, start Electron (`pnpm --filter electron-vite-project dev` or packaged build). Vault unlocked. |
| **Valid paid-tier SSO session** | Private, Pro, Publisher, Enterprise, or equivalent tier. Step 1 re-authenticates and checks plan claim. Dev stub (`BEAP_ATTESTATION_STUB=1`) is acceptable for attestation only — use a real paid session for the full gate. |
| **SSH key on VPS** | Public key installed in `authorized_keys` for the SSH user you will enter in Step 2. |
| **Outbound network** | Local machine → VPS:22; VPS can pull container images if not pre-loaded. |

Optional prep (same as Phase 3 manual test):

```bash
pnpm --filter @repo/beap-pod build
podman build -t beap-components:dev -f packages/beap-pod/Containerfile packages/beap-pod
# Install seccomp profiles per packages/beap-pod/README.md
```

---

## Wizard walkthrough

### Launch

1. Unlock vault and ensure local Podman is running.
2. Open the app header tab **Edge tier** (edge-tier settings / dashboard).
3. If edge tier is not yet configured, click **Set up edge tier** (`data-testid="edge-dashboard-launch-wizard"`).
4. The six-step wizard modal opens (`Set up edge tier`).

If the wizard is blocked with a local-pod message, start the local BEAP pod first (vault unlock flow) and retry.

### Step 1 — Re-authenticate

1. Click **Refresh session & verify plan**.
2. **Expect:** session refresh succeeds; UI shows SSO `sub` and plan name (e.g. `pro`).
3. **Expect:** paid-tier gate passes; wizard advances to Step 2 automatically on success.
4. **Negative spot-check:** sign in with a free-tier account → clear error, wizard does not advance.

### Step 2 — Provide VM credentials

1. Enter VPS **host** (IP or hostname), **SSH port**, **user**, and paste **private key** (PEM/OpenSSH). Passphrase if required.
2. Read the help text — illustrative provider names only (alphabetized list in tooltip/help); **no provider dropdown or API fields**.
3. Continue to Step 3.

**Later negative test:** repeat Step 2 with a deliberately wrong key → expect SSH/auth error on probe; fix key and retry → probe succeeds.

### Step 3 — Probe and prepare

1. Click **Run probe** (or probe runs on entry).
2. **Observe probe panel:** distro name/version/family, Podman installed or not, sudo/root status.
3. **If Podman missing:** click **Install Podman**; watch live install log stream; wait for success.
4. **If Podman already present:** confirm `Podman: installed` and continue without install.
5. Continue when probe verdict is OK and Podman is ready.

**Later negative test (Alpine):** point wizard at an Alpine VM → probe shows unsupported distro message; **no** install button / no install attempted.

### Step 4 — Replica count

1. Choose **1 replica** for the first full pass.
2. Continue to deploy.

**Multi-replica follow-up (same or second VPS):** after dashboard pass below, remove replica or use a fresh settings state, re-run wizard, choose **2 replicas**, provide credentials for each host in sequence, deploy both, verify both in Step 6 loop.

### Step 5 — Generate identity and deploy

1. Deploy starts automatically (or click deploy if prompted).
2. **Observe live deploy log:** manifest upload, `podman play kube`, health polls on ingestor/validator/depackager/certifier.
3. **Expect:** all containers healthy within ~60s; deploy stage completes with success.
4. Note the assigned **`edge_pod_id`** in log or post-deploy summary.

**Later negative test:** block VPS:22 or use wrong firewall during deploy → deploy fails, teardown/cleanup runs on remote (best-effort pod stop/rm), error shown in wizard; no orphaned half-deploy without error message.

### Step 6 — Verify and switch

1. Confirm you understand edge tier will route traffic through the new replica.
2. Run **Verify & enable**.
3. **Expect:** synthetic BEAP round-trip succeeds (`Verification succeeded. Edge tier routing is now enabled.`).
4. Wizard completes; dashboard should show edge tier **enabled** with one replica.

---

## Dashboard walkthrough

With edge tier enabled and at least one replica from the wizard:

### Replica list and health

1. **Edge tier** tab → **Replicas** sub-tab.
2. **Expect:** replica row with host:port, `edge_pod_id`, health badge.
3. Within ~30s polling cycles, **health → OK** (green) when remote pod responds.

### Verifications and real message

1. Send a **real BEAP message** (inbox compose, extension ingest, or handshake path that uses `@repo/pod-client` with edge tier on).
2. Open **Verifications** sub-tab.
3. **Expect:** new rows — typically shallow `verified` then deep `verified` for the same `edge_pod_id` and your SSO `sub`.

CLI cross-check (optional):

```bash
cat ~/.config/wr-desk/edge-verification-audit.json | jq '.verifications[-5:]'
```

### Replica detail and logs

1. Click **View details** on the replica.
2. **Expect:** host, port, `edge_pod_id`, public key, health, last checked time.
3. Click **Fetch recent logs** (if shown).
4. **Known limitation (P4.9):** remote log fetch may return *"Remote logs require SSH access. Credentials are not retained after deploy"* — SSH keys are not stored post-wizard; log streaming over SSH is deferred. Record as deviation if still stubbed; restart/redeploy actions accept fresh SSH credentials.

### Restart

1. Kebab menu → **Restart**.
2. Enter SSH user/key (same as deploy).
3. **Observe** live action log; confirm success.
4. **Expect:** health may briefly show degraded/unreachable, then return to **OK** within one or two poll intervals.

### Redeploy

1. Kebab menu → **Redeploy**.
2. Enter SSH credentials; confirm.
3. **Expect:** new deploy log; **`edge_pod_id` changes** (new keypair + registration); health returns OK.

### Remove

1. Kebab menu → **Remove**.
2. Type replica **host** to confirm destructive action.
3. **Expect:** replica disappears from list; remote pod stopped/removed.
4. If last replica: prompt to add another replica or **pause/disable edge tier**; dashboard returns to empty **Edge tier is not configured** state when disabled.

### Global actions (P4.8)

- **Rotate edge keys:** sequential redeploy all replicas; live log; new `edge_pod_id` per replica.
- **Pause edge tier:** local pod restarts in **LOCAL_HOST** mode; edge routing off.
- **Fallback policy:** toggle `reject` vs `downgrade_with_badge` (persisted as `local_only`); survives refresh.

---

## Negative tests

Run after the happy path (or on disposable VPS).

| Scenario | Steps | Expected |
|----------|--------|----------|
| **Wrong SSH key** | Step 2 → wrong key → probe | Clear auth/SSH error; retry with correct key works |
| **Unsupported distro** | Alpine (or Arch) VM in Step 2–3 | Probe verdict fails with unsupported-distro message; **no** Podman install offered |
| **VPS unreachable during deploy** | Block SSH or stop VM mid Step 5 | Deploy error; remote cleanup attempted; no silent success |
| **Pause edge tier** | Dashboard → **Pause edge tier** | `edge_tier.enabled` false; local pod **LOCAL_HOST**; send message → no edge route; **AI analysis** (inbox/WR chat) still works on local path |

---

## Provider-agnostic check

1. Complete the wizard on VPS **provider A** (e.g. Hetzner, DigitalOcean, AWS, self-hosted — your choice).
2. Remove replica or use a second account/project.
3. Repeat wizard on VPS **provider B** (different provider from A).
4. **Expect:** identical wizard steps and dashboard UI — no provider logos, dropdowns, API token fields, or one-click provisioning. Provider names appear **only** in Step 2 illustrative help text (`copy.ts` / tooltip).

Automated guard: `src/edge-tier-wizard/__tests__/copy.test.ts` — provider names only in centralized copy.

---

## Pass criteria (Phase 4 done)

| Check | Expected |
|-------|----------|
| Wizard Steps 1–6 | Complete on real Linux VPS without terminal |
| Dashboard | Health OK, verifications, restart, redeploy, remove, global actions |
| Negative tests | Errors clear; unsupported distro blocked; deploy cleanup on failure; pause → LOCAL_HOST |
| Multi-replica | Optional second wizard run with 2 replicas succeeds |
| Provider-agnostic | No provider-specific UI outside Step 2 help |
| Automated tests | Phase 4 suites pass from repo root (see tracker); `pnpm -r test` green modulo documented pre-existing failures |

---

## Automated verification (from repo root)

Phase 4–focused vitest (2026-05-24):

```bash
pnpm exec vitest run \
  apps/electron-vite-project/electron/main/edge-tier \
  apps/electron-vite-project/electron/main/wizard \
  apps/electron-vite-project/src/edge-tier-wizard \
  apps/electron-vite-project/src/edge-tier-dashboard \
  packages/pod-client/src/__tests__/podClient.edgeTier.test.ts
```

**Result:** 18 files, 107 tests passed.

Full monorepo:

```bash
pnpm -r test
```

**Pre-existing failures (not Phase 4 regressions):** `apps/extension-chromium` — 19 tests (`CSS.escape` undefined in jsdom, selector escaping). Other packages may fail when vitest is run from `apps/electron-vite-project/` alone (`vite-electron-renderer`); always run from repo root.

```bash
pnpm -r build
```

**Pre-existing:** `apps/desktop` electron-builder (missing pinned electron); Windows packaged build may fail on native modules — use Linux for manual E2E build/run.

---

## Phase 4 commits (reference)

| Commit | Step |
|--------|------|
| `1b6355fa` | P4.0 tracker |
| `d6402a6b` | P4.1 SSH + probe |
| `e2c74ba5` | P4.2 Podman installer |
| `b1e09be5` | P4.3 Remote deployer |
| `09c9f449` | P4.4 Wizard IPC + state machine |
| `049cf310` | P4.5 Wizard UI |
| `7c053f80` | P4.6 Dashboard |
| `07a914a0` | P4.7 Replica actions |
| `f3b1a538` | P4.8 Global actions |

---

## Notes

- Phase 3 CLI (`edge-cli.ts`) remains for debugging; wizard is the primary user path.
- SSH private keys entered in the wizard are **zeroed after deploy**; dashboard restart/redeploy/remove/rotate prompts for credentials each time.
- Do **not** merge Phase 4 branch to `main` until downstream phases sign off.
- Builds on Phase 3 manual test: [`phase-3-manual-test.md`](phase-3-manual-test.md).
