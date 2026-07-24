# WR Handshake Refactor — Master Brief (v1.0, 2026-07-24)

This brief accompanies **every** phase order (files `01`–`06`). Read it in full before starting any phase. Each phase order is self-contained given this brief; do not start a phase without its predecessor's exit criteria met (§8).

## 1. Mission

Re-architect the formation, rights, and evidence layers of the WR Desk codebase into the normative **WR Handshake**: **one mechanism** covering Public, Internal, and Cross-Device as admission-situation labels — never as separate protocols or code paths [XII.4, VII.4.6, X.3.1]. This is a re-architecture of formation/rights/evidence, **not** a rewrite of the app: context exchange, search/embeddings, transport (relay/P2P/email), vault, and inbox machinery survive largely intact behind the new gates.

Authoritative inputs, in precedence order:
1. The five spec extracts (Annexes VII, IX, X, XI, XII) — requirement IDs like `[VII.4.6]` cite these.
2. `findings-report.md` (2026-07-24 gap analysis synthesis) — finding IDs `V1…V8`, structural gaps, decisions `Q1…Q14`.
3. `migration-and-risk.md` — migration strategies, dependency graph, risk register. Consult it before every schema or wire change.

Where these documents conflict with current code behavior, the documents win. Where the spec is silent and no `Q` decision covers it, stop and ask; do not resolve ambiguity silently.

## 2. Target architecture (one paragraph)

Frozen signed core (profile, initiator/responder, ingress_path, declarations container, extensions container, created_at, nonce, ordered detached signature list) [VII.3.1–3.2]; all evolution through data-driven registries with fail-closed dispatch [VII.4.1–4.2]. Formation only through capture methods feeding one pipeline with capture provenance as a signed contract field [IX.3.1]. Grants confer delivery and preparation rights only — never execution; every execution is a distinct human consent tap producing a PoAE record with Intent Hash [VII.10.1, IX.19.2]. Revocation unilateral, immediate, silent, receiver-enforced [VII.10.7.2]. Every counterparty typed into exactly one governance class (Public / Internal Handshake / External Service Admission) with per-direction capability sets [X.3.1–3.2]. Evidence append-only and hash-chained: PoAC (grant lifecycle), PoAE (executions), Boundary Event Records (crossings) [IX.19, X.10]. The handshake object becomes hash-stable and versioned so the future LBCP can pin it [XI.LB§6].

## 3. Non-negotiable invariants

A change that contradicts any of these is wrong regardless of local convenience. Cite the invariant in the phase report whenever a design decision leans on one.

1. **One mechanism.** `ingress_path` is registry-backed, log-only metadata; no branch may read it for semantic decisions [VII.4.6]. `handshake_type` branching is eliminated (Phase 4), not extended.
2. **Frozen core.** New features land in registries/containers, never as new core fields [VII.3].
3. **Fail-closed dispatch.** Unknown profile/version → visible refusal. Unknown **critical** extension → visible refusal naming the namespace. Unknown **non-critical** → preserve and ignore. Containers are never stripped, reordered, or partially processed [VII.3.4–3.5, VII.4.2]. The current allowlist-strip rebuild is the anti-pattern; the `p2p_signal` preserve-unknown parser is the compatible pattern.
4. **No execution authority from any grant, ever** [VII.10.1, VII.2.6]. No auto-accept control anywhere [VII.10.5.5].
5. **Silent revocation, receiver enforcement.** No signal to the counterparty; off-scope or revoked transmissions die pre-visibility with a logged record [VII.10.7.2, VII.2.7]. Revocation severs rights, never history [VII.10.7.3] (Q8).
6. **Full-claim identity guards** on every ingest/ack/return path; never sub-only, never OR-logic [VII.3.8–3.10].
7. **Formation only via capture + consent.** No hyperlink, deep link, push payload, navigation event, or raw message content forms, extends, or upgrades a relationship [IX.3.1]. Failed verification suppresses the Connect offer entirely — no "connect anyway".
8. **Hash-Pinned Consent.** Consent records bind preview hash + bound-definition hash + contract-state hash; previews are client-generated and canonically hashable at presentation time [IX.3.4, IX.19.2].
9. **Anti-rollback** via persisted high-water versions for every signed, versioned object class (core versions, policies, admissions) [IX.4.2, X.7.8].
10. **Deviations fail closed**: detect, block, stop, inform, record — never silent continuation [IX.6.5]. Unauthorized access is unrepresentable, not merely denied [X.4–X.5].
11. **Claims discipline**: never claim chain continuity, completeness, or security properties the construction doesn't provide [X.0.1, X.13.4]. The evidence chain starts with an explicit genesis record; pre-cutover mutable audit rows are read-only history, never "chained evidence".
12. **Codes are identifiers and invitations, never authority** [XI.3-I1, XI.LB§3].

