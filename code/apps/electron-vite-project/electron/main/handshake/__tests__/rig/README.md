# Handshake cross-surface rig

Test-only scaffolding for proving the internal handshake round-trip against a
**real** coordination relay (no mocks, never `relay.wrdesk.com` in automated runs).
None of this is reachable from the production app bundle — it lives under
`__tests__/` and loads only in Vitest.

Run the suites under Electron's Node ABI (better-sqlite3 binding):

```bash
cd code
pnpm test:native-db apps/electron-vite-project/electron/main/handshake/__tests__/pairingCodeRelayGap.rig.test.ts
pnpm test:native-db apps/electron-vite-project/electron/main/handshake/__tests__/pairingActivation.rig.test.ts
```

Contents:
- `coordinationRelayHarness.ts` — boots the real `packages/coordination-service`
  in-process; owns start / stop (relay-down) / restart (same port + same sqlite).
- `CROSS_MACHINE_RUNBOOK.md` — human-operated two-box session (Phase 2).

---

## 2026-06-06 — Single-box machine-proof + Phase-0 gap fix

**Branch:** `feature/layered-sandbox`. **Relay:** local, harness-owned
coordination-service (`COORD_TEST_MODE=1`, port 0, temp sqlite). No
`relay.wrdesk.com` in any automated test.

### Phase-0 gap — verdict: real production defect (now fixed)

The internal-initiate relay fast-path referenced a client resolver
`resolvePairingCodeViaCoordination` in three comments (`handshake/ipc.ts:1508`,
`coordination-service/src/server.ts:763`, `electron/main.ts:9248`) that was never
implemented. The initiate capsule therefore carried only the 6-digit
`receiver_pairing_code` and **no** `receiver_device_id`, and register-handshake
never set `acceptor_device_id`. Against a **real** relay the same-principal initiate
guard rejects with `initiate_missing_routing_fields` / `no_route_for_internal_initiate`.
Masked in production by the email/file fallback; masked in tests by mocks that
pre-supply `counterparty_device_id`.

Fix (`fix(handshake): resolve pairing code to relay device-id …`): implement the
resolver (`handshake/resolvePairingCode.ts`, fail-open) and thread the resolved peer
instance id onto the initiate wire as `receiver_device_id` (a hash-excluded routing
field — capsule types and signatures unchanged) and into `acceptor_device_id` at
registration. No wire-format or capsule-type changes.

### Machine-proven now (automated, green on this box)

| Proof | File | Result |
|---|---|---|
| Resolver resolves a registered 6-digit code → peer instance id; null for unknown (fail-open) | `pairingCodeRelayGap.rig.test.ts` | green |
| Pre-fix wire (no `receiver_device_id`) → relay 400 `initiate_missing_routing_fields` (RED) | `pairingCodeRelayGap.rig.test.ts` | green |
| Resolved wire → relay routes the internal initiate (200/202), registry carries `acceptor_device_id` (GREEN) | `pairingCodeRelayGap.rig.test.ts` | green |
| NORMAL pairing → **ACTIVE** on both instances; accept + bilateral context_sync carried over the real relay; real signature/enforcement path | `pairingActivation.rig.test.ts` | green |
| Same capsule byte-identical over WS-live push (200) and store-pull (202) | `pairingActivation.rig.test.ts` | green |

### What Phase 2 (two boxes) will prove — NOT machine-provable single-box

These need two OS processes (separate orchestrator instance ids), real UI, and a
real network — see `CROSS_MACHINE_RUNBOOK.md`:

- Internal (same-principal) host↔sandbox pairing across two machines + real LAN relay.
- Direct **P2P-HTTP** transport (instance-to-instance) — the third delivery path.
- Clone gesture `live` / `relay_pending` / `queued` with a real second machine going
  offline/online; exactly-once delivery.
- Quarantine custody to the paired sandbox machine (encrypted blob end-to-end).
- Internal inference request/result/cancel host↔sandbox across machines.
- Revoke from the UI → delivery refused → re-pair restores.
- Relay-down/recovery with the human stopping/restarting the LAN relay; deployed-relay
  (`relay.wrdesk.com`) smoke (1 pairing / 1 message / 1 clone) with a version-skew note.

### Boundary note
The single-box harness simulates "two instances" by two sqlite DBs + identity per
operation and uses the relay store/WS as transport. It cannot host two live
orchestrator WS clients with distinct device ids in one process (orchestrator mode /
session / WS holder are module singletons), so direct-P2P and live-both-online
internal flows are deferred to the two-box runbook, by design.
