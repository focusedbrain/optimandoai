# Scoping: Headless handshake acceptor for Edge Agent

Read-only estimate for collapsing Agent pairing onto the sandbox/coordination handshake model.  
Reference: [`agent-pairing-vs-sso-handshake-analysis.md`](./agent-pairing-vs-sso-handshake-analysis.md).

**Decisive outputs:** §6 (headless-acceptance trust model), §7 (effort + ordering recommendation).

---

## 1. How the sandbox/extension acceptor works today

The “acceptor” is not a single module. It is **Electron main** (`handleHandshakeRPC` in `electron/main/handshake/ipc.ts`) plus **coordination relay + WebSocket**, **SQLite handshake ledger**, and **ingestion → handshake pipeline** (`processIncomingInput` → `processHandshakeCapsule` in `enforcement.ts`). The extension is a **UI + RPC client**; the sandbox device is whichever machine runs Electron with `orchestrator-mode.json` and an open coordination WS.

### 1.1 Initiation side (device A → device B)

| Step | Where | What happens |
|------|--------|----------------|
| 1 | `orchestratorModeStore.ts` | Each device has persistent `instanceId` (UUID), `deviceName`, `mode` (`host` \| `sandbox`), and a **6-digit `pairingCode`**. Code is generated with `generatePairingCode()` and registered server-side via `setPairingCodeRegistrar` (wired in `electron/main.ts` ~11392–11432). |
| 2 | `POST /api/coordination/register-pairing-code` | Body: `{ user_id, instance_id, pairing_code, device_name }`, JWT `sub` must equal `user_id`. Implemented in `packages/coordination-service/src/server.ts` and `pairingCodeRegistry.ts`. |
| 3 | UI (`SendHandshakeDelivery.tsx`, extension) | User enters **counterparty’s** 6-digit code (not UUID). Renderer sends `handshake.initiate` with `handshake_type: 'internal'`, `device_role`, `device_name`, `counterparty_pairing_code`. |
| 4 | `handshake.initiate` (`ipc.ts` ~1264+) | `requireSession()` — initiator must be SSO-signed-in. Builds BEAP **initiate capsule** via `buildInitiateCapsuleWithContent` (`capsuleBuilder.ts`) with `internalReceiverPairingCode` embedded as `receiver_pairing_code` on the wire. |
| 5 | Relay registration | `registerHandshakeWithRelay` (`relaySync.ts`) with `initiator_device_id` = `getInstanceId()`, and `acceptor_device_id` when known (tests pass `counterparty_device_id` explicitly; production UI often passes **only** the pairing code). |
| 6 | Relay push (internal only today) | If `handshake_type === 'internal'` and coordination enabled, `enqueueOutboundCapsule` + `processOutboundQueue` POST to `{coordination_url}/beap/capsule` (`ipc.ts` ~1510–1547). **Note:** `ipc.ts` has **no** `edge_ingestor` branch for this relay push yet. |
| 7 | Wire shape (initiate) | `internalRelayOutboundGuards.ts`: for `capsule_type: 'initiate'`, envelope needs `handshake_type`, `sender_device_id`, `sender_device_role`, `sender_computer_name`, and **`receiver_pairing_code`** (not `receiver_device_id`). |

**Where the code comes from:** Generated on the **acceptor device**, stored in `orchestrator-mode.json`, registered in `coordination_pairing_codes`. The **initiator** only types the code; resolution to `instance_id` is intended to happen in Electron main (comments reference `resolvePairingCodeViaCoordination`; the named helper is **not present** in the tree — only comments in `ipc.ts` / `main.ts`). Initiate relay tests supply `counterparty_device_id` directly (`ipc.internal.relayPush.test.ts`).

### 1.2 Acceptor side (device B receives initiation)

