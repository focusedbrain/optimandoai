# Analysis: Why does Agent pairing duplicate what SSO + handshake already provides?

Read-only reconstruction for product-owner decision (keep pairing protocol / collapse to SSO + handshake / partial simplify).  
**Branch reviewed:** `phase-1/pod-becomes-hot-path` (commits through `cc6a513b` / `build059`).  
**No refactor proposed here.**

---

## 1. The product owner's stated concept

### Earliest explicit architecture direction (pre–Stream C implementation)

From the **hardened-pod + minimal-edge-agent** analysis prompt ([agent transcript](a2cf377c-fdd3-4638-9625-1c91a8e336c9), user message ~line 346):

> **Paid tier**: replace the SSH-based edge ingestor wizard with a small standalone **"Edge Agent"** application installed on the user's VPS. The Agent has its own SSO login UI, **performs an internal handshake (reusing existing handshake + P2P code from the orchestrator)**, and pulls email itself. The orchestrator stores no SSH credentials.

Section 5 of that same prompt asked to document handshake/P2P reusability so the Agent could participate as a new role peer — not to invent a parallel HTTPS pairing stack.

### Stream C design prompt (what engineering was told to build)

From **Stream C — Edge Agent** ([transcript](a2cf377c-fdd3-4638-9625-1c91a8e336c9), ~line 455), opening deliverable:

> The deliverable: a small Node-based service called the **Edge Agent**, installed on a user's Linux VPS with a single command, that replaces the current SSH-based wizard for paid-tier edge deployment. The Agent handles **SSO login locally**, **pairs with the user's orchestrator over P2P**, manages its own Podman pod … No SSH keys are stored in the orchestrator.

Background inversion:

> instead of the orchestrator reaching out to the VPS via SSH, a small service on the VPS handles its own deployment and **pairs with the orchestrator via the existing handshake + P2P infrastructure** that the rest of the system already uses.

`docs/STREAM_C_STATUS.md` (landed C1–C3) then scheduled **C4** as: *"Full SSO on Agent + pairing protocol + fingerprint confirm"* — already naming a dedicated pairing protocol, not "reuse handshake.initiate only."

### Stream C § C4 — pairing described *inside* handshake language (later narrowed)

Still in the Stream C prompt, **C4 "Pairing protocol — what actually happens on the wire"** says:

1. User enters the 6-digit code in the orchestrator. **Orchestrator initiates a handshake to the Agent** (address from user or deep link).
2. The handshake includes both sides' **SSO `sub`**, edge identity public keys, and the 6-digit code. Both sides verify SSO `sub` matches.
3. On mutual confirmation, the pair record is persisted.

And explicitly:

> The 6-digit code is **not a security mechanism on its own** — it's a usability mechanism … The actual security comes from the **fingerprint confirmation**, the matching SSO `sub`, and the user confirming on both sides.

Success criteria (end of Stream C prompt):

> the boundary … is enforced by **SSO-bound identity, mutual fingerprint confirmation, an authenticated P2P channel**, and a least-privilege role separation.

### PR4 kickoff — divergence from "handshake on the wire"

**PR4 kickoff** ([transcript](a2cf377c-fdd3-4638-9625-1c91a8e336c9), ~line 470) required, before code:

- `apps/edge-agent/PAIRING_PROTOCOL.md` as source of truth.
- **Dedicated HTTPS pairing on `:8443`** (option 1), explicitly rejecting option 2 ("HTTP over a P2P tunnel using the existing P2P transport") because *"the orchestrator doesn't yet know the Agent's identity."*
- Constraint: **"The fingerprint check is the security mechanism. The 6-digit code is UX scaffolding."**

### What was *not* found in-repo

- No commit message or design doc stating: *"We considered `handshake.initiate` with `handshake_type: edge_ingestor` for Agent bootstrap and rejected it."*
- `docs/PR4.5-step0-findings.md` only records that PR4 left the orchestrator without a ledger row until PR8; it does not compare to sandbox `handshake.initiate`.

