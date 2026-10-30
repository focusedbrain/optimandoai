# WR Handshake Refactor — Findings Report (input for the refactor prompt)

Purpose: condensed, self-contained synthesis of the 2026-07-24 gap analysis, written so a focused refactor prompt can be generated from it. Detail lives in the sibling files (`gap-matrix.md`, `code-inventory.md`, `migration-and-risk.md`, `refactor-plan-proposal.md`, `open-questions.md`); this report is the decision-oriented summary. Where a choice is needed and the spec author hasn't ruled, a **recommended default** is stated and marked as overridable.

---

## 1. Target in one paragraph

One mechanism — the **WR Handshake** — covers Public, Internal, and Cross-Device as admission-situation labels, never as separate protocols or code paths [XII.4, VII.4.6, X.3.1]. It has a frozen signed core (profile, parties, ingress_path, declarations/extensions containers, created_at, nonce, signature list) [VII.3.1]; all evolution flows through data-driven registries with fail-closed dispatch [VII.4.1–4.2]. Formation happens only through three capture methods (scan, manual entry, assisted capture) feeding one pipeline [IX.3.1]. Grants confer delivery and preparation rights only — never execution [VII.10.1]; revocation is unilateral, immediate, silent [VII.10.7.2]. Every counterparty is exactly one of three governance classes (Public Handshake / Internal Handshake / External Service Admission) [X.3.1] with per-direction capability sets [X.3.2]. Evidence is append-only and hash-chained (PoAC for grant lifecycle, PoAE with Intent Hash for executions, Boundary Event Records for crossings) [IX.19, X.10]. The handshake object must become hash-stable and versioned so the future LBCP can pin it [XI.LB§6].

## 2. Current state in one page

The implementation is a **BEAP capsule state machine**, not a profile-driven handshake:

- **Record:** one mutable ~60-field `HandshakeRecord` (`electron/main/handshake/types.ts:342-450`) mixing identity, policy, seq/hash chain state, P2P tokens, Ed25519/X25519/ML-KEM key material (including private keys), and internal-routing fields. Discriminator: `handshake_type: 'internal' | 'standard'` — a hardcoded enum branched on throughout.
- **Wire:** capsules (`initiate/accept/refresh/revoke/context_sync`) hashed via sorted-JSON over a fixed **subset** of fields (`capsuleHash.ts`); Ed25519 signs the 32-byte hash, leaving scopes, policy, tier signals, keys, and routing outside the signed bytes. Inbound capsules are rebuilt through an allowlist that **strips unknown fields** (`canonicalRebuild.ts`). Keys are per-handshake TOFU, not SSO-attested.
- **Formation:** at least four dialects — initiator persist (explicitly bypasses the receive pipeline), `.beap` file-import persist, the inbound 24-step pipeline, and a separate edge-agent pairing protocol. Inbound email/relay/WS initiate capsules **auto-create `PENDING_REVIEW` rows from message content** with no capture event (Accept is the consent gate). No scan or assisted capture exists; "manual entry" is a 6-digit pairing code (internal only), not the WR Code grammar.
- **Rights:** flattened into `effective_policy` + one-bit `sharing_mode`; a process-global `GRANTED_TOOLS` set authorizes **tool execution** under an ACTIVE handshake. Capsules are scope-filtered pre-persist, but BEAP inbox messages are admitted on a vault check only (no per-relationship delivery-right filter before visibility).
- **Revocation:** unilateral and immediate locally, but **sends a revoke capsule to the peer** and deletes context blocks/embeddings (severs history, not just rights).
- **Identity:** SSO is required on all production formation paths (good), but guards are widely partial: wrdesk-id-only ownership, OR-logic `sessionMatchesParty`, sub-only relay ack binding with issuer dropped.
- **Governance:** only Host↔Sandbox is a ledger relationship. Client↔relay is OIDC infrastructure; local Ollama is ambient; email providers and cloud model APIs are **ambient config + stored credentials** — no admission artifacts, no per-direction ceilings, no per-invocation authorization. Post-pairing, topology auto-wires and Host-AI remote inference **defaults to allow**.
- **Evidence:** `audit_log` is unchained and deleted with the handshake; ingestion audit is purged by retention; no PoAC anywhere; PoAE only as extension-embedded package JSON; **no consent surface hashes what the user saw**.
- **Persistence:** vault DB + `handshake-ledger.db` share the same 72-migration schema; the ledger is documented "hashes only" but actually receives everything, including private-key columns.