| Step | Where | What happens |
|------|--------|----------------|
| 1 | **Push, not poll** | Recipient must maintain a **coordination WebSocket** (`coordinationWs.ts`). URL includes `device_id={instanceId}` (~761). |
| 2 | `wsManager.ts` (coordination service) | Routes capsules to connected clients matching `userId` + `device_id`. Offline capsules stored (HTTP 202) and flushed on connect / `register-handshake` / `POST /beap/flush-queued`. |
| 3 | `coordinationWs.ts` ~327 | Inbound capsule → `processIncomingInput(..., 'coordination_ws')` → distribution `handshake_pipeline`. |
| 4 | Handshake pipeline | Initiate capsule creates/updates ledger row in **PENDING** (`buildInitiateRecord` in `enforcement.ts`). Acceptor does **not** auto-accept. |
| 5 | User notification | Extension `HandshakeManagementPanel` / Electron UI lists pending handshakes; user opens **Accept** flow. |
| 6 | `handshake.accept` (`ipc.ts` ~1807+) | **Interactive:** for `handshake_type === 'internal'`, acceptor must supply `device_name`, `device_role`, and **`local_pairing_code_typed`** matching capsule’s `internal_peer_pairing_code` and this device’s own code (`ipc.ts` ~1956–2000; `AcceptHandshakeModal.tsx` ~209–239). |
| 7 | SSO binding on accept | `validateReceiverEmail` — acceptor session email must match capsule receiver (`ipc.ts` ~1849). Initiator/acceptor same account for internal. |
| 8 | Crypto | Device-bound X25519 for internal (`strictInternalX25519` on initiate; accept uses `ensureKeyAgreementKeys`). Accept capsule built and sent back via relay/direct P2P. |
| 9 | Active state | Record → `ACTIVE`; P2P tokens, endpoints on row; subsequent traffic uses relay guards (`internalRelayOutboundGuards.ts`) and/or direct HTTP to `p2p_endpoint`. |

### 1.3 Coordination registry role

Two tables (coordination service, `store.ts`):

- **`coordination_pairing_codes`:** maps `(user_id, pairing_code)` → `instance_id` + `device_name`. Used so initiator can target a device without knowing UUID.
- **`coordination_handshake_registry`:** maps `handshake_id` → initiator/acceptor `user_id`, emails, **`initiator_device_id` / `acceptor_device_id`**, roles. Used to route relay POSTs and WS push.

Pairing codes are **scoped per SSO account**; cross-user resolution returns 404 (by design).

### 1.4 Identity binding

| Mechanism | When |
|-----------|------|
| SSO | Initiator and acceptor each `requireSession()` at initiate/accept; same email/`sub` for internal. |
| Pairing code | Capsule carries `receiver_pairing_code`; acceptor types **own** code to prove physical presence on intended device (`ipc.ts` comments: deliberate UX). |
| Device IDs | `instanceId` in orchestrator mode; relay initiate/accept envelopes use `sender_device_id` / `receiver_device_id` (except initiate uses code-only on wire per client guards). |
| X25519 | BEAP key agreement material in capsule/record — separate from PR4 pairing Ed25519 keys. |

### 1.5 Channel after handshake

- Ledger row: `p2p_endpoint`, `local_p2p_auth_token`, `counterparty_p2p_token`, keys (`handshake/types.ts`, `db.ts`).
- Traffic: coordination relay (`/beap/capsule`) and/or direct POST to peer’s ingestion/P2P URL (`p2pTransport.ts`).
- **Agent today:** uses **different** channel — UUID bearer tokens from HTTPS `/pair/*` (`CREDENTIAL_RELAY_PROTOCOL.md`), not BEAP handshake accept output.

---

## 2. Extension vs sandbox — differences; headless?

| Aspect | Extension (Chromium) | Sandbox / host (Electron) |
|--------|----------------------|---------------------------|
| Registry | Same coordination APIs via `electronRpc` / vault RPC to **local** Electron main | `register-pairing-code` from `main.ts` registrar |
| Initiate UI | `SendHandshakeDelivery.tsx` — user types peer code | Same component or Electron `HandshakeInitiateModal` |
| Accept UI | Pending list → typically Electron `AcceptHandshakeModal` for desktop flows | `AcceptHandshakeModal.tsx` — **requires typing 6-digit code** for internal |
| Headless accept? | **No** | **No** |

**Critical finding:** **Neither path is headless at accept time.** Both assume a user confirms acceptance; internal handshakes additionally require the acceptor to **type this device’s pairing code** (`AcceptHandshakeModal.tsx`, `ipc.ts` ~1960–1961). The Agent on a VPS has no one at the keyboard for that step.

**Closest model for Agent:** Electron main’s **machine** accept path (coordination WS + `handshake.accept` IPC), with **automated** `local_pairing_code_typed` = stored local code (replacing the modal). The extension does not add a second accept mechanism — it delegates to Electron.

---

## 3. What the Agent already has (reusable)

