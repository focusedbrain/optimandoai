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

## Step 1 — Build + bootstrap (mini-PC / relay box)

From the mini-PC (relay host), one command runs the **full orchestrator packaging build**
(`pnpm run build` in `electron-vite-project`), kills any stale WR Desk instance, starts the
LAN relay, and patches **this machine's** `p2p_config`. Requires a prior WR Desk login on
the mini-PC (stored refresh token — same as Step 2 on Windows).

```bash
cd ~/Dokumente/dev/optimandoai/code
pnpm session:start
```

`session:start` prints four operator lines plus a resume marker:

1. `build commit=… short=… stamp=… builtAt=…` — **record this**; both apps must log the
   same `commit` at launch (Step 3).
2. `windows: …` — copy to the Windows operator for Step 2.
3. `launch: …` — exact binary path for this machine in Step 3.
4. `ready — begin runbook at step 2`

Under the hood (no manual steps): full `electron-vite-project` build (stale binaries
impossible), `coordination-service` build + start on port **51249** with
`COORD_DB_PATH=/tmp/coord-xmachine.db`, logs to `~/relay-xmachine.log`, relay pid at
`/tmp/coord-xmachine.pid`. Real SSO JWT validation (needs internet). **Do NOT** set
`COORD_TEST_MODE=1` — harness-only.

Teardown when the session ends: `pnpm session:stop` (preserves `/tmp/coord-xmachine.db`
for the relay-down recovery test in F1).

**PASS:** `build commit=` matches Step 0 `git log --oneline -1` hash; `/health` ok locally
(`curl -s http://127.0.0.1:51249/health`).

---

## Step 2 — Build + configure Windows (host)

On **Windows Pro**, run the `windows:` line printed by `session:start` (adjust the clone
path if yours differs from `$HOME\dev\optimandoai`):

```powershell
cd $HOME\dev\optimandoai\code; pnpm session:build; pnpm session:configure-remote <RELAY_IP>
```

(`<RELAY_IP>` is filled in by `session:start` — e.g. `192.168.1.50`.)

- `session:build` — full packaging build + kill stale WR Desk; prints its own `build …`
  line and `launch: C:\build-output\buildNNN\win-unpacked\WRDeskT.exe`.
- `session:configure-remote` — patches Windows `p2p_config` to the LAN relay.

**Restart WR Desk** from the `launch:` path `session:build` printed (close any old
instance first). Requires a prior WR Desk login on Windows (stored refresh token).

**PASS:** Windows `build commit=` matches Step 0 hash; `p2p_config` points at
`http://RELAY_IP:51249` / `ws://RELAY_IP:51249/beap/ws`; only the freshly built EXE is
running.

---

## Step 3 — Launch both orchestrators (provenance check)

**mini-PC:** launch using the `launch:` path from Step 1 (not an old install).
**Windows:** already restarted from Step 2 `launch:` path.

Log into account **X** on both. Set roles: Windows = **host**, mini-PC = **sandbox**
(Orchestrator settings).

**Where to look:**

- `[RUNTIME_IDENTITY]` in each app log — must include `commit=<hash>` and `builtAt=<iso>`
  matching the Step 1 / Step 2 `build` lines.
- `[DEVICE_ID_BINDING]` — each box prints its `getCanonicalRelayDeviceId`.
- WS connect line to `ws://RELAY_IP:51249/beap/ws?device_id=...`.

**PASS:** both apps log `commit=` equal to the Step 0 git hash **and** to the `build commit=`
from Step 1 (mini-PC) / Step 2 (Windows); both show a connected coordination WS to `RELAY_IP`.
**FAIL:** `commit=` differs from Step 0 → stale binary; rebuild and relaunch from the printed
`launch:` path.

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
**Relay:** `~/relay-xmachine.log` (written by `session:start`).

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
  (`pnpm session:start` reuses the same `COORD_DB_PATH=/tmp/coord-xmachine.db`). Wait ~30 s.
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
1. `git log --oneline -1` output from **both** machines (Step 0) **and** the `[RUNTIME_IDENTITY]` line
   from each app (Step 3) showing matching `commit=` / `builtAt=`.
2. The relay log (`~/relay-xmachine.log`) covering the whole session.
3. App logs from both machines (paths above), trimmed to the session window.
4. A filled copy of this checklist with PASS/FAIL + timestamp per step.
5. For step 1: the relay registry row dump:
   `sqlite3 /tmp/coord-xmachine.db 'SELECT handshake_id,initiator_device_id,acceptor_device_id,handshake_type FROM coordination_handshake_registry;'`
6. Note for the final-smoke section: deployed relay version (if obtainable) + skew verdict.

**INV-5:** before committing logs, confirm no plaintext message/content bodies are present
(capsule hashes, ids, statuses only). Redact if needed.
