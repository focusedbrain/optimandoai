# Headless auto-accept trust model (Edge Agent)

This document records the security policy for **workstream 4** of the Agent pairing collapse refactor: when the Edge Agent has no human operator, it must still complete an `edge_ingestor` BEAP handshake initiated from the orchestrator over the coordination relay.

**Status:** Specified here for review; implementation ships in workstream 4 after workstreams 1–3 and product-owner sign-off.

## Policy

The Agent **auto-accepts** an incoming handshake initiate when **all** of the following hold:

1. The Agent is SSO-signed-in (persisted `ssoSub` and valid access/refresh tokens).
2. `handshake_type` is `edge_ingestor`.
3. `receiver_pairing_code` in the initiate matches the **registry** 6-digit code the Agent registered with the coordination service (not the legacy `:8443` RAM pairing code).
4. The initiator’s SSO `sub` (and email when present) match the Agent’s own `ssoSub` / `ssoEmail`.
5. The role pair is `host ↔ edge_agent`, valid per PR4.5 device-role binding.

If any condition fails, the Agent **auto-rejects** and emits a structured log event (PR7) with reason codes suitable for orchestrator display.

## Why this is considered safe

An attacker who satisfies all five conditions already possesses the victim’s SSO identity. With that identity they can act as the user across WR Desk (orchestrator, vault, coordination registry under the same `sub`). The auto-accept does not introduce a new privilege beyond “attacker is the user.”

The registry pairing code is a **disambiguation** mechanism when multiple Agents exist under one account. It is not a high-entropy secret and must not be treated as the security boundary.

Cryptographic binding, replay protection, and sequence counters remain those of the existing BEAP handshake pipeline (same as sandbox/internal).

## What we give up vs the current pairing protocol

The legacy flow includes a **fingerprint ceremony** so a human on the VPS can visually confirm “this is the server I just installed.” Headless VPS setup has no operator at accept time.

Analysis (`docs/analysis/agent-pairing-vs-sso-handshake-analysis.md`) concluded the fingerprint is reassurance, not an independent security control: SSO + handshake crypto already address the MITM the fingerprint nominally guards. Product owner must explicitly accept this trade for unattended servers before workstream 4 ships.

## Edge cases (implementation notes for workstream 4)

- **Partial match** (e.g. correct `sub` but wrong registry code): reject; log `headless_accept_rejected` with `reason`.
- **Malformed initiate**: reject at ingest; do not create `PENDING` unless pipeline validation passes.
- **Replay of prior valid initiate**: handled by existing handshake replay/sequence rules; auto-accept must not bypass ledger idempotency.
- **Rate limiting**: repeated failed initiates log as security-relevant; beyond a configurable threshold, surface anomaly / `haltedByAnomaly` (exact threshold TBD in WS4).

## `local_pairing_code_typed` equivalent

Sandbox accept requires a human to type the local registry code (`AcceptHandshakeModal`). The Agent supplies its **stored** registry code automatically as the typed-code equivalent when calling accept.

## Related work

- Registry registration: workstream 1 (`deviceIdentity`, `coordination/registry`).
- Initiate delivery: workstream 2 (coordination WebSocket).
- Ingest → `PENDING`: workstream 3.
- Orchestrator initiate + wizard: workstream 5.
- Deletion of `:8443` pairing: workstream 6 only after end-to-end proof.

## Prerequisites (epic gates)

Do not enable headless auto-accept in production until:

1. Current pairing protocol is verified end-to-end on real infrastructure.
2. Product owner signs off on this trust model.
3. Security review of workstream 4 implementation is complete.