**Summary for §1:** The product owner's earliest one-liner was **SSO + internal handshake + P2P reuse**. Stream C preserved SSO + P2P but **specified** 6-digit code + fingerprint and, in C4, described pairing as handshake-shaped. PR4 **codified a separate HTTPS pairing protocol** and elevated fingerprint over the Stream C C4 wording on the code's role. PR4.5 then made `edge_ingestor` the **ledger type produced by pairing completion**, not the transport used to establish trust.

---

## 2. What the implemented pairing protocol actually does

**Source of truth:** `apps/edge-agent/PAIRING_PROTOCOL.md`  
**Agent:** `pairingProtocol.ts`, `pairingConfirm.ts`, `setupState.ts`, `pairingServer.ts`, `pairingKeys.ts`, `fingerprint.ts`, `setup-ui/`, `setupServer.ts`  
**Orchestrator:** `electron/main/edge-agent/orchestratorPairing.ts`, `pairingFingerprint.ts`, `pairingKeysOrchestrator.ts`, `completeAgentPairing.ts`, `persistEdgeIngestorHandshake.ts`, wizard `StepPairVerificationServer.tsx`, `pairingSession.ts`

### End-to-end sequence (orchestrator user → persisted handshake row)

| Step | Actor | Action |
|------|--------|--------|
| 0 | Agent | Phase `unpaired`; user SSO on `:8090` (`sso/session.ts`, `@repo/sso`). Agent shows 6-digit code (`setupState.ts` `ensurePairingCode`, 10 min TTL, memory-only). X25519 encryption key + `agent_p2p_auth_token` created at SSO (per `CREDENTIAL_RELAY_PROTOCOL.md`). |
| 1 | User | Enters VPS address (`https://host:8443`) + code in orchestrator wizard (`orchestratorPairing.ts`, `parsePairingLink.ts`). |
| 2 | Orchestrator | `POST /pair/initiate` to Agent `:8443` with `pairing_code`, `orchestrator_sub`, fresh Ed25519 `orchestrator_public_key`, `orchestrator_nonce`. TLS via self-signed cert; `rejectUnauthorized: false` in `orchestratorPairing.ts`. |
| 3 | Agent | Validates code (match, not expired/consumed), **`orchestrator_sub === agent SSO sub`** (`setupState.ts` ~129–131), key format; consumes code; creates in-memory session + fresh Agent Ed25519 pairing keys + fingerprint (`pairingProtocol.ts` → `setup.initiatePairing`). |
| 4 | Agent → Orchestrator | `200` with `session_id`, `agent_public_key`, `agent_nonce`, `fingerprint`, `agent_encryption_public_key_b64`, `p2p_endpoint`, `agent_p2p_auth_token`. |
| 5 | Orchestrator | Recomputes fingerprint; **rejects if ≠ response** (`orchestratorPairing.ts` ~202–214). Shows fingerprint to user. |
| 6 | Both | User confirms on Agent setup UI (`POST /setup/pair/confirm` → `party: agent_ui`) and orchestrator (`POST /pair/confirm` → `party: orchestrator` + `orchestrator_p2p_auth_token`). |
| 7 | Agent | When both flags set, `applyPairingConfirmation` (`pairingConfirm.ts`) writes encrypted `pairRecord` (`handshake_type: edge_ingestor`, pairing Ed25519 keys, fingerprint, P2P tokens, encryption pubkey), phase → `paired`, starts pod path. |
| 8 | Orchestrator | `completeAgentPairing.ts`: `persistEdgeIngestorHandshake` → SQLite handshake row; `upsertEdgeReplica` with `handshake_id`; polls `GET /agent/edge/status` over P2P bearer; `requestSsoAttestation` for edge cert binding. |