## 3. The eight violations (fix-or-nothing items)

| # | Violation | Where | What right looks like |
|---|---|---|---|
| V1 | Per-path formation dialects; semantic branching on `handshake_type`; file import force-sets `internal` | `initiatorPersist.ts:4-10`, `recipientPersist.ts`, `ipc.ts:809-871, 853-860`, `steps/internalRoutingCapsule.ts` | One formation pipeline; admission situation = profile-registry parameter; ingress path = log-only metadata [VII.4.6, IX.3.1] |
| V2 | Relationship rows created directly from message content (email/relay/WS initiate → `PENDING_REVIEW`, no capture event) | `enforcement.ts:745-829`, `email/beapSync.ts:82-104` | Invitations inert until a capture/Connect-offer + consent event; failed verification suppresses the offer entirely [IX.3.1 rules 1–4] |
| V3 | Unknown wire fields silently stripped (allowlist rebuild); no criticality concept | `canonicalRebuild.ts:163-179, 580-595` | Extensions container: preserve unknown non-critical; visible refusal naming the namespace for unknown critical; never strip/reorder [VII.3.4–3.5] |
| V4 | Execution authority grantable (`GRANTED_TOOLS` + `executeToolRequest` run under ACTIVE handshake, no per-tap consent/PoAE) | `enforcement/authorizeToolInvocation.ts:52-59`, `execution/executeToolRequest.ts:71-80` | No execute grant variant exists; every execution is a distinct human consent tap producing a PoAE record [VII.10.1, VII.2.6] |
| V5 | Revocation notifies the counterparty (signed revoke capsule enqueued) | `revocation.ts:108-170` | Unilateral, immediate, **silent**; enforcement is the receiver-side ingress filter, transmissions die pre-visibility [VII.10.7.2] |
| V6 | Partial identity guards (wrdesk-only ownership; OR-logic `sessionMatchesParty`; sub-only coordination ack; issuer dropped in relay identity) | `steps/ownership.ts:10-16`, `handshakeAccountIsolation.ts:15-28`, `coordination-service/auth.ts:109-123`, `server.ts:1240-1248` | One full-claim identity guard everywhere on ingest/ack/return paths [VII.3.10] — the resolved cross-SSO `beap_ingest_ack` defect class still lives at these sites |
| V7 | Non-admitted external services reachable as authorized targets (email/cloud via ambient config + credentials) | `aiProviders.ts:519-590`, `llmStream.ts`, `email/gateway.ts:370-434` | External Service Admission: signed, versioned, per-direction ceilings; non-admitted service unreachable; per-invocation authorization [X.3.1, X.3.3] |
| V8 | Edge-agent runs its own pairing dialect (`edge_ingestor` records outside the ledger) | `apps/edge-agent/dist/pairingProtocol.js` | Device classes governance-identical; fold into the one mechanism or retire [XI.3-I9] |

## 4. The structural gaps (MISSING machinery the refactor introduces)

Ordered by dependency, not severity:

1. **Canonical serialization + full-coverage signing** — one canonicalization module; signature over the complete canonical core (minus sig field), domain-separation tag; today's subset-hash signing leaves most of the wire unsigned [VII.6.1.3, cf. XII.5].
2. **Frozen signed core** — profile id+version, initiator/responder, `ingress_path` (registry-backed, log-only), declarations container, extensions container, created_at, nonce, ordered detached signature list [VII.3.1–3.2]. Private keys move out of relationship rows into a key store.
3. **Profile registry with fail-closed dispatch** — four initial records (`pbeap_publisher`, `private_personal`, `org_internal`, `org_cross`) plus a **legacy profile** for migrated rows; unknown profile/version → visible refusal [VII.4.1–4.2].
4. **Three capture methods + capture provenance** — capture-method enum feeding the one pipeline; provenance (method + source ref) as a signed contract field shown in the consent preview [IX.3.1 rule 5]; invitation classes (`public_bearer` implemented, `targeted_bound` reserved-only).
5. **Hash-Pinned Consent** — every consent record binds preview hash + bound-definition hash + contract-state hash; previews client-generated and canonically hashable at presentation time (this is also the Intent Hash substrate) [IX.3.4, IX.19.2].
6. **Grant objects** — delivery rights and preparation rights as distinct receiver-enforced objects; receiver admission filter as the first ingress stage for **all** deliveries including BEAP inbox; grant-ref provenance on delivered items; unlimited-until-revoke ground state (already conformant) [VII.10.x, VII.2.7].
7. **Append-only hash-chained evidence** — new parallel chain (never retrofit `audit_log`): PoAC on formation/grant lifecycle, PoAE with Intent Hash on executions, Boundary Event Records on crossings; monotonic per-contract sequence + prev-record digest (Verification Tier L, Annex IX sense) [IX.19.1, X.10.1].
8. **Governance-class registry + ESA + directional sets** — every counterparty typed into exactly one class; External Service Admission artifacts for email/cloud (grandfather-propose existing accounts); one shared per-direction capability-set schema, undeclared direction = empty set = deviation; capability-set admission replaces topology auto-wire and Host-AI default-allow [X.3.1–3.3, X.5].
9. **Cross-device binding challenge** — fresh nonce/epoch single-use challenge exchange replaces retype-equality; pairing code stays identifier+invitation, never authority [XI.LB§3, XI.3-I1].
10. **Hash-stable versioned handshake store** — immutable core + separate runtime-state container keyed by handshake hash; this is the seam the future LBCP pins (currently foreclosed by in-place mutation) [XI.LB§6, §2.2].

