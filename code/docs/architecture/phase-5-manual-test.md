# Phase 5 — Manual end-to-end test (supervisor, quarantine, nuclear reset)

Branch: `phase-1/pod-becomes-hot-path`  
Date documented: 2026-05-24

This procedure proves **Phase 5** on a live REMOTE_EDGE replica: **replace-not-restart** supervisor recovery, **hardened diagnostic reports**, **message quarantine**, **sandbox-routed** report/body viewing, **replacement budget** exhaustion, **pod-level escalation**, **stuck container detection**, and **nuclear reset**.

It builds on Phase 4 / 4.5 — see [`phase-4-manual-test.md`](phase-4-manual-test.md) and [`phase-4-5-manual-test.md`](phase-4-5-manual-test.md) for wizard deploy, edge-fetch migration, and dashboard basics not repeated here.

**Tester record (do not commit):** keep a private note of VPS hostname/IP, SSH user, test mailbox, pass/fail per test, `edge_pod_id` before/after nuclear reset, and paths to any crash-trigger payloads.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Deployed edge replica** | At least one healthy REMOTE_EDGE pod on a Linux VPS (`beap-pod-remote-edge`). Wizard or `edge-cli.ts` deploy is fine. |
| **Active edge-fetched email account** | Gmail or Microsoft 365 account migrated to edge fetch (Phase 4.5). Mail-fetcher container running. |
| **SSH access to the replica** | Same key/user as wizard deploy. You will run `podman` commands on the VM during tests. |
| **BEAP app running with vault unlocked** | Edge tier enabled; supervisor poll active (default 10 s). Local `LOCAL_VERIFY` pod healthy. |
| **Edge tier dashboard open** | Header **Edge tier** tab — replicas list, **Quarantine** tab, replica kebab menu (nuclear reset). |
| **Optional: debug image** | Tests 3 and 5 can use a dev build with a controllable crash/sleep hook. Production image + `podman kill` / crafted mail is sufficient for most checks. |

**Container names (REMOTE_EDGE):**

| Role | Container | Health port |
|------|-----------|-------------|
| depackager | `beap-pod-remote-edge-depackager` | 18102 |
| ingestor | `beap-pod-remote-edge-ingestor` | 18100 |
| validator | `beap-pod-remote-edge-validator` | 18101 |
| certifier | `beap-pod-remote-edge-certifier` | 18104 |
| mail-fetcher | `beap-pod-remote-edge-mail-fetcher` | 18106 |

**Supervisor audit log (desktop):** append-only JSON lines at `{Electron userData}/edge-tier-audit.log`. On Windows dev builds this is typically under `%APPDATA%/WR Desk/` (exact folder follows Electron `app.getPath('userData')`). Use this file when the dashboard does not surface a dedicated supervisor event feed.

**Useful SSH one-liners:**

```bash
# List pod containers
podman ps --filter pod=beap-pod-remote-edge --format '{{.Names}} {{.Status}}'

# Send SIGSEGV to depackager main process (Test 1, 3)
podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager

# Confirm container exited
podman inspect beap-pod-remote-edge-depackager --format '{{.State.Status}}'

# Tail supervisor-relevant events on desktop (adjust path)
grep -E 'container_replaced|pod_replaced|message_quarantined|replacement_budget|nuclear_reset' \
  "$APPDATA/WR Desk/edge-tier-audit.log" | tail -20
```

---

## Test 1 — Simulate container crash

**Goal:** Supervisor detects an exited container, picks up (or generates) a signed diagnostic report, replaces the container, and mail flow resumes.

### Steps

1. Open **Edge tier** dashboard; note replica **host**, **edge_pod_id**, and depackager row in replica details if shown. Confirm replica health is **healthy**.
2. SSH to the VPS as the deploy user.
3. Verify depackager is running:
   ```bash
   podman ps --filter name=beap-pod-remote-edge-depackager
   ```
4. Crash the depackager:
   ```bash
   podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager
   ```
5. Within **~30 s** (supervisor poll interval 10 s + replace time):
   - **Expect:** `podman ps` shows a **new** depackager container (new ID / recent Created time).
   - **Expect:** Replica returns to **healthy** on the dashboard (may briefly show degraded during replace).
6. Verify audit:
   - **Expect:** `edge-tier-audit.log` contains a `container_replaced` entry for role `depackager` with `success: true`.
   - **Expect:** A signed diagnostic report file under `{userData}/diagnostic-reports/{edge_pod_id}/` (edge-signed unless stuck path).
7. Send a normal test email to the edge-fetched account (or trigger extension ingest if applicable).
8. **Expect:** Message certifies and appears in inbox — depackager replacement did not stall the pipeline.

### Pass criteria

- Container replaced without `podman restart` or Podman auto-restart.
- Audit log records replacement; next message succeeds.

---

