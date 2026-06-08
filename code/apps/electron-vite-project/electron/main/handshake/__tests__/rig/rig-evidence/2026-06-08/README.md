# Session evidence — 2026-06-08 cross-machine handshake

Human-operated two-box session on real hardware (Windows Pro host + mini-PC Linux sandbox + LAN relay).

## Contents

| File | Description |
|---|---|
| `CHECKLIST.md` | Filled runbook checklist (Steps 0–8) |
| `git-head-sandbox.txt` | mini-PC git HEAD + RUNTIME_IDENTITY |
| `git-head-windows-host.txt` | Windows host git HEAD (operator-recorded) |
| `relay-registry.txt` | Internal handshake registry rows (both device ids) |
| `relay.log.trimmed` | Scrubbed relay log (key events only) |
| `sandbox-app.log.trimmed` | Scrubbed sandbox app log (key events only) |

## INV-5 scrubbing applied

Before commit, logs were scrubbed of:

- Full **Annex I** spec text inside `context_sync` capsule payloads (`extracted_text`, profile documents)
- All **`p2p_auth_token`** / **`local_p2p_auth_token`** / **`counterparty_p2p_token`** values
- Long capsule JSON bodies, email/AI prompt content, analysis output text

Retained: handshake ids, capsule types, capsule hashes where present, delivery statuses, HTTP status codes, device ids, clone ids, message ids.

## Key handshakes

- `hs-980a3c3e-93b8-4423-ae4f-5b911a000e57` — first pairing; exposed Bearer regression pre-fix
- `hs-e0c54755-afcf-4ffe-ad05-17037df31722` — re-pair after revoke; host-AI PASS on `45fb23ea`

## Source logs (not committed)

- `~/orchestrator-xmachine.log` (sandbox app)
- `~/relay-xmachine.log` (coordination relay)