## 5. Forward-compatibility seams (leave open, do not build)

- **Capability token fields (lands now):** the new grant/capability token schema must define optional `context_scope` and `delegation_chain` fields and use preserve-unknown-optional parsing [XII.12.6, annex-number-provisional]. The `p2p_signal` parser (preserves unknown non-forbidden keys) is the compatible pattern; `canonicalRebuild` FIELD_RULES stripping is the anti-pattern.
- **Manifest/declaration namespace** able to carry a session-binding-key declaration later [XI.LB§2.2] — comes free with the declarations container.
- **Assessment Record Store** shaped as append-only typed records (new verification mechanisms = new record types, never schema migrations) [IX.3.5].
- **Reserved names — register, never implement:** `targeted_bound`, Credential Attachment envelope, `wr_ad`, `optirando.grant.single_use`/`.ttl` (parse-level criticality only), bridge resolution beyond empty-registry gap behavior.

## 6. What is already correct — do not regress

1. No hyperlink/deep-link/push formation anywhere (deep links only select UI state).
2. No auto-accept control exists (delete the dead `skipConsentForAutomation` schema field).
3. Unlimited-until-revoke ground state for active trust (migration v52); re-handshake reanimates nothing.
4. No key/authority transfer between devices; per-device X25519 refuses overwrite; weak Ed25519 keys rejected.
5. SSO gate on all production formation paths.
6. No profile conversion/upgrade path exists.
7. Reserved names all unimplemented.
8. Workspace invariants: coordination relay carries `p2p_signal` only (no inference bodies); `assertRecordForServiceRpc` stays internal+ACTIVE+same-principal+identity-complete (may only get stricter); metadata-only logs on inference/signaling paths; sandbox egress deny-by-default allowlist and INV-2 credential isolation.

## 7. Hard constraints for the implementation

- **Preserved stores:** vault DB + `handshake-ledger.db` (shared 72-migration chain, WAL), orchestrator DB (x25519 device keys), `email-accounts.json`, `orchestrator-mode.json`. Existing relationships must survive as **legacy-profile core records** (backfill, never fabricate signatures/provenance — use `unknown_legacy` markers).
- **Core store split is a versioned parallel store**, not in-place ALTER: the current record cannot be made byte-stable retroactively. New tables (append-only core + runtime state); old `handshakes` read-only during transition.
- **Wire compatibility:** version-gate the new canonical form (schema_version bump); v≤2 capsules verify under legacy rules and are marked legacy in evidence. Dual-format emission until peer-version detection, or an explicit compatibility cutover.
- **Ordering dependencies:** receiver-side ingress filter **before** removing the revoke-notify capsule (V5); Connect-offer/capture flow **before** making inbound invitations inert (V2); per-tap consent + PoAE flow lands **with** the removal of execution grants (V4), never before.
- **Evidence chain starts fresh** with a genesis record; never claim chain continuity for pre-cutover mutable audit rows (claims discipline [X.0.1]).
- **Ledger schema bleed:** stop applying full handshake migrations to `handshake-ledger.db` until its target role is decided (Q10); sweep any key material written through that handle first.

## 8. Decision points (recommended defaults, overridable)

