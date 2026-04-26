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

## Host startup health (bug reports)

~2.5s after app ready on **Host** orchestrator, main logs:

1. `[P2P_SIGNAL_SCHEMA] component=electron-app wire_schema_version=…` (if not already printed earlier from a Host AI list)
2. `[HOST_AI_HEALTH] ollama=ok|down models=N relay_ws=connected|disconnected device_id=… direct_endpoint=http://…:51249/beap/ingest account=signed_in|signed_out`

`device_id` is truncated in packaged builds (privacy). `direct_endpoint` is the published or computed LAN BEAP ingest URL.

Paste both schema + health lines in tickets.

## Diagnostic log signatures (quick reference)

| Signature | Meaning |
|--------|---------|
| **`endpoint_repair_skipped` … `reason=stale_or_non_direct_stored`** with **no** following **`[HOST_INFERENCE_P2P] endpoint_repair_promoted`** | Repair did not fire — **regression** of Prompt 2 path (expect `endpoint_repair_promoted` when a fresh direct endpoint is promoted). |
| **`P2P_SIGNAL_SCHEMA_REJECTED`** / **`failed status=400`** on outbound signal | **Relay schema drift** vs app; compare startup `[P2P_SIGNAL_SCHEMA]` lines. To capture payload, enable **`WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1`** and look for **`[P2P_SIGNAL_SCHEMA_DEBUG]`** — **regression** of Prompt 5 alignment if versions match but reject persists. |
| **`dc_open_timeout`** (or DC not ready) **after answer accepted** | Real **WebRTC** failure (NAT / firewall / ICE), not a bug in the signaling layer alone. |
| **`[P2P_SIGNAL_OUT] dropped_stale_send`** as a **steady stream** | **Lifecycle leak** — **regression** of Prompt 8 guards (stale sends should be occasional, not continuous). |
| **`[P2P_SIGNAL_OUT] recipient_offline status=202`** | Peer **not** on relay WebSocket — **operational**, not an app bug. |
| **`rate_limit_backoff attempt=N`** | Backoff **working as designed** — **operational**; sustained storms may need quota/tuning. |
| **`[P2P_SIGNAL_OUT] failed status=429`** (with backoff) | Bursting on signaling; same operational bucket as backoff. |
| **`[P2P_SIGNAL_OUT] dropped_stale_candidate`** | **Expected** when a new P2P session id replaces an old one; stale ICE for the previous session is dropped. |

## End-to-end correlation ID (optional / deferred)

**Deferred:** stamping one correlation id from `transportDecide` → `internalInferenceTransport` → DC frames → BEAP → Host Ollama would touch many wire envelopes and Host handlers. **Reason:** high regression risk without a dedicated migration + golden tests. **Near-term:** continue using existing `X-BEAP-Host-AI-Chain` / stage logs per operation; grep the same `chain=` on Sandbox and Host for a given attempt.