## Test 2 — Verify quarantine

**Goal:** A crash-causing message is quarantined (not dropped), visible in the dashboard, viewable only via sandbox, and discardable from both desktop and edge.

### Steps

1. **Prepare a crash trigger** (choose one):
   - **Crafted email:** Send a message to the edge-fetched mailbox that reliably crashes depackager during processing (team-maintained test corpus; do not commit payloads).
   - **Simulated failure:** If using a debug build, use an internal crash hook on ingest for a known test message id (same outcome: depackager exit + report).
2. Ensure mail-fetcher will pick up the message (UNSEEN in mailbox).
3. Wait for fetch + processing. When depackager crashes:
   - **Expect:** Supervisor replaces depackager (Test 1 behavior).
   - **Expect:** Audit log `message_quarantined` with `message_hash` and `envelope_from`.
4. On dashboard main view:
   - **Expect:** Banner or indicator — e.g. **Recent failures: 1 quarantined message** (`data-testid="edge-dashboard-open-quarantine"`).
5. Open **Quarantine** tab (`data-testid="edge-dashboard-tab-quarantine"`).
   - **Expect:** Summary shows **1** for the replica.
   - Click the replica row; **Expect:** list entry with timestamp, **envelope from**, truncated **subject**, **failed role** (e.g. `depackager`). No body preview inline.
6. Click **View report in sandbox**.
   - **Expect:** `SandboxViewerModal` opens (`data-testid="sandbox-viewer-modal"`), mode `diagnostic_report`, monospace plain text — hardened fields only (no raw exception message strings).
7. Close sandbox; click **View message body in sandbox**.
   - **Expect:** Sandbox opens in `raw_email_body` mode with decrypted body as plain text.
8. Click **Discard**; type confirmation — exact **from** address **or** exact filtered **subject** (see quarantine row).
   - Provide SSH key if prompted (edge delete).
9. **Expect:** Entry removed from quarantine list; count returns to 0.
10. On VPS:
    ```bash
    ls /var/lib/quarantine 2>/dev/null || echo 'empty or unmounted'
    ```
    **Expect:** Crash message hash directory gone after discard.
11. **Expect:** Audit `message_discarded` with matching hash.

### Pass criteria

- Crash message quarantined; fetch loop continued (subsequent mail still processes).
- Report and body only in sandbox; discard requires typed confirmation and removes edge + desktop copies.

---

## Test 3 — Replacement budget exhaustion

**Goal:** Three depackager crashes within 60 s exhaust the replacement budget; dashboard warns; **Resume automatic recovery** clears the budget and the next crash is replaced again.

### Steps

1. Confirm replica **not** already in `replacement_exhausted` (no **Recovery paused** badge).
2. SSH to VPS; crash depackager **three times** within 60 s, waiting only for SIGSEGV to land (supervisor will replace between crashes):
   ```bash
   for i in 1 2 3; do
     podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager
     sleep 12   # allow poll + replace cycle
   done
   ```
   *(Adjust sleep if using a debug crash endpoint instead.)*
3. Trigger a **fourth** crash within the same 60 s window:
   ```bash
   podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager
   ```
4. **Expect:** Dashboard replica row shows **Recovery paused** (`data-testid="replica-recovery-warning-{edge_pod_id}"`).
5. **Expect:** OS/desktop notification about automatic recovery paused (persists until action).
6. **Expect:** Audit `replacement_budget_exhausted` for role `depackager`.
7. Click **Recovery paused** → **Replacement exhausted** modal.
   - **Expect:** Diagnostic reports listed for the exhausted role; **Resume automatic recovery** enabled.
8. Click **Resume automatic recovery**.
   - **Expect:** Modal closes; **Recovery paused** badge clears.
   - **Expect:** Audit `replacement_budget_cleared`.
9. Crash depackager once more:
   ```bash
   podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager
   ```
10. **Expect:** Container replaced again (budget reset); replica healthy.

### Pass criteria

- Fourth replacement blocked within window; user-visible warning; resume restores automatic replace.

---

## Test 4 — Pod-level escalation

**Goal:** When container replacement cannot complete, supervisor escalates to whole-pod replace; email account stays active; audit records `pod_replaced`.

### Steps

1. SSH to VPS; identify pod infra container:
   ```bash
   podman pod inspect beap-pod-remote-edge --format '{{.InfraContainerId}}'
   # Infra name is usually beap-pod-remote-edge-infra
   ```
2. **Block pod teardown** — hold the pod network namespace open (simulates corrupted pod state):
   ```bash
   podman run -d --name beap-hold-net --network=container:beap-pod-remote-edge-infra \
     docker.io/library/alpine sleep 3600
   ```
3. Crash depackager to start replacement:
   ```bash
   podman kill --signal=SIGSEGV beap-pod-remote-edge-depackager
   ```
