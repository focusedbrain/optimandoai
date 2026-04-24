# Handshake cross-surface regression test matrix

**Purpose — break the “ping-pong” loop:** refactors that fix **internal** (same-principal) flows often break **normal** (cross-principal) flows, and vice versa. This matrix defines **automatable** test names, fixtures, invariants, logs, and DB expectations so **all four accept surfaces** are verified **together** in CI—not one at a time.

**Non-goals in this document:** this file does not implement product logic. It is the spec for tests (or `describe`/`it` stubs with `it.todo` / `test.skip` until drivers exist).

**Automation tiers**

| Tier | Meaning |
|------|---------|
| U | Unit / pure (Vitest, no network) — already partially covered by `handshakeRefactorRegression.matrix.test.ts` |
| I | In-process integration (mock DB + mock relay HTTP/WS) |
| E | Full stack (real coordination `packages/coordination-service` test server + two logical peers) |

---

## Shared fixtures (reusable)

| ID | Description | Where used |
|----|-------------|------------|
| F-SSO-I | `SSOSession` for **user A (initiator)**: distinct `wrdesk_user_id`, `sub`, `email` | both peers |
| F-SSO-A | `SSOSession` for **user B (acceptor)** (NORMAL) or same `wrdesk_user_id` with different `sub` only when testing claims (INTERNAL uses same `wrdesk_user_id` where the product does) | peer B |
| F-INT-REG | `register-handshake` body: `initiator_device_id`, `acceptor_device_id`, `handshake_type: 'internal'` (per relay contract) | INTERNAL + relay I/E |
| F-NORM-REG | `register-handshake` body: distinct `initiator_user_id` / `acceptor_user_id`, **no** internal-only fields required | NORMAL + relay I/E |
| F-OIDC | Valid test Bearer (`test-*-pro` pattern in `COORD_TEST_MODE` coordination tests) or real JWT in E | relay |
| F-X25519-NORMAL | `senderX25519PublicKeyB64` (or snake_case / `key_agreement.x25519_public_key_b64`) non-empty on **normal** accept path | Electron renderer shim + extension |
| F-NO-X25519 | Explicitly omit all wire X25519 fields | failure case NORMAL only |
| F-RECV-QUIRK | For routing tests: `receiverIdentity` / display-only fields **mismatched** or extra vs `wrdesk_user_id` — must **not** change relay `recipient_user_id` or registry mapping | assert no swap |

**Code areas (shared, all flows touch at least one)**

| Area | Role |
|------|------|
| `electron/main.ts` | `ipcMain.handle('handshake:accept', …)` — params, X25519 / ML-KEM, internal hints |
| `electron/main/handshake/ipc.ts` | `handleHandshakeRPC`, `record.handshake_type`, `ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED`, relay reg, `context_sync` defer |
| `electron/main/handshake/p2pTransport.ts` | Coordination HTTP POST; 200/202; `coordinationRelayDelivery` |
| `electron/main/p2p/relaySync.ts` | `register-handshake` + post-register `flush-queued` |
| `electron/main/p2p/coordinationWs.ts` | WS push, `processIncomingInput` / handshake pipeline, internal skip/trace |
| `electron/main/p2p/coordinationFlushQueued.ts` | Client recovery `POST /beap/flush-queued` |
| `packages/coordination-service/src/server.ts` | `/beap/capsule`, `/beap/register-handshake`, `/beap/flush-queued`, internal vs normal routing |
| `packages/coordination-service/src/wsManager.ts` | `handleConnection` pending drain, `flushPendingToConnectedClientsForUser` |
| `packages/coordination-service/src/store.ts` | `coordination_capsules` pending vs pushed |
| `electron/main/handshake/db.ts` | `handshakes` row R/W |
| `contextSyncActiveGate.ts` | **(assert only, do not “fix” in tests by editing prod)** `getNextStateAfterInboundContextSync` transition contract |
| `src/shims/handshakeRpc.ts` | Renderer → Electron `acceptHandshake` (keys, normal vs internal) |
| `apps/extension-chromium/src/handshake/handshakeRpc.ts` | VAULT_RPC → same main handlers (if extension supported) |

