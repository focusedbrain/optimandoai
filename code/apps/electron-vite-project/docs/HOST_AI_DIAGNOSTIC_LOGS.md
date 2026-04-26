# Host AI — diagnostics & hardening (team reference)

## Flag defaults (HTTP safety net)

When `WRDESK_P2P_INFERENCE_ENABLED` is on and env vars are **unset**, the app defaults to:

- **`WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1` (implicit)** — after P2P is considered, direct BEAP ingest may be used as fallback when policy allows (WebRTC remains preferred on the same LAN; relay WebRTC for cross-network).
- **`WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1` (implicit)** — Host accepts `internal_inference_request` on HTTP when the P2P request plane is on (avoids hard-rejecting legacy clients; HTTP fallback over relay can recover transient WebRTC failures invisibly).

**Behavior:** Direct-LAN HTTP is the preferred path on the same network when policy allows; WebRTC handles cross-network; HTTP fallback + internal compat catches transient DC/WebRTC issues without env tweaks.

**To turn off** (stricter P2P-only): set explicitly in the launch environment or shell before starting the app:

- `WRDESK_P2P_INFERENCE_HTTP_FALLBACK=0`
- `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=0`

**Where to flip:** OS environment for dev (`$env:WRDESK_...` in PowerShell), your installer / CI launch script, or a desktop shortcut that sets variables. Packaged builds use the same **implicit** defaults as dev; if your distribution cannot rely on code defaults, set explicitly at launch:

- `WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1`
- `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1`

Electron-builder does not inject main-process env. Verify at runtime via `[HOST_AI_FLAGS]` / `[HOST_AI_FLAGS_SOURCE]` (includes `httpFallback` and `httpInternalCompat`).

## Verbose signal dumps (SDP / ICE)

`[P2P_SIGNAL_SCHEMA_DEBUG]` (full wire + relay body on schema reject) logs **only** when `WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1`. It uses `console.debug` (may include SDP/ICE-shaped fields). There is no separate env for this dump.

## P2P signal wire schema version (drift detection)

On startup, both processes log the wire schema version they implement:

- Relay: `[P2P_SIGNAL_SCHEMA] component=coordination-service wire_schema_version=N` (when the HTTP server begins listening).
- Electron (Host or Sandbox): `[P2P_SIGNAL_SCHEMA] component=electron-app wire_schema_version=N` (once per process — first Host AI list with UX enabled, or ~2.5s Host health, whichever comes first).

If **N** ever differs between relay and app, expect **`failed status=400` … `P2P_SIGNAL_SCHEMA_REJECTED`** storms until versions are aligned. CI keeps the constants in sync: `packages/coordination-service/__tests__/p2pSignalSchemaElectronAlignment.test.ts`.

## Relay signaling circuit breaker (429 storms)

If **three** separate **offer/answer** signaling sends exhaust in-message **429** retries within **60s**, new Host AI P2P session ensures pause **30s** (signaling only — unrelated HTTP is unaffected). Logs: `[P2P_SIGNAL_CIRCUIT]`, `[HOST_AI_SESSION_ENSURE] relay_429_circuit_open`, list row **“Host AI · reconnecting to relay…”**.

## Session terminal storm breaker (repeated failed sessions)

If **three** transitions to **`phase=failed`** for the **same handshake** occur within a **60s** rolling window, new session ensures pause **30s** with the same user-visible **reconnecting** row (`p2pUiPhase=relay_reconnecting`, code `HOST_AI_SESSION_TERMINAL_STORM`). Logs: `[HOST_AI_SESSION_STORM]`, `[HOST_AI_SESSION_ENSURE] session_storm_pause`, `[LIST_HOST_AI] target_session_storm_pause`. Successful **DataChannel** progress (`datachannel_open` / `ready`) clears the failure streak for that handshake.

## Permanent operational logs (do not remove or gate)

These lines are **intentional** for field diagnostics and debouncer verification. They are **not** debug-only:

| Token | Where | Meaning |
|--------|--------|---------|
| **`[HOST_INFERENCE_P2P] endpoint_repair_promoted`** | `p2pEndpointRepair` | Stored direct endpoint was promoted from relay advertisement — **expected** when repair runs. |
| **`[P2P_SIGNAL_OUT] dropped_stale_send`** | `p2pSignalRelayPost` | Outbound ICE/offer for a **superseded** session id was dropped — **expected** during session rotation; a **steady stream** still indicates a lifecycle leak (see below). |
| **`[HOST_INFERENCE_TARGETS] probe_coalesced`** / **`probe_joined`** | `src/lib/coalescedListInferenceTargets.ts` (renderer) | List/probe IPC coalesced duplicate work — **operational**, not a bug. |
| **`[HOST_INFERENCE_TARGETS] ipc_list_coalesced`** | `internalInference/ipc` | Parallel renderer list IPC joined one in-flight call — **operational**. |
| **`[P2P_SIGNAL_OUT] rate_limit_backoff`** | `p2pSignalRelayPost` | Signaling hit 429 and is backing off — **operational**; tune quotas if storms persist. |
| **`[HANDSHAKE_HEALTH]`** | `handshake/handshakeHealthStartupLog` | **Once** per process, **immediately after** `[RELAY_WS_LIFECYCLE] startup_check` inside `tryP2PStartup`: either `no_active_handshakes` or one line per **`state=ACTIVE`** row — `handshake`, `role`, `local_device_role`, `peer_device_role`, `peer_device`, `peer_name`, `p2p_endpoint_kind`, `p2p_auth_token_set`, `counterparty_p2p_token_set`, `coordination_complete`, and when not healthy `health` + `reason` (`BROKEN` / `DEGRADED` / `SUBOPTIMAL`). **OK** rows omit `health`/`reason`. **Do not remove** — half-paired / missing-token shows in the first screen of logs. |
| **`[HANDSHAKE_HEALTH_REMOTE]`** | `handshake/handshakeHealthRemoteCheck` | **After** relay WebSocket **`connect_open`**, once per ~90s per process: for each **internal same-principal** `ACTIVE` row, the app **POSTs** local tier/reason/endpoint to the coordination relay, **GETs** the peer device’s last snapshot, and logs **only when `agreement=false`**: `handshake=… local_health=… peer_health=OK|BROKEN|DEGRADED|SUBOPTIMAL|UNKNOWN agreement=false divergence=…`. **`agreement=true`** → **no log** (silent OK). Divergence values: `peer_does_not_have_handshake` (no peer row / never reported), `peer_reports_local_token_missing` (peer reason `missing_counterparty_token`), `local_endpoint_kind_relay_peer_endpoint_kind_direct`, `health_mismatch` (catch-all). **Requires** relay HTTP `coordination_url`, JWT, and **`register-handshake`** so the registry lists both device ids. Peer **offline** can look like a missing report — triage with **`[HANDSHAKE_HEALTH]`** on both machines. |

## Host startup health (bug reports)

**Immediately** after internal-inference IPC registration (Host **and** Sandbox):

- `[HOST_AI_HEALTH] startup phase=internal_inference_ipc orchestrator_mode=host|sandbox|… pid=…`

**When the ledger DB is first ready** (same tick as first successful `tryP2PStartup`, right after **`[RELAY_WS_LIFECYCLE] startup_check`** — may be a few seconds after process start if login is late):

- `[HANDSHAKE_HEALTH] no_active_handshakes` **or**  
  `[HANDSHAKE_HEALTH] handshake=… role=initiator|acceptor local_device_role=host|sandbox|unknown peer_device_role=… peer_device=… peer_name=… p2p_endpoint_kind=direct|relay|missing|invalid p2p_auth_token_set=yes|no counterparty_p2p_token_set=yes|no coordination_complete=true|false` plus when unhealthy `health=BROKEN|DEGRADED|SUBOPTIMAL reason=coordination_incomplete|endpoint_invalid|missing_self_token|missing_counterparty_token|endpoint_repair_pending`
- **Internal** rows: `counterparty_p2p_token_set` follows **`internal_coordination_identity_complete`** (coordination identity on the ledger); `p2p_auth_token_set` is the shared Bearer material (`counterparty_p2p_token`). **`health=BROKEN` + `reason=coordination_incomplete`** matches **`INTERNAL_ENDPOINT_INCOMPLETE`** until re-pair / identity repair.