**Post-pair steady-state auth:** `agent-api.ts` `verifyAgentApiAccess` — Bearer `orchestrator_p2p_auth_token` + `pairRecord.handshake_type === edge_ingestor` + roles `host` ↔ `edge_agent`. **Pairing Ed25519 keys are not used for `/agent/*` auth after pair** (grep shows ongoing use of tokens + role-pair, not pairing key signatures).

### Element-by-element: purpose and overlap with SSO + handshake

#### 6-digit code

- **Documented role:** scoping / anti–cross-pair when multiple setups in flight (`PAIRING_PROTOCOL.md`; PR4 "UX scaffolding").
- **Implementation:** Agent-local memory (`setupState.ts`); not the coordination-service registry used for sandbox internal handshakes.
- **If removed:** Orchestrator would need another way to select the correct Agent during bootstrap (user-typed address only works for **single** Agent; multi-VPS future needs names, registry, or server-issued ID).
- **Overlap:** Same *idea* as sandbox `receiver_pairing_code` in `handshake.initiate` (`ipc.ts` ~1301–1330) + `packages/coordination-service/src/pairingCodeRegistry.ts`, but **different storage and wire** (BEAP capsule vs HTTPS JSON).
- **Single-Agent today:** Scoping value is **low**; address + SSO sub may suffice.

#### Mutual fingerprint (`aaaa-bbbb-cccc-dddd`)

- **Documented role:** human verification; PR4 calls it **the** security mechanism for pairing TLS.
- **Computation:** SHA-256 of `orchestrator_public_key || agent_public_key || orchestrator_nonce || agent_nonce` (`PAIRING_PROTOCOL.md`, `fingerprint.ts`, `pairingFingerprint.ts`).
- **If only SSO `sub` match:** Would not bind the **ephemeral pairing keys** returned over self-signed HTTPS to what the user sees; MITM on first contact could swap keys in the JSON body unless fingerprint is checked (orchestrator already recomputes on initiate response).
- **Overlap with BEAP handshake crypto:** Sandbox internal flow binds **device X25519** in the initiate capsule and policy/accept paths; it does **not** use this 16-hex fingerprint format. Different ceremony.
- **Usability vs crypto:** Even if SSO + relay OIDC prove same user, fingerprint still answers: *"the keys I'm about to trust are the ones on the VPS I think I'm pairing with."*

#### Fresh pairing Ed25519 keypairs

- **Documented role:** scope reduction vs long-term device identity (PR4 kickoff "Why a fresh key").
- **Persisted:** In Agent `pairRecord` and orchestrator handshake `counterparty_public_key` / pairing fields (`edgeIngestorHandshake.ts`, `persistEdgeIngestorHandshake.ts`).
- **Steady-state:** P2P uses **UUID bearer tokens** (`orchestrator_p2p_auth_token`, `agent_p2p_auth_token`), not signatures with pairing keys (`CREDENTIAL_RELAY_PROTOCOL.md`, `agent-api.ts`).
- **Sandbox comparison:** Internal handshakes use **stable device-bound X25519** (`ipc.ts` `strictInternalX25519`, `deviceKeyStore` per `docs/silent-handshake-analysis.md`).
- **Assessment:** Pairing keys are partly **audit / fingerprint inputs** post-pair; scope-reduction argument is **partially realized** because application auth moved to bearer tokens.

#### SSO `sub` matching

- **Where:** `POST /pair/initiate` body `orchestrator_sub` vs Agent signed-in sub (`setupState.ts`); error `sub_mismatch` (`PAIRING_PROTOCOL.md`).
- **Sufficient alone?** Proves same Keycloak user **if both sides are honestly SSO-authenticated** and the initiate request is authentic. It does **not** alone prove the HTTPS peer is *your* VPS (stolen token + wrong host) without address trust + fingerprint or cert pinning.
- **Relation to handshake:** `isSameUserHandshake` (`packages/shared/src/handshake/handshakeType.ts`) treats `edge_ingestor` like `internal` for same-principal rules **after** the row exists — not as a substitute for bootstrap.

#### `/pair/*` on `:8443` vs P2P

