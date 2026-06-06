# Cross-Machine Handshake Runbook (two boxes + a relay)

Human-operated regression for the internal handshake round-trip across real
hardware. Mirrors the automated single-box harness (`pairingCodeRelayGap.rig.test.ts`,
`pairingActivation.rig.test.ts`) and extends it to two physical machines + a real
relay, which the automated suite cannot exercise (separate OS processes, separate
orchestrator instance ids, real network).

Execute top to bottom. Short imperative steps. Do not skip Step 0.

---

## Already machine-proven (don't re-debug here — this session adds the hardware-only dimension)

The single-box rig (`pnpm test:native-db`, real local relay) already proves, green:
pairing→ACTIVE + ledger state, accept/context_sync transport byte-identity, the
pairing-code→relay-device-id gap fix, relay kill/restart + outbound-queue hold/drain
(exactly once), **revoke→send-refused→re-pair→restored**, **qBEAP `message_package`
byte-identity over WS-push (200) and store-pull (202) + direct-P2P-HTTP routing with
the counterparty-token auth gate**, and the **`assertRecordForServiceRpc` gates**
(non-ACTIVE + different-principal) plus the inference request/result/error/cancel
state machine. pBEAP trust verdicts are unit-proven (relay-independent).

So if a step below fails on **logic** (a verdict, a gate, a state transition), suspect
the environment first. This session exists to prove the things one box CANNOT: two
real OS processes with distinct instance ids, real WebRTC/live-both-online delivery,
the renderer ACK path (`live` vs `relay_pending`), a real second machine going
offline→online for exactly-once clone, and quarantine custody to the paired sandbox
machine end-to-end.

---

## Roles & machines

| Machine | Role | UI | Notes |
|---|---|---|---|
| **Windows Pro** | `host` / workstation | ON | Logged into SSO account **X** |
| **mini-PC (Linux)** | `sandbox` | ON | Logged into the **same** SSO account **X** (internal = same principal) |
| **Relay** | coordination-service | n/a | LAN-reachable; default the mini-PC or a third box |

Both orchestrators must be logged into the **same** SSO account (internal handshake
is same-principal, two device instance ids).

`RELAY_IP` = LAN IP of the relay box (e.g. `192.168.1.50`). Used below.

---

## Step 0 — Sync + HEAD verification (BOTH machines) — MANDATORY

A stale Windows checkout has burned an analysis round before. Verify HEAD on BOTH
boxes BEFORE anything else. Expected HEAD short hash for this session: **see the
final report** (`494d7347` or later on `feature/layered-sandbox`).

**Linux / mini-PC (bash):**
```bash
cd ~/Dokumente/dev/optimandoai
git fetch origin && git checkout feature/layered-sandbox && git pull --ff-only
git rev-parse --abbrev-ref HEAD          # → feature/layered-sandbox
git log --oneline -1                     # record this hash
```

**Windows Pro (PowerShell):**
```powershell
cd $HOME\dev\optimandoai     # adjust to the real clone path
git fetch origin; git checkout feature/layered-sandbox; git pull --ff-only
git rev-parse --abbrev-ref HEAD          # → feature/layered-sandbox
git log --oneline -1                     # MUST equal the mini-PC hash
```

**PASS:** both boxes print the **same** commit hash on `feature/layered-sandbox`.
**FAIL:** hashes differ → stop, re-pull the lagging box, do not proceed.

---

## Step 1 — Start the relay (relay box)

Primary run uses a **local, LAN relay we control** (required for the relay-down test).

**Build + start (Linux relay box, bash):**
```bash
cd ~/Dokumente/dev/optimandoai/code/packages/coordination-service
pnpm install && pnpm build
# Real identities → validate real SSO JWTs against auth.wrdesk.com JWKS (needs internet).
COORD_PORT=51249 COORD_HOST=0.0.0.0 COORD_DB_PATH=/tmp/coord-xmachine.db \
  node dist/index.js | tee ~/relay-xmachine.log
```
Confirm it is listening:
```bash
curl -s http://127.0.0.1:51249/health    # → {"status":"ok",...}
```
Open port 51249 on the relay host firewall for the LAN.

> Do NOT set `COORD_TEST_MODE=1` for the human run — that bypasses auth. TEST_MODE is
> only for the automated single-box harness.

**PASS:** `/health` returns ok; both app boxes can `curl http://RELAY_IP:51249/health`.

---

## Step 2 — Point both orchestrators at the LAN relay

On **each** app box, set the coordination endpoint to the LAN relay (NOT
relay.wrdesk.com) for the primary run:

- If the app exposes a **Relay / Coordination URL** setting in Settings → Network:
  set `Coordination URL = http://RELAY_IP:51249` and `WS = ws://RELAY_IP:51249/beap/ws`,
  then restart the app.