~2.5s after app ready on **Host** orchestrator, main also logs (unchanged):

1. `[P2P_SIGNAL_SCHEMA] component=electron-app wire_schema_version=…` (if not already printed earlier from a Host AI list)
2. `[HOST_AI_HEALTH] ollama=ok|down models=N relay_ws=connected|disconnected device_id=… direct_endpoint=http://…:51249/beap/ingest account=signed_in|signed_out`

`device_id` is truncated in packaged builds (privacy). `direct_endpoint` is the published or computed LAN BEAP ingest URL.

Paste **startup** + **`[HANDSHAKE_HEALTH]`** (if ledger open) + **`[HANDSHAKE_HEALTH_REMOTE]`** (if relay connected and internal ACTIVE) + **schema** + **Host detail** health lines in tickets.

### Relay HTTP — handshake health (Part C)

- **`POST /beap/handshake-health-report`** — Bearer required; body `{ handshake_id, device_id, health_tier, reason?, endpoint_kind? }`; `health_tier` ∈ `OK|BROKEN|DEGRADED|SUBOPTIMAL`. Upserts the caller’s snapshot for that handshake + device (must match **coordination_handshake_registry** and the JWT user).
- **`GET /beap/handshake-health-peer?handshake_id=&device_id=`** — Bearer required; returns `{ peer: { health_tier, reason, endpoint_kind, updated_at } | null }` for the **other** device on the handshake (same-principal or cross-user).

## Runbook — common signatures (Prompt 8)

| Symptom / log | Interpretation | Action |
|--------|---------|--------|
| **`INTERNAL_ENDPOINT_INCOMPLETE`** UI banner | **Coordination identity missing or incomplete on this device** (ledger row exists but device/coordination fields are not fully populated for outbound internal paths). | **Re-pair** the internal handshake (or complete orchestrator identity in Settings); do not chase downstream BEAP until **`[HANDSHAKE_HEALTH]`** shows `coordination_complete=true`, **`health`** absent (or `OK`), and **`p2p_auth_token_set=yes`**. |
| **`[P2P] Rejection` … `handshake_id=unknown`** on Host | Request was rejected **before** handshake/body attribution — **missing or invalid Bearer** on the inbound BEAP request. | **Re-pair** or fix Sandbox **outbound `Authorization` / `X-BEAP-Handshake`** for that endpoint; compare with a probe that logs a real `handshake_id`. |
| **Sandbox `INSPECT` / dump: `p2p_auth_token_set=no`** (and `counterparty_p2p_token_set=no`) | **Pairing token exchange never completed** on this row — not a transport or Ollama issue. | **Re-pair**; do not spend time on DC/WebRTC/Ollama until the inspect shows **`yes`**. |
| **`auth_rate_limit`** with a **valid** `handshake_id` (Host log shows handshake parsed) | Authenticated same-principal traffic is still hitting the **per-IP auth-failure or ingest rate bucket**. | **Raise** LAN-tier limits or fix accidental **failed-auth** attempts; see rate-limiter / P2P ingest caps (Prompt 4). |
| **`auth_rate_limit`** with **`handshake_id=unknown`** | Failures occurred **before** handshake parse — usually **many bad/missing Bearer attempts** tripping the **auth-failure** counter. | Fix token/header path first (re-pair); then tune limits if still needed. |
| **`[HANDSHAKE_HEALTH_REMOTE]`** + `divergence=peer_does_not_have_handshake` | Local and relay disagree whether the peer has published health (or peer never connected post-change). Often **re-pair** or ensure both devices **register-handshake** + open relay WS. | Compare **`[HANDSHAKE_HEALTH]`** on both sides; confirm peer relay connectivity. |
| **`[HANDSHAKE_HEALTH_REMOTE]`** + `peer_reports_local_token_missing` | Peer ledger reports **`missing_counterparty_token`** — token path failed for material your device should have issued/received. | **Re-pair** / re-issue token path; align with **`[HANDSHAKE_HEALTH]`** token flags. |
| **`[HANDSHAKE_HEALTH_REMOTE]`** + `local_endpoint_kind_relay_peer_endpoint_kind_direct` | Peer already **direct**; this device still **relay** — endpoint repair may be stuck locally. | Run **Host inference / endpoint repair** path; confirm **`endpoint_repair_promoted`**; compare stored `p2p_endpoint`. |

