# B1 — Cross-network ingestion poll validation (operator runbook)

**Goal:** Prove host Sync triggers a sealed poll that completes over `relay.wrdesk.com`
when the host and sandbox are on **different networks** (no LAN path between them).

**Prerequisite:** Phase A complete (`ad3f75a0` or later). Both apps built from the same
commit (`pnpm session:build` or release installer).

---

## What you are proving

| Must happen | Must NOT happen |
|-------------|-----------------|
| Host seals `ingestion_poll_request` → POST `https://relay.wrdesk.com/beap/capsule` | `target=…:51250` or `host sending direct HTTP trigger` |
| Sandbox receives sealed capsule on coordination WebSocket | `peer ingest endpoint resolved` |
| Sandbox runs poll once, seals result, POST back to relay | Plaintext `ingestion_poll_*` on relay |
| Host receives sealed result → UI shows `delivered=N` (or HELD/unreachable) | Host↔sandbox traffic on a private LAN IP |

---

## Minimal setup (two networks, one public relay)

You need **two physical machines** (or one machine + one phone/laptop on cellular).

| Machine | Role | Network |
|---------|------|---------|
| **A — Host** | WR Desk **Host** orchestrator | Home/office Wi‑Fi (Network 1) |
| **B — Sandbox** | WR Desk **Sandbox** orchestrator | **Different** network — phone hotspot, guest Wi‑Fi, or another location (Network 2) |

Both machines need **outbound internet** only. They do **not** need to reach each other's local IP addresses.

### Do NOT use the LAN relay lab scripts for B1

`pnpm session:start` / `session:configure-remote <LAN_IP>` points apps at a **local**
relay on your Wi‑Fi. For B1, leave coordination on the **production defaults**:

- `https://relay.wrdesk.com`
- `wss://relay.wrdesk.com/beap/ws`

(Fresh installs use these by default. If you previously ran session scripts, reset
coordination URLs in WR Desk settings or re-run with production URLs before testing.)

---

## Step-by-step (non-developer)

### 1. Install the same build on both machines

- Build once: `pnpm session:build` (or use the same release build number on both).
- Launch **only** the printed `launch:` path on each machine.
- Log into the **same** WR Desk account on both.

### 2. Put the sandbox on a different network

1. On **Machine B (sandbox)**, disconnect from the host's Wi‑Fi.
2. Connect to **cellular hotspot** or another Wi‑Fi network that is **not** the host's LAN.
3. Confirm on B you can open a browser to `https://relay.wrdesk.com` (or any HTTPS site).

Optional sanity check (proves no LAN shortcut):

- On the host, note your LAN IP (Windows: Settings → Network → Wi‑Fi → properties).
- On the sandbox (hotspot), try to ping that IP — it **should fail** or time out.

### 3. Set orchestrator roles and pair

1. **Machine A:** Orchestrator mode = **Host**.
2. **Machine B:** Orchestrator mode = **Sandbox**.
3. Pair using the **6-digit code** (sandbox shows code, host enters it).
4. Wait until both show the handshake **Connected / ACTIVE**.

**Important:** Pairing must be **remote dedicated** topology (separate machines), not
an in-host VM. If Sync never triggers from the host, check topology shows **dedicated**
(not single-machine inner VM).

### 4. Email accounts (delegated ingestion)

1. **Host (A):** At least one connected email account (send side).
2. **Sandbox (B):** A **read-only** email account for the same mailbox (read consent).
3. Confirm ingestion is **delegated** to the sandbox (host does not read-poll locally).

### 5. Run the test — Sync on the host

1. Keep **both** WR Desk apps running and signed in.
2. On **Machine A (host)**, open Inbox and click **Sync** on the delegated account.
3. Watch the sync banner:
   - Briefly: “Syncing with your paired sandbox device…”
   - Then: success with **delivered=N** counts, or a clear HELD/unreachable message.

### 6. Collect evidence (PASS / FAIL)

Save log excerpts from **both** machines for the Sync window (timestamps help).

**Host — must include:**

```
[IngestionPollTrigger] host sealing relay trigger. request_id=… receiver=…
[IngestionPollTrigger] host sealed relay accepted (async pending). request_id=…
[IngestionPollTrigger] host sealed result ack. request_id=… delivered=N …
```

**Sandbox — must include:**

```
[IngestionPollTrigger] host trigger received. request_id=…
[IngestionPollTrigger] poll complete. request_id=…
[IngestionPollTrigger] sealed relay response sent. … inner=ingestion_poll_result
```

**Both — coordination (optional but useful):**

```
[Coordination] … sealed_service_rpc_v1 …
[RELAY_IDENTITY] outbound_capsule … receiver_device_id=…
```

**FAIL signatures (report if seen):**

- `host sending direct HTTP trigger` or `target=…:51250`
- `peer ingest endpoint resolved` or `E_INGESTION_POLL_PEER_ENDPOINT`
- `host sealed relay pending expired` without a matching sandbox `poll complete`
- Sync stuck on pending with sandbox online (WS not connected to relay)

---

## Relay-side observation (operator)

You typically **cannot** read ciphertext on the public relay. Success is inferred from:

1. Host POST to `/beap/capsule` returns **200** (live) or **202** (queued).
2. Sandbox WS receives the capsule (app log: trigger received).
3. Host WS receives the result capsule (app log: sealed result ack).

If you operate a **private** coordination instance, relay logs show routing by
`handshake_id` + `sender_device_id` / `receiver_device_id` only — not LAN IPs.

---

## GATE B1 pass criteria

- [ ] Sandbox was on a **different network** from the host (hotspot or separate site).
- [ ] No LAN IP connectivity between host and sandbox (optional ping check).
- [ ] Sync completed with sealed relay logs on **both** sides.
- [ ] UI resolved to counts or explicit HELD/unreachable (not silent pending forever).
- [ ] No direct-LAN poll log lines (table above).

---

## Troubleshooting (still no code changes in B1)

| Symptom | Likely cause |
|---------|----------------|
| Host never triggers | Topology not `dedicated`, or host still owns read-poll |
| `E_INGESTION_POLL_RELAY_UNAVAILABLE` | Coordination URL not set / `use_coordination` off |
| `E_INGESTION_POLL_AUTH` | SSO session expired — re-login on host |
| Pending forever | Sandbox WS disconnected — check sandbox online + `wss://relay.wrdesk.com/beap/ws` |
| `held_read_consent_missing` | Read account not configured on sandbox (poll ran; mail path separate) |