- **Why it exists:** PR4 explicit choice — bootstrap before P2P trust material exists (`PAIRING_PROTOCOL.md` ports table; PR4 kickoff option 1).
- **Delivers:** encryption pubkey, `p2p_endpoint`, bearer tokens **before** orchestrator can call `http://host:51249/agent/*`.
- **Alternative:** Run `handshake.initiate` with `handshake_type: edge_ingestor` over coordination relay once both sides have SSO WS + pairing-code registry — **not implemented** for Agent.

---

## 3. What SSO + handshake provide on their own

### SSO on the Agent (`@repo/sso`, `apps/edge-agent/src/sso/`)

- Proves: user completed OIDC against Keycloak (`wrdesk-edge-agent` client, redirect `http://127.0.0.1:8090/sso-callback` per `PAIRING_PROTOCOL.md`).
- Persists: access/refresh tokens, `sub`, email in encrypted Agent state.
- Enables: `exchangeForAudience` / edge attestation (`completeAgentPairing.ts` → `requestSsoAttestation`) binding pod id + edge public key to JWT audience `beap-edge-attestation`.
- **Does not:** tell the orchestrator which VPS, open firewall ports, or create the SQLite handshake row by itself.

### `edge_ingestor` handshake type (PR4.5+)

- **Type:** `packages/shared/src/handshake/handshakeType.ts` — distinct from `internal` (sandbox) and `standard`.
- **Roles:** `host` ↔ `edge_agent` only (`internalEndpointValidation.ts` `isAllowedEdgeIngestorRolePair`).
- **Ledger row:** P2P endpoint, tokens, `peer_x25519_public_key_b64` (credential relay), signing keys for BEAP (`persistEdgeIngestorHandshake.ts`).
- **Relay guards:** Same-principal validation as `internal` for outbound relay (`docs/edge-ingestor-type-audit.md`, `internalRelayOutboundGuards.ts`).
- **Created today by:** pairing completion, **not** by `handshake.initiate` from the extension UI (extension `SendHandshakeDelivery` remains sandbox-`internal` per audit table).

### Sandbox-internal handshakes (prior art)

| Aspect | Sandbox `handshake_type: internal` | Agent `edge_ingestor` today |
|--------|-----------------------------------|-----------------------------|
| SSO | `requireSession()` on initiate/accept (`ipc.ts` ~1337+) | SSO on both sides before pairing |
| 6-digit code | Yes — `receiver_pairing_code` in capsule; coordination registry resolves to `instance_id` (commit `0e1f3202`, `pairingCodeRegistry.ts`) | Yes — **separate** Agent-local code on `:8443` |
| Fingerprint ceremony | No PR4-style 16-hex pairing fingerprint; BEAP signing/device keys | Mandatory dual UI confirm + `PAIRING_PROTOCOL` fingerprint |
| Transport | BEAP capsule + email/API/relay; P2P after accept | HTTPS `/pair/*` first, then `:51249` P2P |
| Mutual confirm | Accept handshake in UI (typed pairing code on acceptor) | `/pair/confirm` + `/setup/pair/confirm` |
| Identity keys | Device-bound X25519 in capsule | Ephemeral pairing Ed25519 + bearer tokens |

**Could sandbox pattern be used for Agent?**

- **Plausible:** Orchestrator already has pairing-code registry and `handshake.initiate` with `handshake_type` parameter (preload still documents `internal` | `standard`; server-side allows `edge_ingestor` per coordination tests).
- **Gaps vs today:** Agent has no handshake DB or `handshake.initiate` handler; no extension/renderer path for `edge_ingestor` initiate; bootstrap still needs **reachable address** for first contact (sandbox assumes both devices already on coordination relay with OIDC).
- **Why it differs:** Agent is headless, no extension; first contact is often WAN to `:8443`, not pre-registered relay device_id until pairing completes.

---

## 4. The reasoning trail: how the parallel mechanism got there