## Diagnostic log signatures

Every line below is a **known signature**. If you see one in main-process or renderer logs, use the meaning and fix — do not guess.

### Coordination / pairing

- **`INTERNAL_ENDPOINT_INCOMPLETE`** (UI banner)  
  **Meaning:** This device has no coordination identity for this handshake.  
  **Fix:** Re-pair.

- **`[P2P] Rejection` … `handshake_id=unknown`** (Host log)  
  **Meaning:** Outbound request from peer carries no valid auth token, **or** Host’s ledger has no row for the handshake.  
  **Fix:** Re-pair. Do not debug the request path until pairing is confirmed on both sides.

- **`p2p_auth_token_set=no`** on **`[INTERNAL_HOST_P2P_INSPECT]`** (Sandbox log; enable **`WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1`** to emit the line, or use the IPC inspect payload)  
  **Meaning:** Sandbox never received its own token from the pairing flow — pairing incomplete.  
  **Fix:** Re-pair. Do not try to fix downstream — it cannot work without the token.

- **`[HANDSHAKE_HEALTH] health=DEGRADED reason=missing_self_token`** (startup log)  
  **Meaning:** Same as missing token, surfaced at startup.  
  **Fix:** Re-pair.

- **`[HANDSHAKE_HEALTH_REMOTE] agreement=false divergence=peer_does_not_have_handshake`**  
  **Meaning:** Local ledger has the handshake but the peer’s does not (or vice versa).  
  **Fix:** Re-pair from scratch on both sides.

### Rate limiting

- **`auth_rate_limit`** with **`handshake_id=<real-id>`**  
  **Meaning:** Rate-limit bucket too tight for legitimate authenticated traffic.  
  **Fix:** Raise bucket for same-principal authenticated requests.

- **`auth_rate_limit`** with **`handshake_id=unknown`**  
  **Meaning:** Pairing is incomplete (see Coordination / pairing), not actually a rate-limit problem.  
  **Fix:** Re-pair.

- **`[P2P_SIGNAL_OUT] failed status=429`** / **`OFFER_SIGNAL_SEND_FAILED`** (more than ~3 in a session)  
  **Meaning:** Sandbox is bursting too many ICE candidates. Mitigated by **`rate_limit_backoff`**.  
  **Fix:** If it returns, confirm backoff is still applied and probe debouncing ( **`[HOST_INFERENCE_TARGETS] probe_coalesced`** ) is active.

### Endpoint

- **`[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=stale_or_non_direct_stored`** and **no** following **`endpoint_repair_promoted`**  
  **Meaning:** Repair pass found a direct endpoint but did not promote.  
  **Fix:** Regression of endpoint promotion logic — triage `p2pEndpointRepair`.

- **`p2p_endpoint_kind=relay`** even though both peers are on the same LAN  
  **Meaning:** Endpoint repair did not run or did not promote.  
  **Fix:** Check repair pass; ensure **`endpoint_repair_promoted`** fires when the Host advertises a direct LAN ingest.

### WebRTC (deferred / environmental)

- **`P2P_SIGNAL_SCHEMA_REJECTED`** / **`status=400`**  
  **Meaning:** Relay schema does not match what the WebRTC stack emits.  
  **Fix:** Capture payload with **`WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1`** → **`[P2P_SIGNAL_SCHEMA_DEBUG]`**; loosen schema for the failing field or align wire versions (`[P2P_SIGNAL_SCHEMA]`).

- **`dc_open_timeout`** after answer accepted  
  **Meaning:** Real WebRTC connectivity failure (NAT / firewall / ICE), not a code bug by itself.  
  **Fix:** Check ICE candidates gathered, NAT type, firewall.