- Otherwise set it in the `p2p_config` row of the app's handshake DB before launch
  (fields `coordination_url`, `coordination_ws_url`, `coordination_enabled=1`,
  `relay_mode='local'`). Confirm the exact affordance with the dev team.

Launch both apps, log into account **X** on both. Set roles: Windows = **host**,
mini-PC = **sandbox** (Orchestrator settings).

**Where to look:** app log line `[DEVICE_ID_BINDING]` (each box prints its
`getCanonicalRelayDeviceId` = orchestrator instance id) and a WS connect line to
`ws://RELAY_IP:51249/beap/ws?device_id=...`.

**PASS:** both apps show a connected coordination WS to `RELAY_IP`.

---

## Log capture (run once per machine, keep open)

**Linux/mini-PC:** app logs stream to the terminal that launched it; also:
```bash
tail -f ~/.config/wrdesk*/logs/*.log 2>/dev/null || tail -f ~/.opengiraffe/**/logs/*.log
```
**Windows (PowerShell):**
```powershell
Get-Content -Wait "$env:APPDATA\wrdesk*\logs\*.log"
```
**Relay:** `~/relay-xmachine.log` (already `tee`'d in Step 1).

For each step below, note the **timestamp** when you act so log lines can be matched.

---

## Checklist — matrix items 1–8 (perform in order)

### 1. Pairing (6-digit code → ACTIVE)
- **Do:** On mini-PC (sandbox) read its 6-digit pairing code (Orchestrator panel). On
  Windows (host) start an internal handshake / "Pair device" and **type the mini-PC
  code**. Confirm on both.
- **Expect:** both apps show the peer as **Connected / ACTIVE**.
- **Look:** relay log `[RELAY-REG] register_handshake ... handshake_type:"internal"`
  with BOTH `initiator_device_id` and `acceptor_device_id` populated (this is the
  Phase-0 gap — both must be non-null). App DB `handshakes` row: `state=ACTIVE`,
  `local_role` host=acceptor/sandbox=initiator (or vice-versa), `handshake_type=internal`.
- **PASS:** ACTIVE on both; relay registry row has both device ids.
- **FAIL:** stuck `ACCEPTED`; or relay log shows `initiate_missing_routing_fields` /
  `no_route_for_internal_initiate` → the pairing-code→device-id resolution failed.

### 2. Capsule lifecycle (context_sync + refresh)
- **Do:** After pairing, trigger a context update (e.g. change shared context / send a
  context block) on the host.
- **Expect:** sandbox reflects the update; no signature errors.
- **Look:** relay `coordination_capsules` rows for `capsule_type` context_sync/refresh;
  app log: no `signature` / `chain` rejection. App DB `last_seq_received >= 1`,
  `last_seq_sent >= 1` both sides.
- **PASS:** update visible on the peer, signatures verified, seqs advance.

### 3. qBEAP message delivery (live)
- **Do:** Send a message/package from host to the paired sandbox while both are online.
- **Expect:** arrives on the sandbox within seconds.
- **Look:** relay log `[RELAY-QUEUE] push_live` (HTTP **200**); sandbox inbox shows the
  item; app log `coordinationRelayDelivery: pushed_live`.
- **PASS:** delivered live; sealed item opens on the sandbox.

### 4. pBEAP trust decision
- **Do:** Send a pBEAP (plaintext-BEAP) item from host to sandbox.
- **Expect:** sandbox records an explicit trust verdict in the item metadata — and on
  the current build that verdict is **`unverified_public` with reason
  `signing_bytes_unavailable`**, even for the correctly-paired peer. This is expected,
  not a failure: `verified_bound` is **not yet reachable on the live path**, pending two
  wirings that are deliberately deferred — (a) Gate-5 signing-bytes canonicalization
  mirrored in main, and (b) the paired counterparty's fingerprint + Ed25519 pubkey wired
  into `knownCounterparties` at both live call sites (`messageRouter` + `beapEmailIngestion`).
  Until both land, the `signingBytes` guard short-circuits before any binding check, so the
  live verdict is always a lesser one. Do **not** expect `verified_bound` this session.
- **Look:** sandbox item metadata `pbeap_trust.level = unverified_public`,
  `pbeap_trust.reason = signing_bytes_unavailable` (or an earlier lesser reason —
  `no_sender_fingerprint` / `no_signature` — if the header is malformed). App log
  `livePbeapTrust`. Confirm the verdict is **seal-bound** (it lives in `depackaged_metadata`,
  covered by the row seal — tamper-evident on read).
- **PASS:** an explicit lesser verdict is recorded and seal-bound — nothing is silently
  trusted, and no `verified_bound` badge appears. (A `verified_bound` result this session
  would itself be a defect, not a pass.)

### 5. Clone gesture (live / relay_pending / queued)
- **Do (live):** With both online, clone a BEAP from the host inbox to the sandbox.
- **Do (queued):** Close the sandbox app; clone again from host; reopen the sandbox.
- **Expect:** live clone arrives immediately; the queued clone arrives exactly once when
  the sandbox reconnects (no duplicate).
- **Look:** host log `deliveryMode: live` then `queued`; on sandbox reconnect a single
  `[CLIENT-QUEUE-PULL] result` / inbox row (count it — must be 1, not 2).
- **PASS:** both outcomes; queued item delivered exactly once.

### 6. Quarantine routing
- **Do:** Cause a host-side depackage that routes to quarantine (per product trigger),
  with the sandbox paired.
- **Expect:** an **encrypted** custody blob reaches the sandbox; host cannot read it in clear.
- **Look:** host DB `quarantine_messages` row with `paired_sandbox_handshake_id`; sandbox
  receives a package tagged `sandbox_clone_quarantine`; INV-5: no plaintext content in any log.
- **PASS:** encrypted blob custody intact end-to-end; sandbox decrypts, host does not log clear.

### 7. Internal inference request/result (host-AI)
- **Do:** From the sandbox, run an internal inference request against the host (host-AI).
- **Expect:** result returns to the sandbox; a cancel mid-flight stops cleanly.
- **Look:** host log `handleInternalInferenceRequest` then result; sandbox resolves once.
  Negative: a request on a non-ACTIVE handshake or wrong principal is **refused**
  (`POLICY_FORBIDDEN` / `NO_ACTIVE_INTERNAL_HOST_HANDSHAKE`).
- **PASS:** request→result round-trips; gate refuses non-ACTIVE / cross-principal.

### 8. Revoke (and re-pair)
- **Do:** Revoke the handshake from the host UI. Then attempt a send/clone to the sandbox.
  Then re-pair (new code) and retry.
- **Expect:** post-revoke delivery is refused; after re-pair it works again.
- **Look:** app log `HANDSHAKE_REVOKED` on the refused send; DB row `state=REVOKED`. After
  re-pair a NEW `handshakes` row reaches ACTIVE; delivery succeeds.
- **PASS:** refused after revoke; restored after re-pair.

---

## Failure-mode steps (relay we control)

### F1. Relay down → queue holds → drains on recovery
- **Do:** With both apps online and a message mid-send, **stop the relay**
  (`Ctrl-C` on the relay box). Send a host→sandbox message. Restart the relay
  (re-run Step 1 with the SAME `COORD_DB_PATH`). Wait ~30 s.
- **Expect:** the message is held while the relay is down and delivered after recovery,
  exactly once.
- **Look:** host log `stored_offline` / outbound queue retains the row; after restart
  `delivered_queued`; sandbox inbox gains exactly one item.
- **PASS:** no loss, no duplicate.

---

## Final smoke — deployed relay (`relay.wrdesk.com`)

Validate the deployed path AFTER the local run passes. Keep it tiny.

- **Do:** On both apps, switch the Coordination URL back to `https://relay.wrdesk.com`
  (`wss://relay.wrdesk.com/beap/ws`); restart. Then perform: **(a)** one pairing,
  **(b)** one host→sandbox message, **(c)** one clone.
- **Expect:** all three succeed against the deployed relay.
- **Relay-down on the smoke pass:** do NOT touch the production relay. Simulate by
  blocking the network locally instead:
  - Linux: `sudo ip route add blackhole <relay.wrdesk.com IP>` (undo: `sudo ip route del ...`),
    or pull the network cable / disable Wi-Fi.
  - Windows: `New-NetFirewallRule -DisplayName "block-relay" -Direction Outbound -RemoteAddress <IP> -Action Block` (remove with `Remove-NetFirewallRule -DisplayName "block-relay"`), or disable the adapter.
- **Version-skew note:** a failure HERE that passed against the local relay likely means
  the deployed relay is on a different build than this branch — record it as **possible
  version skew**, not necessarily a code defect, and report the deployed relay's version.

**PASS:** (a)+(b)+(c) succeed; queue-on-block recovers when the block is removed.

---

## Evidence collection (commit a record)

Save, into `rig-evidence/<date>/`:
1. `git log --oneline -1` output from **both** machines (Step 0).
2. The relay log (`~/relay-xmachine.log`) covering the whole session.
3. App logs from both machines (paths above), trimmed to the session window.
4. A filled copy of this checklist with PASS/FAIL + timestamp per step.
5. For step 1: the relay registry row dump:
   `sqlite3 /tmp/coord-xmachine.db 'SELECT handshake_id,initiator_device_id,acceptor_device_id,handshake_type FROM coordination_handshake_registry;'`
6. Note for the final-smoke section: deployed relay version (if obtainable) + skew verdict.

**INV-5:** before committing logs, confirm no plaintext message/content bodies are present
(capsule hashes, ids, statuses only). Redact if needed.