| Stage | What was decided | Evidence |
|-------|------------------|----------|
| Architecture revision | Agent = SSO + **internal handshake reuse** + P2P | Transcript hardened-pod prompt (~346) |
| Stream C planning | Reuse handshake/P2P; still add pairing UX (code + fingerprint) | Transcript Stream C (~455), C4 text |
| C3 skeleton | Placeholder 6-digit code in setup UI | `docs/STREAM_C_STATUS.md` C3 |
| PR4 | **Protocol doc first**; HTTPS :8443; fingerprint = security; code = scaffolding; reject P2P-for-pairing | Transcript PR4 kickoff (~470); `PAIRING_PROTOCOL.md` |
| PR4.5 | `edge_ingestor` type on pair record; not sandbox `internal` | `edgeIngestorHandshake.ts`, `docs/PR4.5-step0-findings.md`, db migration v70 comment in `db.ts` |
| PR6–PR8 | Pair record carries encryption key + P2P tokens; wizard calls `orchestratorPairing.ts` | `CREDENTIAL_RELAY_PROTOCOL.md`, `completeAgentPairing.ts`, commit `6a00a7a8` |
| Sandbox parallel | 6-digit codes added to **internal** handshakes via coordination registry (`0e1f3202`) | Independent track; similar UX, different stack |

**Was "SSO + handshake only" considered for Agent?**

- **In Stream C C4:** Described as handshake-initiated with code + fingerprint inside the handshake — **not** the same as "SSO only," but **closer** than PR4 HTTPS.
- **In PR4:** Explicitly chose dedicated HTTPS and ranked fingerprint above code; **did not** document handshake-initiate alternative.
- **Acknowledged divergence:** Stream C success text still says "authenticated P2P channel"; implementation adds a **pre-P2P** channel — reasonable engineering fix for cold start, but it **widened** scope beyond the one-liner "reuse internal handshake."

**Likely mechanism of drift:** Conventional device-pairing pattern (TLS + short code + confirm fingerprint) was applied to a greenfield VPS bootstrap problem, while sandbox pairing evolved **inside** BEAP + coordination registry. The two "6-digit code" systems were **never unified**.

---

## 5. What the pairing protocol adds beyond SSO + handshake (element verdict)

Labels: **keep** = evidence supports unique value; **simplify** = largely overlaps, could fold into existing stack; **remove** = little independent value in current single-Agent design; **unclear** = needs product call.

| Element | Verdict | Evidence |
|---------|---------|----------|
| **6-digit code (Agent-local)** | **simplify** (today) / **keep** (multi-Agent future) | Low value with one Agent; overlaps conceptually with coordination pairing codes but not wired together. Stream C + PR4 agree it's not primary security. |
| **Mutual fingerprint (PR4 format)** | **keep** for HTTPS bootstrap / **simplify** if bootstrap transport changes | Real value binding ephemeral keys over self-signed TLS (`orchestratorPairing.ts` recomputation). Not redundant with SSO `sub` alone on unknown host. Less critical if trust moves to relay + OIDC + BEAP keys only. |
| **Fresh pairing Ed25519 keys** | **simplify** | Steady-state auth uses bearer tokens; keys mainly fingerprint + ledger metadata. Sandbox uses device-bound keys instead. |
| **HTTPS `/pair/initiate` + `/pair/confirm`** | **keep** (as pragmatic bootstrap) / **simplify** if replaced by `handshake.initiate` + relay | Solves cold-start before P2P tokens exist. PR4 rejected P2P-for-pairing; alternative path was in Stream C text but not built. |
| **SSO `sub` match on initiate** | **keep** | Necessary same-user check; also required in any handshake-shaped design. |
| **`edge_ingestor` row as pairing output** | **keep** | Needed for role policy, relay guards, credential relay, mode resolver — independent of *how* pairing is performed. |

**Net:** The **ledger type and P2P bearer model** are not bloat; the **separate HTTPS pairing ceremony** duplicates *themes* already present in SSO + coordination pairing codes + BEAP handshake, with extra fingerprint + ephemeral keys + dual confirm.