## 4. Do-not-regress list

The following are currently conformant or are standing project invariants. Every phase keeps them green; any PR that touches their vicinity must state how it preserves them.

- Relay carries `p2p_signal` only; **no inference payloads on the coordination relay**; metadata-only logging on inference/signaling paths. Keep `internalInference.directHost.regression.test.ts` green; extend (never replace) the `relayP2pSignalHandler` forbidden-key list.
- `assertRecordForServiceRpc` stays internal + ACTIVE + same-principal + identity-complete — it may only get **stricter** (Phase 1 tightens it), never looser.
- No hyperlink/deep-link/push formation (deep links only select UI state).
- No auto-accept control (the dead `skipConsentForAutomation` schema field is deleted in Phase 1).
- Unlimited-until-revoke ground state for granted rights (migration v52); re-handshake reanimates nothing.
- No key/authority transfer between devices; per-device X25519 refuses overwrite; weak Ed25519 keys rejected.
- SSO gate on all production formation paths.
- No profile conversion/upgrade path.
- Reserved names stay unimplemented: `targeted_bound` semantics, Credential Attachment envelope, `wr_ad`, `optirando.grant.single_use`/`.ttl` beyond parse-level criticality handling, bridge resolution beyond empty-registry gap behavior.
- Sandbox egress deny-by-default allowlist and INV-2 credential isolation.

## 5. Hard constraints

- **Preserved stores** (survive every build and this refactor): vault DB + `handshake-ledger.db` (shared 72-migration chain, WAL), orchestrator DB (x25519 device keys), `email-accounts.json`, `orchestrator-mode.json`. Existing relationships must survive as legacy-profile core records — backfill, never fabricate signatures or provenance; use `unknown_legacy` markers and `ingress_path = null`.
- **Core store split is a versioned parallel store** (`wr_handshake_core` append-only + `wr_handshake_runtime`), never in-place ALTER: the current record cannot be made byte-stable retroactively. Old `handshakes` table read-only during transition.
- **Wire compatibility is version-gated**: `schema_version` bump; v≤2 capsules verify under legacy rules and are marked `legacy` in evidence; dual-format emission until peer-version detection (or an explicit, documented compatibility cutover).
- **Ordering dependencies** (hard): receiver-side ingress filter (Phase 1) **before** removing the revoke-notify capsule (Phase 4). Connect-offer/capture flow **before** making inbound invitations inert (Phase 4). Per-tap consent + PoAE flow lands **with** the removal of execution grants (Phase 5), never before.
- **All schema migrations run inside the existing migration runner** (single writer, WAL checkpoint after) — no external tooling that could leave stale `-wal` files.
- **Ledger schema bleed**: no new tables through the `handshake-ledger.db` handle until its repurposing (Phase 5, Q10); key-material sweep first (Phase 3).

## 6. Adopted decisions (Q1–Q14)

These recommended defaults from the findings report are **adopted** for this refactor unless the author overrides in writing. Implement them as stated; flag in the phase report wherever one materially shaped code.