| Capability | Location | Reuse for acceptor |
|------------|----------|-------------------|
| SSO + `sub` | `apps/edge-agent/src/sso/`, `@repo/sso` | Yes — same-user check vs initiator |
| P2P HTTP listener | `agentApiServer.ts`, `config.p2pPort` (51249) | **Partial** — today only `/agent/*` + BEAP ingest; **not** coordination WS |
| Encrypted state | `storage.ts` | Yes — extend for `instanceId`, pairing code, handshake row |
| `edge_ingestor` type | `edgeIngestorHandshake.ts`, PR4.5 | Yes — target ledger shape |
| Attestation | SSO `requestEdgeAttestation` path in orchestrator `completeAgentPairing.ts` | Yes — after handshake active + pod identity |
| Role policy / pod / logs | PR3/5/7 | Unchanged |

**Not present on Agent (gaps):**

- No `orchestrator-mode.json` equivalent / `instanceId`
- No `register-pairing-code` client
- No coordination WebSocket client
- No SQLite / `handleHandshakeRPC` / `processHandshakeCapsule`
- No `handshake.initiate` / `handshake.accept` implementation

**Rough reuse ratio:** ~15% of acceptor stack exists (SSO, P2P port, types); **~85% is new or port**.

---

## 4. Gap — concrete work items (Agent acceptor)

| # | Work item | New vs modify | Size (order of magnitude) | Dependencies | Risk |
|---|-----------|---------------|---------------------------|--------------|------|
| A | **Agent device identity store** — `instanceId`, `deviceName`, `device_role: edge_agent`, pairing code generation/regeneration | New module (~150–250 LOC), mirror `orchestratorModeStore.ts` | 1 file + tests | `@repo/sso` token for register | Low — copy pattern from `main.ts` registrar |
| B | **Register pairing code** with coordination on SSO sign-in / refresh | New (~80 LOC) + retry loop | `packages/coordination-service` API (exists) | Low |
| C | **Setup UI** — show registry code (replace Agent RAM-only `:8443` code in `setupState.ts`) | Modify setup UI + state | Small | A, B | Low |
| D | **Coordination WebSocket client** on Agent — port core of `coordinationWs.ts` (connect, reconnect, OIDC, `device_id` query, ack) | New (~400–800 LOC) | `ws`, token refresh, network egress to coordination URL | Medium — ops + firewall |
| E | **Handshake ledger on Agent** — `better-sqlite3` + subset of `migrateHandshakeTables` / `getHandshakeRecord`, **or** new minimal encrypted JSON ledger (design fork) | New (large if full SQLite; ~300–600 LOC if minimal) | D | High if full port of `enforcement.ts` deps |
| F | **Inbound initiate handling** — receive initiate capsule from WS, validate `receiver_pairing_code` + initiator identity, persist PENDING | New (~200–400 LOC) | E, D | Medium |
| G | **Headless auto-accept** — invoke accept logic without UI: build accept capsule, set roles `host`/`edge_agent`, `local_pairing_code_typed` = local code, default sharing mode | New (~300–500 LOC) + policy | F; port slices of `ipc.ts` `handshake.accept` | **High / novel** (§6) |
| H | **Map handshake row → Agent paired state** — P2P tokens, encryption pubkey, `p2p_endpoint` for PR6/7 (replace `pairRecord` from `/pair/*`) | Modify `pairingConfirm.ts` / storage model | Medium | G | Medium |
| I | **Orchestrator: `handshake.initiate` for `edge_ingestor`** — relay push, resolve code → `instance_id`, register acceptor device | Modify `ipc.ts`, wizard | `GET /api/coordination/resolve-pairing-code` (exists) | Medium — **ipc today only relays `internal`** |
| J | **Orchestrator wizard** — replace `orchestratorPairing.ts` / `:8443` with initiate + pending/accept poll or notification | Modify wizard, remove pairing TLS | I | Medium |
| K | **Delete pairing protocol** — `:8443`, `PAIRING_PROTOCOL.md`, etc. | Delete | Small | A–J done | Low |

**Copy vs novel:** A–C and K are mostly copy. D–F are port/adapt. **G is novel** (no production auto-accept). I–J are orchestrator changes, not Agent-only.

---

## 5. Coordination-service side

| Question | Finding |
|----------|---------|
| In repo? | **Yes** — `packages/coordination-service/` |
| `edge_ingestor` on relay? | **Partially.** `server.ts` ~752 allows `handshake_type` `internal` **or** `edge_ingestor` on relay POST `initiate`. `internalRelayOutboundGuards.ts` on client also validates `edge_ingestor`. |
| Pairing registry role-aware? | **No** — registry stores `instance_id` + `device_name` only; **no** `device_role` column. Role lives in BEAP capsule / handshake ledger. |
| Agent registration | Uses same `register-pairing-code` as host/sandbox; **no schema change required** for basic registration. |
| Blast radius | Changes to initiate routing affect **all** same-principal devices. Any server change needs regression on `packages/coordination-service/__tests__/pairing-code.test.ts` and `ipc.internal.relayPush.test.ts`. |