---

## 6. What removing the pairing protocol would entail (inventory only)

### Likely deleted or heavily reduced

| Area | Paths |
|------|--------|
| Protocol doc | `apps/edge-agent/PAIRING_PROTOCOL.md` |
| Agent pairing HTTP | `pairingProtocol.ts`, `pairingConfirm.ts`, `pairingServer.ts`, `pairingTls.ts`, `pairingKeys.ts`, `fingerprint.ts`, `pairingCode.ts` (if code scoped only to HTTPS pair) |
| Orchestrator client | `orchestratorPairing.ts`, `pairingFingerprint.ts`, `pairingKeysOrchestrator.ts`, `parsePairingLink.ts` (if only `wrdesk-pair://`) |
| Wizard pairing session | `wizard/pairingSession.ts`, `StepPairVerificationServer.tsx`, related IPC |
| Tests | `pairingHarness.test.ts`, `orchestratorPairing.integration.test.ts`, `parsePairingLink.test.ts`, parts of `stateMachine.test.ts` |

### Would change (not delete)

| Area | Change |
|------|--------|
| Wizard step | Replace code+fingerprint with "verification server signed in" + maybe orchestrator-initiated `handshake.initiate` (`edge_ingestor`) |
| Agent setup UI | Remove code display / fingerprint confirm screens (`setup-ui/`, `setupState.ts` pairing phases) |
| `completeAgentPairing.ts` | New trigger: handshake accept completion instead of `pairInitiate` result |
| `persistEdgeIngestorHandshake.ts` | Populated from handshake capsule fields instead of `/pair/initiate` JSON |
| Agent `main.ts` / servers | Remove `:8443` listener; possibly keep `:8090` SSO only until paired |
| `CREDENTIAL_RELAY_PROTOCOL.md` | Rewrite bootstrap section for how tokens/encryption pubkey are first exchanged |
| Firewall/install docs | Drop `:8443` requirement if pairing moves to relay-only |

### User-level flow (hypothetical collapse)

1. Install Agent on VPS; SSO on `:8090`.
2. Orchestrator: user enters server identity (hostname, deep link, or coordination pairing code registered by Agent).
3. Orchestrator runs existing **handshake.initiate** with `handshake_type: edge_ingestor`, same `sub`, roles host/edge_agent.
4. Agent-side acceptor (new headless handler or minimal UI) accepts; ledger row + P2P tokens created as today.
5. Wizard verify step unchanged (synthetic round-trip, attestation).

### Edge cases pairing handles today that must be re-covered

- **WAN address discovery** — user still types `https://vps:8443` or link; no magic SSO-only discovery.
- **Self-signed TLS MITM on first hop** — fingerprint + orchestrator-side recompute; collapse must replace with relay OIDC + BEAP or cert pinning strategy.
- **Pre-P2P credential fields** — `agent_encryption_public_key_b64`, bearer tokens currently on initiate response; handshake capsule must carry equivalents.
- **Multi-Agent** — coordination pairing registry already scopes by `user_id`; Agent would need to register its code server-side (like sandbox host), not only in RAM.
- **Agent restart during setup** — code regeneration behavior must be re-specified.

---

## 7. What removing the pairing protocol would NOT change

- **Agent service core:** systemd, encrypted storage, pod manager/supervisor, role-policy deny-send, quarantine pickup, image digest (`apps/edge-agent/src/pod-manager.ts`, `pod-supervisor.ts`, etc.).
- **`@repo/sso`:** shared PKCE, refresh, attestation (`packages/sso/`).
- **`edge_ingestor` type and enforcement:** `handshakeType.ts`, `internalEndpointValidation.ts`, relay guards, `agent-api.ts` role-pair checks (might change *how the row is created*, not the type).
- **PR6 credential relay envelope:** X25519 wrap to Agent encryption key — pattern stays; first-key delivery path may change.
- **PR7 log streaming:** `log-stream/*`, orchestrator `agentLogReceiver.ts`, UI panels.
- **Pod manifests / Stream A hardening / Stream B role policy:** `packages/beap-pod/`, orchestrator gateway enforcement.
- **Mode resolver / hold queue / edge-tier settings shape:** `deployment_type: 'agent'`, `handshake_id` on replica.
- **SSH deprecation track (PR9):** orthogonal.