---

## Flow 1 — INTERNAL + Electron app accept

| Test name | Tier | What it must prove |
|-----------|------|--------------------|
| `regression_INT_EL_accept_phase_persists_initiate_imports_accept` | I/E | Initiate record persisted; imported accept path runs; `ACCEPTED` after accept |
| `regression_INT_EL_local_role_initiator_acceptor` | I/E | Initiator side `local_role === 'initiator'`; acceptor `local_role === 'acceptor'` |
| `regression_INT_EL_handshake_type_internal` | I/E | `handshakes.handshake_type === 'internal'` (both devices’ DB views where applicable) |
| `regression_INT_EL_X25519_strict_device_bound` | I/E / U | **Internal** may resolve **strict device-bound** X25519 (main/device store) — **not** the “must have wire b64 for normal” rule; assert no **ephemeral X25519 mint** for **normal** rules on this path (product-specific: internal accept uses internal policy) |
| `regression_INT_EL_context_sync_seq1_both` | I/E | `context_sync` with `seq === 1` from acceptor and from initiator after accept; `last_seq_sent >= 1` each side; `last_seq_received >= 1` for peer’s seq |
| `regression_INT_EL_ACTIVE_after_roundtrip` | I/E | Both `ACTIVE` after peer `context_sync` ingested; consistent with `getNextStateAfterInboundContextSync` (M6 defers internal until own seq sent) |
| `regression_INT_EL_transport_200_pushed_live` | E | When peer WS matches route → HTTP **200** + `[RELAY-QUEUE] push_live` (or product log equivalent) + `pushed_live` on client if surfaced |
| `regression_INT_EL_transport_202_drain` | E | If **202** (device/timing) → no stuck row: `coordination_capsules.acknowledged_at` or pushed + `[RELAY-QUEUE] delivered_queued` / `[CLIENT-QUEUE-PULL] result` with eventual delivery |
| `regression_INT_EL_relay_internal_device_routing` | E | Registry row has distinct `initiator_device_id` / `acceptor_device_id`; capsule `sender_device_id` / `receiver_device_id` guards match `server.ts` same-principal branch |

**Setup (Flow 1)**

- Two Electron instances (or two DBs + two `SSO` identity mocks) with **same** `wrdesk_user_id`, **different** device ids.
- Register handshake on coordination with F-INT-REG.
- Accept via **main process path** (renderer `acceptHandshake` → `handshake:accept` with `device_role` / pairing fields per internal rules).

**Expected logs (illustrative substrings — assert in spy/capture)**

- `[RELAY-REG]` or `register-handshake` success for internal
- `handshake_type: 'internal'` in coordination trace lines where present (`coordinationWs` internal branch)
- No requirement for `internal_coordination_identity_complete` in **normal** tests (N/A here — internal may log internal coordination fields; assert **normal** tests elsewhere omit)

**Expected DB / rows — Electron `handshakes`**

| Field | Initiator (expect) | Acceptor (expect) |
|-------|---------------------|-------------------|
| `state` (accept phase end) | `ACCEPTED` or path toward ACTIVE per gate | `ACCEPTED` |
| `local_role` | `initiator` | `acceptor` |
| `handshake_type` | `internal` | `internal` |
| `last_seq_sent` (post context_sync) | `>= 1` | `>= 1` |
| `last_seq_received` (post peer seq=1) | `>= 1` | `>= 1` |
| `context_sync_pending` | Per product (internal defer); eventually cleared when relay routes | (mirror) |

**Expected DB — relay SQLite (`coordination_*`)** (E tier)

- `coordination_handshake_registry`: `initiator_user_id === acceptor_user_id` (same principal) + two device columns populated.
- `coordination_capsules`: for 202 case, `recipient_user_id` = that user; `recipient_device_id` matches scoped route; no orphan rows after successful drain + ACK.

---

## Flow 2 — INTERNAL + Extension accept (if supported)

*If the product does not ship extension-mediated internal accept, mark suite `describe.skip` with reference to this doc.*