| Q | Adopted default |
|---|---|
| Q1 | Pending rows from inbound invitations are forbidden formation. Inbound invitations live in a separate **Connect-offer staging store**, not the relationship store, until capture + consent. |
| Q2 | Registered `legacy_v0` profile blesses historical signature discipline; legacy rows stay operational but frozen for new grant types; no forced re-establishment. |
| Q3 | Countersignatures sign the canonical-form **hash** with a domain-separation tag binding it to core type + version; both signatures cover the same referenced bytes. |
| Q4 | `ingress_path` mapping: email-borne initiate → `beap_invitation`; coordination-WS/relay-pull → `relay_code_claim`; `.beap` file import → new registered `optirando.ingress.file_import`; legacy rows → `null`. |
| Q5 | 6-digit pairing code is interim-conforming manual entry as `optirando_code_entry` for Internal/Cross-Device; migrate to WR Code grammar when codes ship. |
| Q6 | Capsule-by-email remains a legitimate invitation **transport** for non-Public profiles but always terminates in the Connect-offer + consent gate; Public formation requires capture. |
| Q7 | Pending (unconsented) requests may time out; keep the 7-day pending timeout. No-expiry applies to granted rights only. |
| Q8 | Evidence records + digests persist through revocation always; content deletion becomes a separate explicit operator action. |
| Q9 | Same-user device pairing = Internal Handshake profile; "Cross-Device" is its UI admission-situation label with XI.LB§3 challenge-exchange formation parameters. |
| Q10 | `handshake-ledger.db` becomes the append-only evidence/receipt store (Tier-L chain home); vault DB holds contract + runtime state; key material migrated out. |
| Q11 | ESA cutover is grandfather-propose: existing email/cloud accounts keep working under a transition flag while proposed admissions await explicit consent; flag removed after one release cycle. |
| Q12 | Full-claim guards enforce on new state; existing mixed-realm rows are flagged for repair UX, not silently invalidated. |
| Q13 | Capability-token carrier is the net-new token schema (Phase 5); carriage + preserve-unknown parsing only; no delegation validation until CC ships. |
| Q14 | Unattended internal (fleet) admission is permitted as a C0-class signed-policy event; per-device taps not required. |

## 7. Conduct rules

- Work strictly within the current phase order's scope. If a fix outside scope is tempting, record it in the phase report instead.
- Every phase leaves the system **buildable and testable**; land work in reviewable increments.
- Every schema/wire change: check `migration-and-risk.md` §1 (store impact) and §3 (risk register) first; implement the stated migration strategy and the stated verification.
- Tests are part of the deliverable: each phase order lists acceptance tests (derived from the extracts' section-K fail-closed criteria); write them as automated tests where feasible, including **structural-absence** assertions (e.g. no auto-accept control, no bypass API).
- Never hand-edit build configs outside the committed source of truth; do not touch preserved-store files directly (migrations only).
- Cite requirement IDs (`[VII.x]`…) and finding IDs (`V1`…, `A1`…) in commit messages and the phase report for every normative change.
- Repo language: code, comments, tests, and reports in English.

## 8. Phase sequence and handover protocol

| Phase | Order file | Theme | Exit gate (summary) |
|---|---|---|---|
| 1 | `01_Phase-Hygiene-Guards.md` | Full-claim guards, receiver-side ingress filter, dead-path removal | No schema change; guard + filter tests green |
| 2 | `02_Phase-Canonical-Core.md` | Canonicalization, frozen core record, containers, key extraction, anti-rollback store, version-gated wire | v2 capsules still verify; container semantics tests green |
| 3 | `03_Phase-Profile-Registry.md` | Registry + fail-closed dispatch, parallel core store, backfill, ledger freeze/sweep | Migration dry-run parity; unknown-profile refusal |
| 4 | `04_Phase-Formation-Pipeline.md` | One pipeline, capture methods, Connect-offer staging, provenance, silent revocation completed, edge-agent fold-in | No formation outside capture; no peer revoke signal |
| 5 | `05_Phase-Grants-Evidence.md` | Right objects, execution grants deleted + per-tap consent/PoAE, PoAC, hash-chained evidence, token schema | No execution without consent tap; Tier-L chain verifiable |
| 6 | `06_Phase-Governance-Classes.md` | Class registry, ESA grandfather-propose, directional sets, BER, signed policies, cross-device challenge | Non-admitted service unreachable; challenge binding live |

Handover: a phase is complete when (a) all its acceptance tests pass, (b) the do-not-regress suite passes, (c) a **phase report** exists covering: findings addressed (IDs), decisions applied (Q IDs), deviations from the order with justification, migration executions with dry-run evidence, open items forwarded to later phases, and any question for the spec author. The next phase starts from that report.