---

## 8. Risk analysis: surprises if simplifying

| Risk | Detail |
|------|--------|
| **Encryption key provenance** | `agent_encryption_public_key_b64` is issued on `/pair/initiate` today (`CREDENTIAL_RELAY_PROTOCOL.md`). Handshake-initiate must expose the same key with equal trust. |
| **Bearer token genesis** | `orchestrator_p2p_auth_token` / `agent_p2p_auth_token` are exchanged in pairing confirm/initiate, not via BEAP today. A collapsed design must define token minting on accept. |
| **Pairing Ed25519 keys in ledger** | `counterparty_public_key` stores agent pairing pubkey; downstream may assume it exists for audit — grep before delete. |
| **Two pairing-code systems** | Removing Agent RAM codes without migrating to coordination registry recreates confusion with sandbox Settings codes. |
| **Firewall / install** | `install.sh`, docs, and VPS guides that open **8443** must be updated. |
| **Test harness** | `pairingHarness.test.ts`, PR4 verification docs, mock orchestrator curls in `PR4_VERIFICATION.md`. |
| **PR8 migration** | `agentReplicaStopgapMigration.ts` backfills handshake rows from legacy replica fields shaped by pairing outputs. |
| **Wizard state machine** | `stateMachine.ts` `pair_verification_server` step and IPC surface (`6a00a7a8`). |
| **User docs / copy** | All "verification server" pairing strings in wizard copy and setup UI. |
| **Attestation ordering** | `completeAgentPairing.ts` polls `/agent/edge/status` after row persist; ordering may differ if handshake is slower/faster than HTTPS pair. |
| **Headless acceptor** | Sandbox accept uses extension/Electron UI; Agent has no BEAP accept UI yet — **new work** for collapse, not a delete-only project. |

---

## 9. Open questions for the product owner

1. **Is same SSO `sub` on both sides sufficient** for identity binding if channel security is handled by coordination relay (OIDC WS) + BEAP handshake keys, without PR4 fingerprint on self-signed HTTPS?

2. **Multi-VPS future:** Should disambiguation use coordination pairing codes (already built for sandbox), server names, user-picked list, or keep Agent-local codes?

3. **Fingerprint UX:** Is visual fingerprint confirmation still desired for user confidence ("this is my VPS") even if cryptographically redundant with a proper handshake accept path?

4. **Timing:** Simplify **after** E2E validation of the current stack (per baseline testing plan), or schedule simplification in parallel and risk two moving targets?

5. **Bootstrap transport:** Is a one-time public HTTPS port (`:8443`) acceptable long-term, or is relay-only pairing a hard requirement for locked-down VPS firewalls?

6. **Unify pairing codes:** Should Agent register its 6-digit code with `coordination_pairing_codes` (same as orchestrator Settings) instead of a second mechanism?

---

## Appendix: Key commits and files

| Item | Reference |
|------|-----------|
| Stream C foundation + Agent pairing implementation (large) | `94f4da8d` |
| PR8 wizard UI | `6a00a7a8` |
| Sandbox 6-digit internal codes | `0e1f3202` |
| PR4.5 findings | `docs/PR4.5-step0-findings.md` |
| edge_ingestor audit | `docs/edge-ingestor-type-audit.md` |
| Agent transcript (Stream C, PR4, product intent) | [a2cf377c-fdd3-4638-9625-1c91a8e336c9](a2cf377c-fdd3-4638-9625-1c91a8e336c9) |

---

*End of analysis — decision input only; no implementation recommendation.*