- **`dropped_stale_send`** as a **steady stream**  
  **Meaning:** Lifecycle bug — old session’s PeerConnection still emitting candidates after a new session started.  
  **Fix:** Lifecycle hardening — close PC on **`session_fail`**.

### Probe failures (distinct codes, Part D)

Log token after **`detail=probe_`** (e.g. **`AUTH_REJECTED`**, not **`PROBE_AUTH_REJECTED`**).

| Code | Meaning / fix |
|------|----------------|
| **`probe_AUTH_REJECTED`** | Re-pair or check outbound auth headers. |
| **`probe_RATE_LIMITED`** | Check rate-limit bucket sizing on Host/relay. |
| **`probe_HOST_UNREACHABLE`** | Host machine offline or network blocked. |
| **`probe_NO_MODELS`** | Host’s Ollama has no models installed. |
| **`probe_OLLAMA_UNAVAILABLE`** | Host’s Ollama is genuinely down — **only** valid after auth succeeded (no 401/403/429 on that probe attempt). |

### Operational (not bugs)

- **`[HANDSHAKE_HEALTH] health=OK`** — Install is healthy for that row.
- **`[HOST_INFERENCE_TARGETS] probe_coalesced`** — Debouncer collapsed duplicate IPC/list calls (**working as designed**).
- **`rate_limit_backoff attempt=N`** — Exponential backoff on signaling (**working as designed**).
- **`recipient_offline status=202`** — Peer not on relay (**expected** when peer is offline).

### Quick grep table (legacy cross-reference)

| Signature | Meaning |
|--------|---------|
| **`[HANDSHAKE_HEALTH]`** + **`coordination_complete=false`** or **`health=BROKEN` + `reason=coordination_incomplete`** on internal ACTIVE | Half-paired — **`INTERNAL_ENDPOINT_INCOMPLETE`** until identity is fixed. |
| **`[P2P_SIGNAL_OUT] dropped_stale_candidate`** | **Expected** when a new P2P session id replaces an old one. |
| **`[P2P] Rejection`** + **`auth_rate_limit`** + **`handshake_id=unknown`** | Often bad/missing Bearer before parse — re-pair; see Coordination / pairing. |
| **`detail=probe_RATE_LIMITED`** / **`probe_AUTH_REJECTED`** (list logs) | See Probe failures table above. |
| **`ipc_list_coalesced`** (main IPC) | Parallel list IPC joined one in-flight call — **operational**. |

## Deferred engineering (explicit)

### WebRTC signal wire schema hardening

**When:** Cross-network / relay signaling paths where **coordination-service** and Electron **must** accept the same offer/answer/ICE envelope shapes (NAT traversal, multi-hop).

**Why deferred:** LAN + HTTP fallback can validate the product first; schema changes touch relay, Host, Sandbox, and CI alignment tests (`p2pSignalSchemaElectronAlignment`).

**Trigger to schedule:** Persistent **`P2P_SIGNAL_SCHEMA_REJECTED`** / **`400`** on signaling **after** confirming `[P2P_SIGNAL_SCHEMA]` version lines match, or new ICE fields required by a browser / TURN deployment.

### P2P session lifecycle (repeated probe / selector open-close)

**When:** Users **rapidly** open the model selector, switch networks, or run **back-to-back** probes without full process restart.

**Why deferred:** Prompt 3/4 debouncing reduces duplicate HTTP; remaining issues are **orphan PeerConnections** or **stale ICE** after session id rotation.

**Trigger to schedule:** Steady **`dropped_stale_send`** / candidate traffic **after** the selector is closed, or **`HOST_AI_SESSION_TERMINAL_STORM`** without user-visible recovery — run **Prompt 8 (lifecycle hardening)** from the prior sequence.

## End-to-end correlation ID (optional / deferred)

**Deferred:** stamping one correlation id from `transportDecide` → `internalInferenceTransport` → DC frames → BEAP → Host Ollama would touch many wire envelopes and Host handlers. **Reason:** high regression risk without a dedicated migration + golden tests. **Near-term:** continue using existing `X-BEAP-Host-AI-Chain` / stage logs per operation; grep the same `chain=` on Sandbox and Host for a given attempt.
