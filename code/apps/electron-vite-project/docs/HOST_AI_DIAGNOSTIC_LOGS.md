# Host AI — diagnostics & hardening (team reference)

## Flag defaults (HTTP safety net)

When `WRDESK_P2P_INFERENCE_ENABLED` is on and env vars are **unset**, the app now defaults to:

- **`WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1` (implicit)** — after P2P is considered, direct BEAP ingest may be used as fallback when policy allows (WebRTC remains preferred).
- **`WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1` (implicit)** — Host accepts `internal_inference_request` on HTTP when the P2P request plane is on (avoids hard-rejecting legacy clients).

**To turn off** (stricter P2P-only): set explicitly in the launch environment or shell before starting the app:

- `WRDESK_P2P_INFERENCE_HTTP_FALLBACK=0`
- `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=0`

**Where to flip:** OS environment for dev (`$env:WRDESK_...` in PowerShell), your installer / CI launch script, or packaged app `Environment` manifest. Verify at runtime via `[HOST_AI_FLAGS]` / `[HOST_AI_FLAGS_SOURCE]` (includes `httpFallback` and `httpInternalCompat`).

## Relay signaling circuit breaker

If **three** separate **offer/answer** signaling sends exhaust in-message **429** retries within **60s**, new Host AI P2P session ensures pause **30s** (signaling only — unrelated HTTP is unaffected). Logs: `[P2P_SIGNAL_CIRCUIT]`, `[HOST_AI_SESSION_ENSURE] relay_429_circuit_open`, list row **“Host AI · reconnecting to relay…”**.

## Host startup health (bug reports)

~2.5s after app ready on **Host** orchestrator, main logs one line:

`[HOST_AI_HEALTH] mode=host ollama_reachable=… ollama_models=… relay_ws_connected=… device_id=… account=signed_in|signed_out`

Paste that line in tickets.

## Three log signatures to watch

| Signature | Meaning |
|--------|---------|
| **`[P2P_SIGNAL_OUT] recipient_offline status=202`** | Coordination accepted the signal but the peer is not connected on the relay (expected when the other device is offline or not registered on WS). |
| **`[P2P_SIGNAL_OUT] failed status=429 … OFFER_SIGNAL_SEND_FAILED`** (many times per session, **>** ~3) | Relay is rate-limiting signaling; backoff should apply — if this repeats without recovery, relay quota or client burst tuning is wrong. |
| **`dc_not_open` / transport not ready persisting beyond ~10s** (after capability wait) | WebRTC/DataChannel is actually failing (ICE/session), not just a slow probe — investigate signaling, firewall, or session logs, not only UI polling. |

## End-to-end correlation ID (deferred)

**Deferred:** stamping one correlation id from `transportDecide` → `internalInferenceTransport` → DC frames → BEAP → Host Ollama would touch many wire envelopes and Host handlers. **Reason:** high regression risk without a dedicated migration + golden tests. **Near-term:** continue using existing `X-BEAP-Host-AI-Chain` / stage logs per operation; grep the same `chain=` on Sandbox and Host for a given attempt.