| Q | Question | Recommended default |
|---|---|---|
| Q1 | Does a pending row from an inbound invitation count as "establishing"? | Treat pending rows as forbidden formation; inbound invitations live in a separate **Connect-offer staging store** (not the relationship store) until capture+consent. |
| Q2 | Mapping existing rows to initial profiles | Introduce a registered `legacy_v0` profile that blesses historical signature discipline; legacy rows stay operational but frozen for *new* grant types; no forced re-establishment. |
| Q3 | Countersign the byte-identical core vs its hash | Sign the canonical-form hash **with a domain-separation tag** binding it to the core type+version; both signatures cover the same referenced bytes. |
| Q4 | `ingress_path` mapping for existing transports | email-borne initiate → `beap_invitation`; coordination-WS/relay-pull → `relay_code_claim`; `.beap` file import → new registered identifier (e.g. `optirando.ingress.file_import`); legacy rows → null. |
| Q5 | Is the 6-digit pairing code a conforming manual-entry token? | Interim yes, as `optirando_code_entry` for the Internal/Cross-Device situation; migrate to WR Code grammar when codes ship. |
| Q6 | BEAP-invitation-as-route [VII.4.6] vs three-capture-methods [IX.3.1] | Capsule-by-email remains a legitimate *invitation transport* for non-Public profiles but always terminates in the Connect-offer + consent gate; Public formation requires capture. |
| Q7 | May pending handshakes time out? | Yes — no-expiry applies to granted rights, not unconsented requests; keep the 7-day pending timeout. |
| Q8 | Revocation history semantics | Evidence records + digests persist always; content deletion becomes a separate explicit operator action (satisfies both [VII.10.7.3] and local-deletion needs). |
| Q9 | Governance placement of same-user device pairing | Internal Handshake profile; "Cross-Device" is its UI admission-situation label, with the challenge-exchange formation parameters from XI.LB§3. |
| Q10 | Role of `handshake-ledger.db` | Make it the append-only evidence/receipt store (Tier L chain home); vault DB holds contract + runtime state; migrate key material out. |
| Q11 | ESA cutover for existing email/cloud accounts | Grandfather-propose: existing accounts keep working under a transition flag while proposed admissions await explicit user consent; flag removed after one release cycle. |
| Q12 | Mixed-realm rows under full-claim guards | Full-claim enforcement for new state; existing mixed-realm rows flagged for repair UX rather than silently invalidated. |
| Q13 | Capability-token carrier for CC fields | Net-new token schema in the grant phase; carriage + preserve-unknown parsing only; no delegation validation until CC ships. |
| Q14 | Unattended internal admission under signed policy | Permitted as a C0-class signed-policy event ("propose, never silently apply" satisfied by the policy admission itself); per-device taps not required for fleet admission. |

## 9. Suggested phase structure for the refactor prompt

1. **Hygiene & guards** — full-claim identity guard everywhere; receiver-side ingress filter; delete dead paths (`skipConsentForAutomation`, unused verifier, no-op version step). No schema changes.
2. **Canonical core** — canonicalization module, frozen core record, extensions/declarations containers with criticality, signature list, key extraction, generic high-water anti-rollback store. Version-gated wire.
3. **Profile registry** — data-driven records (4 + legacy), fail-closed dispatch, parallel core store + backfill, hash-stability property tests.
4. **One formation pipeline** — capture-method enum, Connect-offer staging, capture provenance in contract, Hash-Pinned Consent records, silent revocation completed, edge-agent fold-in, `handshake_type` branches eliminated.
5. **Grants & evidence** — delivery/preparation right objects, execution grants deleted (per-tap consent + PoAE with Intent Hash), PoAC writers, hash-chained evidence store, capability-token schema with `context_scope`/`delegation_chain`.
6. **Governance classes** — class registry, ESA artifacts with grandfather-propose, directional capability sets, Boundary Event Records, signed policies with anti-rollback, cross-device challenge binding.

Each phase's acceptance tests are enumerated in `refactor-plan-proposal.md` (drawn from the extracts' section-K criteria); the highest-value early assertions are: unknown-critical-extension refusal naming the namespace, unknown-profile refusal, no-formation-outside-capture, revocation-produces-no-peer-signal, no-execution-without-consent-tap, and rollback-rejection on the high-water store.

## 10. Sizing signal

The refactor is a re-architecture of the formation/rights/evidence layers, not a rewrite of the app: context exchange, search/embeddings, transport (relay/P2P/email), vault, and inbox machinery survive largely intact behind the new gates. The riskiest work is the core-store migration (both DBs share the migration chain) and the wire-format version gate; both have explicit strategies in `migration-and-risk.md`.