| Test name | Tier | What it must prove |
|-----------|------|--------------------|
| `regression_INT_EXT_VAULT_rpc_accept_parity` | E | `VAULT_RPC` `handshake.accept` (or exact method) produces **same** `handshakes` row semantics as Flow 1 |
| `regression_INT_EXT_X25519_key_source` | E | Extension uses `getDeviceX25519PublicKey` / persisted Chrome key paths — still **internal** preflight: no “normal-only wire b64” mistake |
| `regression_INT_EXT_context_sync_ACTIVE_parity` | E | After accept, `context_sync` + ACTIVE matches Flow 1 |

**Setup (Flow 2)**

- `apps/extension-chromium` background + `handshakeRpc.ts` in test harness (or E2E driver).
- Same F-INT-REG + F-SSO-I but session delivered through extension’s RPC bridge.

**Expected logs**

- VAULT_RPC response success
- Parity: same internal trace tags as Flow 1 on coordination WS when both exercise relay

**Code areas in addition to Flow 1**

- `extension-chromium/.../handshakeRpc.ts` (`inferCounterpartyDeviceRole`, ML-KEM paths)
- Chrome message port → Electron side that **must** end in same `ipc` handlers

---

## Flow 3 — NORMAL cross-principal + Electron app accept

| Test name | Tier | What it must prove |
|-----------|------|--------------------|
| `regression_NORM_EL_accept_persists_roles_types` | I/E | Initiate persisted; accept → `ACCEPTED`; `local_role` correct; `handshake_type` **null** or `standard` / **not** `internal` per DB policy |
| `regression_NORM_EL_X25519_required_wire` | U/I | **Without** F-X25519-NORMAL → `ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED` (align `preflightLikeHandleHandshakeAccept` + real `ipc`) |
| `regression_NORM_EL_X25519_no_ephemeral_mint` | I | With wire key, assert agreement path does **not** generate **new** X25519 keypair to satisfy “normal” (R5 in matrix comments) — spy `crypto` only where stable |
| `regression_NORM_EL_context_sync_seq1_both` | I/E | Same seq / seq counters as spec |
| `regression_NORM_EL_ACTIVE_both` | I/E | `ACTIVE` when both have sent and received seq 1 (M7) |
| `regression_NORM_EL_transport_200` | E | `POST /beap/capsule` → **200**, `[RELAY-QUEUE] push_live`, `coordinationRelayDelivery: pushed_live` |
| `regression_NORM_EL_transport_202_drain` | E | **202** + `queued_recipient_offline` → after reconnect or `flush-queued` / register flush, **no** row stuck; acceptor not stuck in `ACCEPTED` with `last_seq_sent >= 1` and **no** `last_seq_received >= 1` for peer after drain **timeout** |
| `regression_NORM_EL_relay_routes_by_receiver_wrdesk_user_id` | E | `coordination_handshake_registry` / `getRecipientForSender` → `acceptor_user_id` is **B**’s `wrdesk_user_id`; capsule never addressed to wrong user |
| `regression_NORM_EL_no_internal_routing_fields` | E | **Normal** `register-handshake` body **without** `internal_routing_key`; post succeeds; 403/INTERNAL routing errors must not appear |
| `regression_NORM_EL_no_internal_coordination_identity_complete` | E | Session **without** `internal_coordination_identity_complete` (if that field exists) still completes (normal) |
| `regression_NORM_EL_initiator_acceptor_ids_not_swapped` | E | In relay registry + capsule rows: initiator/acceptor user ids **match** registration order; never inverted |
| `regression_NORM_EL_receiverIdentity_quirks_ignored` | I/E | F-RECV-QUIRK: display “receiver” metadata wrong — routing still by canonical ids |

**Setup (Flow 3)**

- Two distinct `wrdesk_user_id` (F-SSO-I vs F-SSO-A); F-NORM-REG; accept with F-X25519-NORMAL in renderer.
- **Failure row:** F-NO-X25519 must yield `ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED` (assert in IPC return).

**Expected logs**

- `ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED` when preflight fails
- 200: `[RELAY-QUEUE] push_live` + `[P2P] Coordination delivery OK (live push)` (or current string)
- 202: `[RELAY-QUEUE] stored_offline` + `[P2P] Coordination: relay stored…` (peer not yet ingested) + later `[RELAY-QUEUE] drain_attempt` / `[RELAY-QUEUE] delivered_queued` / `[CLIENT-QUEUE-PULL] result`

