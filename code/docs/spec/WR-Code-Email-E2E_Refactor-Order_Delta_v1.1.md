# WR-Code Email E2E — Refactor Order Delta v1.1
## Additive integration of Annex XIV §XIV.5.5 and Annex XVII (WR Entries™, EVP, WRC™)

Status: ADDITIVE delta to `WR-Code-Email-E2E_Refactor-Order_v1.0.md`. Nothing in v1.0 is changed, reordered, or withdrawn; every fixed decision (D1/D3–D6, O2/O3/O6/O7, CPR contract, alert contract, IX↔XVI reading, carve-out, registry-as-real-service) stands. This delta adds requirements sourced from Annex XIV §XIV.5.5 (Execution Authorization Proof Chain and Catalog Commitment) and the new standalone Annex XVII (WR Entries and the Publisher Console). Companion document: `WRC-Registry-API-Contract_v1.0.md` — the scheduled pre-Phase-3 deliverable, now carrying the catalog/EVP/audit machinery; Phase 3 codes against it.

**Phase 1: complete — untouched. Phase 2 (incl. authorized 2A): proceed exactly as ordered in v1.0; this delta adds nothing to Phase 2.**

**WRC deferral (authoritative for scheduling).** Only the orchestrator/runtime is being developed right now; the WRC online component and its integration come later. Consequences: (a) the companion contract is an INTERFACE REFERENCE for the Phase-3 client, not a build order — do not implement any WRC service code; (b) Phase 3 is built contract-first against local fixtures/mocks behind an isolated transport interface; (c) acceptance items that require a live WRC instance (parts of (e)–(h) below, and live resolve/audit round-trips) are deferred to the later WRC integration slice and marked `integration-pending` in the phase report — they are NOT waived, and no substitute "temporary" trust path may be built in their place.

---

## Decision Register — ADDITIONS (A-series; none override an existing entry)

- **A1 — WRC identity & placement.** The publisher registry service is the first component of the Workflow Ready Cloud (WRC)™. D2 placement default STANDALONE is confirmed by this identity (public-facing trust posture); author-overridable until Phase-3 start, as before.
- **A2 — EVP-first-render.** After capture and successful verification, the first render of an entry shows ONLY the signed `value_statement` + `self_description` from the verified Entry Value Package — never any claim carried by the email or any other carrier. Carrier-carried marketing text never enters the offer preview. (Annex XVII §XVII.4.4.)
- **A3 — Epoch anti-rollback is client state.** `last_seen_epoch` per publisher is persisted client-side; any CatalogHead with a lower epoch is rejected. A stale head (past freshness window) demotes cached material to visibly-stale and blocks NEW authorization-bearing admissions. (Annex XIV §XIV.5.5(2).)
- **A4 — Audit link on every trust surface.** Offer previews and entry renders expose the per-item `GET /v1/audit/{hash}` link ("verify in repository"). (Annex XVII §XVII.6.)
- **A5 — Platform suspension is a visible state.** A `suspension` record in a DualAssuranceEnvelope renders as its own state with distinct copy and the audit link — treated like non-resolvable for admission, never displayed as silent absence, never conflated with publisher-side `inactive`. (Annex XVII §XVII.3.3.)
- **A6 — Suspension triple: three orthogonal layers, convergence is display-only.** Resolves the apparent collision between the publisher-signed entry status of Annex XVII §XVII.3.2 (`draft | published | suspended | retired`), the platform-side suspension of §XVII.3.3, and the D4 publisher status enum.
  1. **Data.** `entry.status` is publisher-SIGNED; platform suspension lives exclusively in the envelope. The two `suspended`s cannot collide in data by construction (rejection-never-modification).
  2. **Admission is conjunctive, fail-closed.** `admissible ⇔ D4 status == active AND entry.status == published AND envelope.suspension == null`. Any failing leg ⇒ typed reason.
  3. **Display never conflates.** entry-suspended = "withdrawn by the publisher"; platform suspension = "suspended by the platform" + reason + audit link; D4 renders at publisher scope. Headline = failing leg closest to the object (platform > entry > publisher-part); all failing legs visible in detail (never-fails-silently). No enum merged or extended.

  Phase 4 composes the surface from the three fields.

## Phase 3 — ADDITIONS (registry resolution client)

- **3D — Catalog Head verification.** Implement CatalogHead fetch + verification per contract §3.1/§5: signature (root or delegated key via DelegationRecord chain), strict per-publisher epoch monotonicity (persisted, A3), freshness-window handling with visible staleness. The per-publisher resolved record (D6) gains fields: `last_seen_epoch`, `catalog_root`, `head_issued_at`, `freshness_window_s`, `delegation_kid`.
- **3E — Envelope verification.** Implement DualAssuranceEnvelope verification per contract §3.4: publisher signature, ingest countersignature, Merkle inclusion proof against the verified head, suspension detection (A5). Any missing leg ⇒ the object does not exist for the runtime (no hidden path); the failure reason is typed for the status surface (never-fails-silently applies).
- **3F — EVP fetch + verify.** Fetch the entry's EVP by `evp_ref`; enforce the 64 KiB canonical-byte budget client-side (violation = verification failure, not truncation); parse `value_statement`, `self_description`, `scope_directory` for the offer surface. EVP retrieval failure is a typed capture-time state — the offer is NOT built from carrier text as a fallback (A2; consistent with "no degraded offer" in D5).

## Phase 4 — ADDITIONS (status model & offer schema)

- Status surface renders the platform-suspension state per A5 alongside the D4 publisher statuses (`active/inactive/revoked/superseded/compromised`); suspension arrives via envelope, not via the D4 enum — do not extend the enum, compose the display. The three-layer model, the conjunctive admission rule, and the headline precedence are ruled in **A6**; the surface composes from those three fields.
- Offer schema (Q7 field list) gains: `evp_ref`, `value_statement` (from verified EVP), `catalog_epoch`, `audit_url`. **Hash coverage extension of O2:** the consent preview hash additionally covers `evp_ref` and `value_statement` — what the operator consents to includes the value promise shown.

## Phase 5 — ADDITIONS (email→offer path & offer UI)

- Offer UI first render = EVP-first-render (A2): verified publisher identity, signed value statement, scope-directory summary, next step — nothing bulk-loaded, no carrier text.
- The audit link (A4) appears on the offer surface and on the consent preview.
- Consent-time re-validation (O6) now also re-fetches the CatalogHead and re-checks epoch/freshness/suspension before consent completes.

## Explicitly OUT OF SCOPE for this slice (deferred, tracked)

Scope Manifests beyond the EVP's `scope_directory` references; selection-class artifact loading and Execution Authorization Declaration enforcement (PoAC admission for repo artifacts); Publisher Console/orchestrator authoring UI; template machinery; Fraud Watchdog™ model integration (hook + suspension mechanics are in the WRC contract; the email slice only *renders* suspension). These arrive with the catalog/actuation slices after E2E acceptance of this one.

## E2E Acceptance — ADDITIONS

(e) a captured, verified code renders the signed value statement from the EVP while the carrying email contains a *different* claim — the discrepancy is visible, the carrier claim appears nowhere in the offer; (f) a rolled-back CatalogHead (lower epoch) is rejected and surfaces as a typed status; (g) a suspended entry renders the suspension state with reason copy and a working audit link; (h) the audit URL for the rendered EVP returns the byte-identical object.