4. If container-level replace succeeds despite hold, strengthen the block (e.g. `chmod 000` on manifest path `/tmp/beap-pod-remote-edge.yaml` **only on a throwaway test VM**) until container replace fails with a reason that escalates (`health_timeout`, `podman_run_failed:no such pod`, etc.).
5. Wait for supervisor escalation (~30–120 s depending on health poll timeout).
   - **Expect:** Audit `pod_replaced` with `success: true` (not merely `container_replaced`).
   - **Expect:** `podman pod ps` shows fresh `beap-pod-remote-edge` after hold is released.
6. Clean up hold container:
   ```bash
   podman rm -f beap-hold-net 2>/dev/null || true
   ```
7. On dashboard:
   - **Expect:** Replica returns **healthy**; same **edge_pod_id** and **edge_public_key** (pod replace preserves identity).
8. Edge-fetched email account:
   - **Expect:** Still **active** / fetching (credentials re-delivered after pod replace — no re-auth required for pod escalation alone).
9. Send test email; **Expect:** Normal cert flow.

### Pass criteria

- Escalation path produces `pod_replaced` in audit log; mail-fetcher resumes without account re-authorization.

**Safety:** Run Test 4 on a disposable VPS snapshot. Do not leave manifest permissions corrupted after the test.

---

## Test 5 — Stuck container detection

**Goal:** A running container that stops responding to `/health` is SIGKILLed and replaced; supervisor-signed report appears.

### Steps

1. **Inject stuck behavior** (choose one):
   - **Debug build:** Deploy image with env hook (e.g. `BEAP_DEBUG_STUCK=depackager`) or a test route that sleeps inside active message processing beyond role timeout (depackager 30 s).
   - **Manual block (lab only):** Inside depackager container, block loopback health port temporarily — not recommended on production VPS.
2. Confirm `/health` fails from VM:
   ```bash
   podman exec beap-pod-remote-edge-depackager curl -sf --max-time 5 \
     http://127.0.0.1:18102/health; echo exit=$?
   ```
   **Expect:** Non-zero exit after stuck condition active.
3. Wait for **3 consecutive** supervisor probe failures (~30 s at 10 s poll interval).
4. **Expect:** Depackager container ID changes (SIGKILL + replace).
5. **Expect:** Audit `container_replaced` with reason indicating stuck / health probe path.
6. **Expect:** Diagnostic report with `"signer": "supervisor"` and exception class `StuckHealthProbeError` in `{userData}/diagnostic-reports/{edge_pod_id}/`.
7. Open report via **Replacement exhausted** modal or quarantine/report list if linked; **Expect:** sandbox view loads supervisor-signed report.

### Pass criteria

- Running (not exited) stuck container is killed and replaced; supervisor-signed report verified.

---

## Test 6 — Nuclear reset

**Goal:** Host-initiated wipe-and-respawn produces new `edge_pod_id`; edge-fetch accounts degrade and re-authorize successfully.

### Steps

1. Record current replica **hostname**, **edge_pod_id**, and edge-fetch account status.
2. Dashboard → replica kebab menu → **Nuclear reset** (`data-testid="nuclear-reset-modal"`).
3. Complete modal:
   - SSH user, port, private key (passphrase if needed)
   - **Hostname** — type exact replica host
   - **RESET** — type confirmation token
   - **Reason** — non-empty (e.g. `Phase 5 manual test 6`)
4. Submit; observe live log stages (remote wipe → desktop cleanup → keygen → redeploy).
5. **Expect:** Modal completes without error; replica shows new **edge_pod_id** on dashboard.
6. **Expect:** Audit `nuclear_reset` with `confirmation_user_input_hash` (reason text not stored verbatim).
7. On VPS:
   ```bash
   podman pod ps
   ls /var/lib/quarantine 2>/dev/null
   ```
   **Expect:** Fresh pod; quarantine empty.
8. Edge-fetched email account:
   - **Expect:** Status **degraded** / `replica_reset` notification.
9. Re-authorize account via email settings (OAuth flow).
10. **Expect:** Account active; fetch resumes; test email certifies.

### Pass criteria

- New keypair and `edge_pod_id`; old quarantine and VM state wiped; re-authorize restores edge fetch.

---

## Sign-off checklist

| # | Test | Pass |
|---|------|------|
| 1 | Container crash → replace-not-restart | ☐ |
| 2 | Quarantine + sandbox view + discard | ☐ |
| 3 | Replacement budget exhaustion + resume | ☐ |
| 4 | Pod-level escalation | ☐ |
| 5 | Stuck container detection | ☐ |
| 6 | Nuclear reset | ☐ |

When all six pass on a live VPS, Phase 5 manual verification is complete. Automated coverage remains in `supervisor/__tests__/` and related vitest suites — run `pnpm test` in CI before release.