**Expected DB — `handshakes`**

| Field | Normal (both sides) |
|-------|----------------------|
| `handshake_type` | `null` or non-`internal` per schema (document actual enum in assertion) |
| `local_role` | `initiator` / `acceptor` (never swapped) |

**Relay**

- `coordination_handshake_registry.initiator_user_id` ≠ `acceptor_user_id` (cross-principal)

---

## Flow 4 — NORMAL cross-principal + Extension accept

| Test name | Tier | What it must prove |
|-----------|------|--------------------|
| `regression_NORM_EXT_parity_Electron_normal` | E | Flow 3 invariants, but accept initiated from extension `acceptHandshake` / RPC |
| `regression_NORM_EXT_X25519_wire` | E | Wire X25519 present for normal; same error as Flow 3 when missing |

**Setup**

- Extension harness + same F-NORM-REG; bridge to Electron; optional headless with mocked `chrome.runtime`.

**Code areas**

- `extension-chromium/.../handshakeRpc.ts` (accept path) + any `AcceptHandshakeModal` parity (renderer may still call `@ext` / alias)

---

## Cross-cutting failure invariants (must fail the run)

| ID | Condition |
|----|-----------|
| X1 | `ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED` **not** returned when normal accept missing wire X25519 |
| X2 | Relay returns **202** and, after **bounded** time + reconnect + register + `flush-queued`, **coordinated** row still `acknowledged_at IS NULL` and capsule not applied → **fail** (stuck queue) |
| X3 | Acceptor: `state === 'ACCEPTED'`, `last_seq_sent >= 1`, and `last_seq_received < 1` (no peer `context_sync`) **after** X2 recovery window → **fail** (stuck `ACCEPTED`) |

**Bounded time example:** 30s test timeout with explicit `flush-queued` + WS reconnect sequence.

---

## Suggested test file layout (no logic yet)

| File (suggested) | Contents |
|------------------|----------|
| `__tests__/handshakeCrossSurface.regression.todo.test.ts` | `describe` blocks + `it.todo('regression_…')` for every name above |
| `__tests__/handshakeRefactorRegression.matrix.test.ts` | Keep/extend U-tier preflights (already M1–M7) — link from todo file |
| `packages/coordination-service/__tests__/coordination.test.ts` | E-tier relay: add suite tag `@cross-surface` for 200/202/drain (already has CS_02, CS_03, CS_28–30 pattern) |
| `electron/__tests__/` or `src/shims/__tests__/` | Extension + renderer shim parity (existing `handshakeRpc.acceptX25519.shim.regression.test.ts`) |

---

## Traceability: matrix row → code

| Your acceptance criterion | Assert in (test) | Primary code ref |
|----------------------------|------------------|------------------|
| Normal needs wire X25519; ERR otherwise | NORM F-X25519 / U preflight + I IPC | `ipc.ts` + `main.ts` `handshake:accept` |
| Internal skips normal wire preflight | INT / U M1, M4 | `ipc.ts` with `record.handshake_type` |
| ACTIVE gate (seq) | M6/M7 + E | `getNextStateAfterInboundContextSync` import in matrix tests; **E** uses real transitions |
| 200 vs 202 | NORM/INT E | `server.ts` capsule handler; `p2pTransport.ts` |
| Queue must drain | NORM/INT E | `wsManager.ts`, `server.ts` flush, `coordinationFlushQueued.ts` |
| Normal routes by `wrdesk_user_id` | NORM E | `handshakeRegistry.getRecipientForSender`, `server.ts` |
| Internal routes by device | INT E | same-principal branch `server.ts` + registry columns |
| No swapped ids | NORM/INT E | registry INSERT + capsule `recipient_user_id` |

**Review cadence:** any PR touching `ipc.ts` `handleHandshakeRPC`, `coordinationWs.ts` internal block, or `p2pTransport.ts` coordination branch must run **at least** U-tier matrix + one E-tier cross-principal **202 drain** test before merge when coordination changes.
