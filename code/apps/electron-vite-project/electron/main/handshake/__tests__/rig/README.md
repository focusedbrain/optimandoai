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
pnpm test:native-db apps/electron-vite-project/electron/main/handshake/__tests__/relayFailureMode.rig.test.ts
pnpm test:native-db apps/electron-vite-project/electron/main/handshake/__tests__/revokeRepair.rig.test.ts
pnpm test:native-db apps/electron-vite-project/electron/main/handshake/__tests__/qbeapTransports.rig.test.ts
pnpm test:native-db apps/electron-vite-project/electron/main/internalInference/__tests__/serviceRpcGatesAndLifecycle.rig.test.ts
```

Contents:
- `coordinationRelayHarness.ts` — boots the real `packages/coordination-service`
  in-process; owns start / stop (relay-down) / restart (same port + same sqlite).
- `pairingFlow.ts` — shared helper driving a cross-principal handshake to ACTIVE on
  two DBs over the real relay (reused by the revoke/transport suites).
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
| Harness **kills** the relay (POST → ECONNREFUSED) then **restarts** it on the same port + same sqlite; pre-outage registry + stored capsules survive; delivery recovers | `relayFailureMode.rig.test.ts` | green |
| Real outbound capsule queue **holds** a row across the outage and **drains** on recovery, delivering exactly once (relay store stays at 1 — no double insert) | `relayFailureMode.rig.test.ts` | green |

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

---

## 2026-06-06 (later) — Single-box matrix extension (items 3, 7, 8) + verdicts on 4/5/6

Three more suites convert matrix items into green single-box proofs against the
real local relay and a real in-process `createP2PServer` (no `relay.wrdesk.com`):

| Proof | File | Result |
|---|---|---|
| Item 8 — ACTIVE→send allowed; revoke (real `revokeHandshake` + relay-carried revoke capsule)→both DBs REVOKED→send gate (`diagnoseHandshakeInactive`) refuses; delete + re-pair→new handshake ACTIVE→allowed again | `revokeRepair.rig.test.ts` | green |
| Item 3 — qBEAP `message_package` byte-identical over coordination **WS push (200)** and **relay store-pull (202)** | `qbeapTransports.rig.test.ts` | green |
| Item 3 — **direct P2P HTTP**: same qBEAP bytes POSTed to a real peer `createP2PServer` are routed into the native-BEAP ingest pipeline; counterparty-token auth gate enforced (401 on wrong token) | `qbeapTransports.rig.test.ts` | green |
| Item 7 — `assertRecordForServiceRpc` (RemoteHandshakeExecutor gate) rejects **non-ACTIVE** and **different-principal**; non-internal / missing / repair-needed also rejected | `serviceRpcGatesAndLifecycle.rig.test.ts` | green |
| Item 7 — inference **request/result/error/cancel** pending-map state machine settles exactly once (idempotent) | `serviceRpcGatesAndLifecycle.rig.test.ts` | green |

**Verdicts on the remaining items (reported, not faked):**

- **Item 4 — pBEAP trust:** the trust decision (`classifyLivePbeapTrust` / `classifyPbeapTrust`)
  is **100% local, relay-independent**, and already unit-covered with real Ed25519 in
  `depackaging-microvm/__tests__/livePbeapTrust.test.ts` (6/6: `verified_bound` on a bound
  counterparty + valid signature; each lesser verdict — `no_sender_fingerprint`,
  `no_signature`, `signing_bytes_unavailable`, `no_handshake_for_fingerprint`,
  `signature_did_not_verify_under_counterparty_key` — plus the `pbeap_trust` metadata shape).
  A relay rig would add **no** trust semantics. **Persistence gap — now CLOSED** (see the
  2026-06-06 micro-build below): the verdict is persisted end-to-end on both ingest paths.
  Still deferred to Build C (not test infra): the live call sites pass header-only
  (no counterparties / signing bytes), so the live verdict is `unverified_public` until the
  Gate-5 signing-bytes canonicalization is mirrored in main — at which point `verified_bound`
  becomes reachable with no change to how either call site records it.
- **Item 5 — clone outcomes:** the relay-transport halves (`live`=WS push 200,
  `queued`=store-pull 202) are now machine-proven for the message_package wire (item 3 above),
  and the pure relay→matrix mapper is unit-covered (`beapSandboxCloneDeliverySemantics.test.ts`).
  `relay_pending` and ACK-driven `live` are **renderer-only** (15 s `onBeapDeliveryAck` timeout)
  and exactly-once clone needs a second machine toggling offline/online → **two-box runbook**.
- **Item 6 — quarantine custody:** the encrypt→decrypt blob round-trip and "orchestrator
  cannot read plaintext" are unit-covered (`blindCourier.invariant.test.ts`). Full host
  encrypt → qBEAP clone-quarantine send → paired-sandbox decrypt across two live instances
  needs the second machine → **two-box runbook**.

### Boundary note
The single-box harness simulates "two instances" by two sqlite DBs + identity per
operation and uses the relay store/WS as transport. It cannot host two live
orchestrator WS clients with distinct device ids in one process (orchestrator mode /
session / WS holder are module singletons), so direct-P2P and live-both-online
internal flows are deferred to the two-box runbook, by design.

---

## 2026-06-06 (micro-build) — pBEAP trust verdict now persisted end-to-end

Closes the Item-4 persistence gap above. The explicit pBEAP trust verdict
(`classifyLivePbeapTrust` → `pbeapTrustMetadata`) is now **persisted** to
`inbox_messages.depackaged_metadata` on **both** live ingest paths, where before it was
computed and only logged (column stayed NULL).

**Purely additive — no schema change, no read/display-path change.** `depackaged_metadata`
already exists (schema v63). The seal binds only `depackaged_json` (the canonical content),
so the metadata column sits **outside** the seal — persisting it cannot affect sealed
read-path verification. The email path stores a **verdict-only** payload (no `format` key),
so the format-routing readers (`depackagedFormatFromJson` / `depackagedFormatFromMessage`)
still fall through to `depackaged_json` exactly as before; the P2P path persists the wrapper
metadata it already built (`format: 'beap_message_main_process'`, which no consumer branches on).

Wiring:
- `messageRouter.detectAndRouteMessageInline` — capture the verdict in the pBEAP branch,
  thread it onto the inbox `writePayload`, add `depackaged_metadata` to `INBOX_INSERT_SQL`
  and both bind sites.
- `beapEmailIngestion.writeP2PInboxRow` — add `depackaged_metadata` to `P2P_INBOX_INSERT_SQL`
  and bind the already-constructed `p.depackagedMetadata`.

| Proof | File | Result |
|---|---|---|
| P2P path (`processBeapPackageInline`) — `verified_bound` and `unverified_public` both land in `inbox_messages.depackaged_metadata` | `email/__tests__/pbeapTrustPersistence.regression.test.ts` | green |
| email-sync path (`detectAndRouteMessageInline`) — same; **plus** asserts `depackagedFormatFromJson` is unchanged vs. NULL metadata (routing preserved) | `email/__tests__/pbeapTrustPersistence.regression.test.ts` | green |

```bash
pnpm test:native-db apps/electron-vite-project/electron/main/email/__tests__/pbeapTrustPersistence.regression.test.ts
```

(The classifier is mocked per-test to drive `verified_bound`, which the live call sites
cannot yet reach — see the Build-C note above; its real verdict logic is unit-covered in
`livePbeapTrust.test.ts`. The test proves the **persistence wiring** carries whatever verdict
the classifier returns.)
