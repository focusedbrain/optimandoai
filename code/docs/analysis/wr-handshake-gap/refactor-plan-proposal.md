# WR Handshake Refactor — Phased Plan Proposal (Phase 4)

Six phases; each leaves the system buildable and testable. Ordering follows the Phase-3 dependency graph. For each phase: scope (finding IDs from `gap-matrix.md`), §3-invariants newly enforced (numbering from the analysis prompt §3), and the section-K acceptance tests that become runnable at its end.

The target is **one mechanism** [XII.4, annex-number-provisional; VII.4.6; X.3.1]: the WR Handshake, with Public / Internal / Cross-Device as admission-situation designations only.

---

## Phase 1 — Hygiene and guard closure (no schema changes)

**Scope:** F2 (full-claim identity guard helper; convert ownership, `sessionMatchesParty` OR-logic, coordination ack/registry, internal-inference same-principal call sites), E8 *receiver half* (receiver-enforced ingress filter kills deliveries from revoked/absent relationships pre-visibility — prerequisite for silent revocation), C14 (`skipConsentForAutomation` removal), A11/A12 decision (retire the unused verifier or designate it the future single verifier; either way stop carrying both), plus a written freeze on new `handshake_type` branches.

**Invariants newly enforced:** #5 (SSO binding gate with full identity guard, [VII.3.8]/[VII.3.10]); groundwork for #4.

**Section-K tests runnable:** [VII.3.8] no SSO → no relationship/cache/grant (assert all three); [VII.3.10]-derived: cross-issuer same-sub ack rejected at every converted call site; [VII.10.5.5] structural absence of auto-accept.

**Buildable/testable:** pure behavior tightening; existing relationships unaffected except mixed-realm edge cases (risk register; blocked rows go to open-questions.md Q3).

## Phase 2 — Canonical serialization, frozen core, containers

**Scope:** A8 (one canonicalization module: deterministic encoding, domain-separation tag, signature over complete canonical form minus signature field), A1–A5 (frozen signed core record: profile, initiator/responder, `ingress_path`, declarations container, extensions container, created_at, nonce), A6/A7 (extensions discipline: preserve unknown non-critical, visible refusal naming namespace for unknown critical, container never stripped/reordered; extension + declaration registries), A9 (ordered detached signature list, cardinality data-driven), A10 (specify the replay mechanism), G6 (key extraction to key store — do this before the store split so keys never enter the immutable core), G4 (per-object high-water version store, generic).

Wire compatibility: schema_version n+1 carries the new form; v≤2 verified under legacy rules and marked legacy in evidence (risk register: signature-scope expansion).

**Invariants newly enforced:** #2 (frozen core, [VII.3]); #3 second half (extension criticality, [VII.3.4–3.5]); #8 substrate (anti-rollback store, [IX.4.2]/[X.7.8]).

**Section-K tests runnable:** [VII.3.5] unknown non-critical extension establishes / unknown critical refuses naming the namespace; [IX.4.2]-class replay-older-signed-version rejected (for any object registered in the high-water store); canonical-form round-trip byte-identity tests.

## Phase 3 — Profile registry and fail-closed dispatch

**Scope:** B1–B4, B7 (registry records: identifier, version, mandatory/forbidden fields, permitted ingress paths, role symmetry, signature cardinality, grant vocabularies, attestation rules; four initial records [VII.4.2] **plus one legacy profile** covering migrated pre-refactor rows — Q2), B2 (unknown profile/version → visible refusal, no fallback), B6 (entitlement anchors re-based: registry-side gate + structural absence of publishing surfaces; consumer role class-independent [VII.4.12]), G1–G3 begin (versioned parallel core store `wr_handshake_core` append-only + runtime table; backfill legacy rows — migration-and-risk.md §1.1).

**Invariants newly enforced:** #3 first half (data-driven profiles, fail-closed dispatch, [VII.4.1–4.2]); #11 substrate (hash-stable versioned handshake objects — T2 foreclosure lifted).

**Section-K tests runnable:** [VII.4.2] unknown profile / unsupported version → visible refusal; profile immutability ([VII.3.3]) — mutation attempts rejected, conversion = new handshake; hash-stability: re-serialize any stored core → byte-identical, hash-stable across sessions ([XI.LB§6] property test).

## Phase 4 — Single formation pipeline, capture methods, provenance, Hash-Pinned Consent

**Scope:** C1 (collapse initiator-persist / recipient-persist / inbound dialects into one pipeline; `handshake_type` semantic reads replaced by profile-registry parameters; delete the internal-routing special-casing as a *dialect* while keeping its checks as data-driven steps), C2 (capture-method enum: scan, manual entry, assisted capture — scan/manual unconditional, assisted policy-gated; WR-Code identifier grammar admission [IX.8.6-style typed bounded token]), C3 (inbound invitations become inert until capture/Connect-offer + consent; failed verification suppresses the offer entirely — sequenced per risk register), C5 (capture provenance as signed contract field, displayed in consent preview), C7 (invitation classes: `public_bearer` implemented, `targeted_bound` registered-not-implemented), C8/C9 (identity lock at formation; Hash-Pinned Consent: consent record binds preview hash, bound-definition hash, contract-state hash; client-generated previews), C4 preserved, I3 (edge-agent dialect folded in or frozen behind a read-only transition), C6 begins (CPR typed struct produced at depackaging; ratchet-only consumption), E9 (revocation stops deleting history; deletion becomes explicit), E8 *sender half* (remove peer-notify capsule — receiver filter from Phase 1 already protects).