**Potential inconsistency to resolve during implementation (not blocking scoping):** Client initiate guards (`internalRelayOutboundGuards.ts`) require only `receiver_pairing_code` on initiate envelopes; server initiate guard (`server.ts` ~768–813) still requires **`receiver_device_id`** on the POST body. Tests pass `counterparty_device_id` at initiate time. A full Agent flow must either resolve code → `instance_id` before POST (orchestrator-side `resolve-pairing-code`) or extend the server to align with the pairing-code-only initiate model.

**Deploy story:** Coordination service is a separate deploy from Agent; server changes ship on relay deployment schedule.

---

## 6. Headless-acceptance trust model (product decision)

### What happens today (interactive)

Acceptance is gated by:

1. Valid SSO session on acceptor (`requireSession`).
2. Receiver email match (`validateReceiverEmail`).
3. User types **this device’s** 6-digit code (`local_pairing_code_typed` vs `internal_peer_pairing_code`).
4. Device role / name validation for internal endpoints.

The typed code is explicitly **“confirm you’re on the right device”** (`ipc.ts` ~1960–1961), not a secret unknown to an attacker.

### Proposed headless rule (for Agent)

When an **initiate** capsule arrives over coordination WS:

**Auto-accept if and only if:**

- Agent is SSO-signed-in (`phase` pre-paired / setup complete).
- `handshake_type` on wire is `edge_ingestor` (or internal with host↔edge_agent roles).
- `receiver_pairing_code` on capsule equals Agent’s registered local pairing code.
- Initiator `sub` / email matches Agent’s SSO (`sub` / email on capsule vs `storage.ssoSub`).
- Role pair is `host` (initiator) ↔ `edge_agent` (acceptor) per `isAllowedEdgeIngestorRolePair`.
- Optional: initiator `sender_device_id` resolves via registry to same account (if present on wire).

**No** separate fingerprint or `:8443` ceremony.

### Security reasoning (for yes/no)

| Threat | Assessment |
|--------|------------|
| Attacker with victim’s SSO token initiates to victim’s Agent | Attacker already **is** the user for practical purposes (same Keycloak `sub`). They could also complete interactive accept with typed code if they know it (displayed on setup UI / logs). **Not a new trust class** vs interactive accept if code is visible on VPS. |
| Attacker without SSO, network only | Cannot pass `sub`/email checks on accept; relay requires authenticated initiator registration. |
| MITM on coordination relay | Same as existing sandbox internal — relies on TLS to coordination + BEAP crypto; no PR4 fingerprint. |
| Wrong VPS (user typo on initiate) | Mitigated by **orchestrator** typing correct peer code when initiating (same as sandbox). Agent does not pick initiator. |
| Stolen pairing code alone | Insufficient without SSO on both sides for initiate + accept. |

### Out-of-band confirmation?

**Not required** for parity with automated operation on an unattended server, **if** product accepts that SSO + registry code + BEAP keys are the same trust bar as host↔sandbox internal pairing **without** fingerprint.

**If** product wants **extra** assurance beyond sandbox, options (each adds scope): one-time setup token, operator approval in orchestrator only (initiator still human), or retain fingerprint (keeps PR4-like ceremony).

**Recommendation for product owner:** Headless auto-accept under the rule above is **defensible and aligned with internal handshake trust**, with the explicit caveat that **sandbox is not headless today** — this is a **policy relaxation** for Agent only, not a literal copy of existing UX.

---

## 7. Effort estimate and ordering recommendation

### Summary table

| Workstream | Estimate (engineer-days) | Risk |
|------------|-------------------------|------|
| A–C Agent identity + registry + UI | 3–5 | Low |
| D Coordination WS on Agent | 5–8 | Medium |
| E Handshake ledger on Agent | 8–12 | High |
| F Inbound initiate | 3–5 | Medium |
| G Headless auto-accept | 8–12 | **High (novel)** |
| H Map to PR6/7 paired state | 3–5 | Medium |
| I–J Orchestrator initiate + wizard | 8–12 | Medium |
| K Remove pairing protocol | 2–3 | Low |
| Coordination server alignment (if needed) | 2–5 | Medium |
| Integration tests + manual VPS matrix | 5–8 | — |

**Total:** roughly **45–70 engineer-days** (~**9–14 weeks** one engineer, or **4–7 weeks** with two engineers on Agent vs orchestrator tracks).

This is **not** “a few days to copy the sandbox acceptor.” The sandbox acceptor **is** the Electron handshake + ingestion stack; the Agent has none of that.

### What is *not* small

- Porting or reimplementing `processHandshakeCapsule` / `handshake.accept` without Electron vault/UI deps.
- Headless acceptance policy (novel).
- Wiring `edge_ingestor` relay initiate on orchestrator (`ipc.ts` currently gates relay push to `internal` only).
- End-to-end regression across coordination + Agent + wizard.

### Recommendation (specific)

**Test the current implementation first (pairing protocol + PR8 wizard); simplify after you have a known-good baseline.**

**Because:**

1. **Acceptor work is multi-week**, not days — mis-ordering would burn intensive E2E days on flows you plan to delete.
2. **Headless accept is a novel policy**, not a copy — needs explicit product sign-off (§6) and security review while E2E on current stack proceeds.
3. **Orchestrator `edge_ingestor` relay initiate is not fully wired** in `ipc.ts` today — simplification is not “Agent-only.”
4. Current pairing path **works** for first VPS E2E (per baseline plan); acceptor collapse is a **second project** with clear deliverables above.

**Caveat to “simplify first”:** If product has **already** decided headless + registry is mandatory before **any** customer VPS testing, invert: run a **time-boxed spike (1–2 weeks)** on A+B+D+F only (WS receive + manual accept via temporary operator script) before full G/H/I/J — still not full removal of `:8443` until G/H prove PR6/7 fields.

---

## 8. Simplified end-state (after acceptor + removal)

### User flow

1. `curl | sudo bash` installs Agent; SSO on `http://127.0.0.1:8090` (setup UI stays; **pairing code + fingerprint screens go**).
2. Agent registers **coordination pairing code** (shown on setup UI, same XXX-XXX style as Settings → Orchestrator mode on desktop).
3. On orchestrator: “Add verification server” — user enters peer’s 6-digit code (or picks from list later), same as adding an internal sandbox device.
4. Orchestrator runs `handshake.initiate` with `handshake_type: edge_ingestor`; relay delivers initiate to Agent WS; Agent **auto-accepts** when §6 rules pass.
5. Wizard verify step (synthetic round-trip, attestation) unchanged in intent.
6. **No `:8443`**, no `PAIRING_PROTOCOL.md` ceremony.

### Code architecture

| Remove / shrink | Add / keep |
|-----------------|------------|
| `pairingProtocol.ts`, `pairingServer.ts`, `pairingTls.ts`, `orchestratorPairing.ts`, wizard pair TLS step, `PAIRING_PROTOCOL.md` | `agent/coordinationWs.ts` (new) |
| Agent RAM pairing code in `setupState.ts` | `agent/deviceIdentity.ts` + registry client (new) |
| `completeAgentPairing` pair-initiate result path | `agent/handshakeAcceptor.ts` headless (new) |
| | SQLite or minimal ledger on Agent |
| | `handshake.initiate` / accept via relay for `edge_ingestor` on orchestrator |
| | PR6/7 unchanged in principle; tokens/keys sourced from handshake row |

---

## Appendix: Key file index

| Role | Paths |
|------|--------|
| Initiate IPC | `electron/main/handshake/ipc.ts` (`handshake.initiate`) |
| Accept IPC | `electron/main/handshake/ipc.ts` (`handshake.accept`) |
| Capsule build | `electron/main/handshake/capsuleBuilder.ts` |
| Relay guards | `electron/main/handshake/internalRelayOutboundGuards.ts` |
| WS client | `electron/main/p2p/coordinationWs.ts` |
| Pairing registry | `packages/coordination-service/src/pairingCodeRegistry.ts`, `server.ts` |
| Mode / code | `electron/main/orchestrator/orchestratorModeStore.ts`, `main.ts` registrar |
| Extension initiate UI | `extension-chromium/.../SendHandshakeDelivery.tsx` |
| Electron accept UI | `electron-vite-project/src/components/AcceptHandshakeModal.tsx` |
| Agent P2P today | `apps/edge-agent/src/agentApiServer.ts`, `agent-api.ts` |
| Agent pairing today | `apps/edge-agent/src/pairingProtocol.ts`, `orchestratorPairing.ts` |

---

*End of scoping — timing decision is §7; trust decision is §6.*