**Invariants newly enforced:** #1 (one mechanism, ingress-path neutrality, [VII.4.6]/[X.3.1]/[XII.4]); #6 (formation only via the three capture methods, [IX.3.1]); #7 (Hash-Pinned Consent + preview contract, [IX.3.4] — origin binding lands with the Public-profile work); #4 partially ([VII.10.7.2] silent revocation complete).

**Section-K tests runnable:** [IX.3.1 rule 2] failed verification suppresses Connect offer, no "connect anyway"; [IX.12.1] no formation path besides the three capture methods, no hyperlink forms/extends/upgrades; [VII.4.6]-derived: identical handshake request from every ingress path, `ingress_path` read by no branch (static check + behavioral test); [VII.10.7.2] revocation produces no publisher-observable signal; [IX.19.2]-precursor: consent record resolves to its hashed preview.

## Phase 5 — Grant model and evidence chain

**Scope:** E1 (delete execution-grant machinery; every execution = distinct consent tap → PoAE; no bypass API), E2 (receiver-enforced admission filter extended to all deliveries incl. BEAP inbox: off-scope blocked pre-visibility, logged, one-tap revoke offer [VII.10.2]), E3 (grant-ref provenance on delivered items [VII.10.3]), E4 skeleton (standing-action-scope object model with pinned references and separate consent screens — full effect-vocabulary registry may trail), E5/H1–H4 (append-only hash-chained per-domain evidence chain; PoAC on formation/grant lifecycle/region events; PoAE with the receipt field set incl. Intent Hash computed over the preview as presented; monotonic per-contract sequence + prev-record digest → Verification **Tier L** in the Annex IX sense), E10/T5 (limit-extension names handled at parse-level criticality only), T4 (the new capability/grant token schema defines optional `context_scope` and `delegation_chain` fields **[XII.12.6, annex-number-provisional]** and preserve-unknown-optional parsing), H5 (retention carve-outs; `deleteHandshakeRecord` stops deleting evidence).

**Invariants newly enforced:** #4 complete (no execution authority from any grant, [VII.10.1]); #12 (evidence discipline: PoAC/PoAE append-only hash-chained, [VII.10.6]/[IX.19.1]).

**Section-K tests runnable:** [VII.14.6]-class hard-fail suite (payload schema violation, constraint violation, off-scope delivery blocked pre-visibility + logged + revoke offer); [VII.10.8.3] present-but-not-understood limit extension → refusal, never unlimited; [IX.19.2] receipt whose Intent Hash doesn't resolve to the presented preview = invalid + deviation; Tier-L chain audit: removal/reorder/insertion detectable; [VII.10.7.3] revocation severs rights, history persists.

## Phase 6 — Governance classes, External Service Admission, directional sets, cross-device binding

**Scope:** D1 (governance-class registry: every counterparty exactly one of Public Handshake / Internal Handshake / External Service Admission; Internal = profile-registry admission situation, **not** a new protocol), D3/D4 (capability-set admission as hash-pinned consent/policy events; grandfathered `linked[]` re-proposed; Host-AI default-allow replaced by explicit admission; sandbox per-operation capabilities per requester class [X.5]), D5 (ESA artifact type: signed, versioned, endpoints + identity anchors + operation classes + per-direction ceilings + Invocation Assurance Class references; email/cloud onboarding migration per migration-and-risk.md §1.3), D6 (one shared per-direction capability-set schema across contracts and admissions; undeclared direction = empty set; flow without declared direction = deviation), D7 (capability grammar in front of graph/context access), D8 (Boundary Event Records sealed into the Phase-5 chain; crossing+receipt unified where the crossing is a consequence [X.10.2]), D9 (signed local policy + anti-rollback verify-before-enforce), I1/I2 (cross-device binding: fresh nonce/epoch single-use challenge exchange; code stays identifier+invitation [XI.LB§3]; binding-participant interface shared by embodiments [XI.B.2]), C10/T1 seams (assessment-record store as append-only typed store; verifier module slot; manifest namespace able to carry a session-binding-key declaration — declaration registry entry reserved, not implemented).

**Invariants newly enforced:** #9/#10 (fail-closed deviation handling at boundaries; directional capability sets with uniform grammar, [X.3.2–3.3]/[IX.6.5]); #1 completed across all component relationships; #11 seam proven (LBCP-pinnable store + binding-key namespace reserved).

**Section-K tests runnable:** [X.4]/[X.5] sandbox-inherits-nothing (zero host secrets in sandbox context; result return without ingress capability rejected + recorded; out-of-scope access unrepresentable, deviation sealed); [X.3.1] unregistered component/service unaddressable by any egress API; [X.3.3] per-invocation authorization (no session-cached authorization satisfies the next invocation); [X.7.8(1)] stale-but-signed policy → nothing enforced, failure sealed; [X.10.1] every declared-boundary crossing yields exactly one sealed BER, chain Tier-L verifiable; [XI.LB§5]-precursor replay tests (challenge/answer fails on epoch and nonce before signature checks).

---

## Deferred beyond this plan (registered, not built — per Tier 2)

LBCP issuance/heartbeat/starvation lifecycle [XI.LB§2, §4–§6]; WR Connector server/client implementations [XI.LB§3]/[VII.8.5]; Capability Diff and mobile Profile A client [VII.14.1]/[IX.13]; Site Manifest rendering, Finalizers, WR Guard, WCR, Tiers C/X; Coordination Context objects `wr.cc.*` **[annex-number-provisional]** beyond the T4 token fields; all reserved names (`targeted_bound`, Credential Attachment envelope, `wr_ad`, grant limit semantics, bridge resolution).

## Claims discipline note

Everything above describes pending objectives until its phase's acceptance tests pass; no deliverable or UI copy generated from this plan may present the properties as achieved or absolute ([X.0.1], [X.13.4]).
