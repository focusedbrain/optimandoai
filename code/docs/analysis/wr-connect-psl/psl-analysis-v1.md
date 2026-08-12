# WR Connect™ Publisher Semantic Layer — Implementation Analysis v1.0

**Status: PARTIAL — two authoritative inputs are missing and §3 is BLOCKED on
them.** Analysis only; no code changed, no branch created, no schema edited.
Date 2026-08-12. Tree: `integration/consolidated-current`, RIG-READY.

---

## 0. Input inventory — read this first

The mission requires citing `wr-connect.php` v0.6.2 by function and line, and
citing Annex XVIII §§XVIII.3/4/5.4/6 as normative. Neither input is available
to me, and I will not synthesise around that.

| Input | Status | Evidence |
|---|---|---|
| `wr-connect.php` **v0.6.2, 1406 lines** | **MISSING** | The repo copy at `/wr-connect.php` is **418 lines** and is a much earlier version — see §0.1 |
| **Annex XVIII** (WR Connect v1.0, 10 Aug 2026) | **MISSING** | Annex PDFs at repo root run I–XVII; there is no XVIII. `ls *.pdf` |
| WRC Registry API Contract v1.0 + v1.1 delta | Present | `code/docs/spec/WRC-Registry-API-Contract_v1.0.md` @`20794bff`, `…_Delta_v1.1.md` |
| Runtime repo at current tip | Present | `adcc99c2` (analysis began), phase-5-complete ancestor |
| Standing rules | Present | phase reports + `captures/README.md` |

### 0.1 The script in the repo is not the script described

Measured, not assumed:

```
wc -l wr-connect.php            → 418          (prompt says 1406)
rg -c 'wrc_db'   wr-connect.php → 0            (prompt: "the existing wrc_db() pattern (WAL, …)")
rg -c 'sqlite'   wr-connect.php → 0            (prompt: "the script's SQLite working store")
rg -c 'api='     wr-connect.php → 0            (prompt: mgmt/route families)
rg -c 'mgmt'     wr-connect.php → 0
rg -c 'nonce'    wr-connect.php → 0            (prompt: "dual-signed envelopes, nonces, epoch check")
rg -c 'epoch'    wr-connect.php → 0
rg -c 'handshake' wr-connect.php → 0           (prompt: "handshake chain resolution, session binding")
```

Its whole function inventory is 23 functions (`wrc_b64u`:41 … `wrc_login_form`:414),
and its persistence is a single PHP-guarded JSON state file
(`wrc_state`:113 / `wrc_save_state`:123, writing `WRC_STATE_FILE` with a
`<?php http_response_code(404); exit; ?>` prefix at :131) — **not** SQLite.
`git log -- wr-connect.php` shows three commits, all "Add files via upload".

So the repo holds roughly a v0.1-era setup/DNS/well-known/admin-session script.
Every §3 question is premised on code that is not in front of me: I cannot
propose tables "consistent with the existing `wrc_db()` pattern", judge whether
"the v0.3.0/v0.4.0 mgmt route family carries this or needs a new route class",
or verify `wrc_canonical_json`'s suitability for large exports at v0.6.2 — the
418-line copy has a `wrc_canonical_json` at :50, but that tells us nothing about
the one 1000 lines later.

**What I do have as a partial substitute:** `docs/analysis/wr-runtime-status-report.md`
documents the **v0.4.0** website contract from the runtime side, including
`?api=orchestrator/pair` (:575, :649, :687) and `?api=mgmt` with the sealed-box
`{v:"n", cap:"<b64u sealed box>"}` envelope (:218, :649, :697, :755). That is
enough to reason about route-family *shape*, and I use it below where marked. It
is not enough for line-level citation of v0.6.2.

**Requested:** attach `wr-connect.php` v0.6.2 and Annex XVIII, and §3 can be
completed in a follow-up pass without redoing §4.

---

## 1. Current-state map — orchestrator side (evidence-backed)

This half is fully analysable and is done.

| Concern | State | Evidence |
|---|---|---|
| Client for the script's API | **Greenfield — none exists** | No `?api=` caller anywhere in TS. The only `wr-connect` hits are an unrelated DOM id `#wr-connect-btn` (`content-script.tsx:8511, 9074, 9446`) and a comment in `wrc/wrcCrypto.ts:6`. Confirms baseline A4/F1. |
| LSEM | **Greenfield** | No module, table, or type. The `rg -i lsem` hits are substring noise (`processingEvents.ts`, `hybridSearch.ts` etc.), not the concept. |
| Navigation Graph / Semantic Anchor | **Greenfield** | `rg -i "navigation graph\|semanticAnchor\|navGraph"` → nothing. |
| WCR recorder | **Not present as a recorder** | Hits are docs and a `package-lock` string; no recording subsystem in `apps/`. |
| PoAC | **Docs only** | Named in `docs/spec/…Delta_v1.1.md` and the gap analyses; no admission code path by that name. Nearest real gate is the capability broker (`electron/main/vault/capabilityBroker.ts`). |
| Sealed-box wire format | **Absent runtime-side** | `wrc-x25519-sealedbox-ed25519-v1` appears nowhere in code; the status report lists the mgmt envelope as ABSENT. |
| Anti-rollback protection class | **Exists — reusable precedent** | Schema **v77** `wrc_publisher_epoch_floor` (`handshake/db.ts:1380`) + `wrc/epochFloorStore.ts`, two operations only (`get`, `raise`), monotonicity in the SQL statement, guard test proving a cache-file deletion cannot reset it. |
| Local stores the LSEM must bind to | Exist | Vault (`electron/main/vault/*`, `capabilityBroker.ts`, `atomicWrite.ts`), hsContext profiles (`apps/extension-chromium/src/vault/hsContext/*`), embeddings + hybrid search (`handshake/embeddings.ts`, `handshake/hybridSearch.ts`), WR Guard (`apps/extension-chromium/src/wrguard/*`). |
| WRC client (Phase 3) | Exists, contract-first | `electron/main/wrc/` — hardened HTTPS client, dual-channel validation, head/envelope/EVP verification, isolated transport interface. |

**The single most useful finding for planning:** the orchestrator side is almost
entirely greenfield for PSL, but it is greenfield *next to* four things it should
reuse rather than reinvent — the Phase-3 hardened client and its isolated
transport seam, the v77 epoch-floor protection class, the sealed-storage gate,
and the loopback RPC surface. The PSL client is a sibling of `wrc/`, not a new
stack.

---

## 2. Gap list

**G1 — No API client at all (orchestrator ↔ script).** Greenfield. Must live in
Electron main, per the standing rule that node-only guards never sit in
browser-imported packages (Phase-3 report §1, ratified). The extension reaches
it over the existing loopback RPC.

**G2 — No LSEM store, no provenance classes, no merge discipline.** Needs:
per-publisher compartmentalisation, encryption at rest, coexisting assertions per
class, and the rule that local enrichment extends but never silently overrides
`PUBLISHER_*`.

**G3 — No PSL epoch floor.** The pattern exists (v77) and should be copied, not
re-derived: floor in the native DB, cache elsewhere, no lowering path in the API.

**G4 — No declarative-only ingest gate.** BEAP text purity says *reject, do not
sanitize*. The nearest existing discipline is the content validator and the
sealed-storage reject mode; neither currently expresses "no code in any
encoding".

**G5 — No anchor resolution contract.** Annex Open Item 1. Blocks the WCR
substrate; a minimal fail-closed v1 form is needed (Q6).

**G6 — Script-side everything.** Unassessable until v0.6.2 arrives (§0).

**G7 — Conflict risk to check, not yet a conflict:** the PSL must not touch the
Phase-4 offer/consent surfaces. Those now carry `evp_ref` / `value_statement` in
the preview hash, and A2 forbids carrier text in an offer. A publisher-authored
Q&A corpus is *semantic*, not consequential — if any PSL field ever reached
`buildConnectOfferPreview`, it would put publisher prose inside the consent pin.
**Recommended invariant: PSL fields are structurally absent from the offer/consent
path, enforced by a source-walking guard**, in the same style as the existing
"single staging read surface" guard.

---

## 3. Publisher-side analysis — **BLOCKED**

Cannot be delivered to the standard the mission sets (function/line citation of
v0.6.2). Partial observations that survive the missing input:

- **Execution locus** — the three-method split (manual / cloud / local) is sound
  on shared hosting only if the cloud path is a **resumable job queue with
  batched admin-triggered runs**; a single long request will hit
  `max_execution_time`. This follows from the hosting constraint alone, not from
  the script.
- **Local-AI push** — should reuse the `?api=mgmt` sealed-box envelope family
  documented in the status report rather than a new route class, *if* v0.6.2's
  mgmt route already carries dual-signature + nonce + epoch. Verification
  pending the file.
- **Crawl posture** — whatever `wrc_http_get` looks like at v0.6.2, it must carry
  the Phase-3 SSRF findings: guard the **resolved address**, not the hostname
  (DNS rebinding), and unwrap **bracketed IPv6** literals — the exact class I
  found and fixed in `wrc/httpsClient.ts` this slice. The 418-line copy's
  `wrc_http_get` is at :244 and would need review against that.
- **Signing key (sbk vs root)** — `sbk` appears 6× in the old copy; without
  v0.6.2 I will not argue a key choice for an artifact class I cannot see.

---

## 4. Orchestrator-side plan (implementable now, independent of §3)

Ordered so each phase is a bounded order with its own before/after capture per
the capture-persistence rule, on the existing branch, tagged at the boundary.

**P1 — PSL transport client + admission gate.** Sibling of `wrc/`: reuse
`wrcHttpsGet` and an isolated transport interface so a contract-faithful double
drives the tests. Declarative-only ingest gate (G4): reject on any executable
form, typed reason, no sanitisation.
*Acceptance:* divergence matrix with distinct reasons; a code-bearing payload in
every encoding tried is rejected, not cleaned; unconfigured deployment refuses.

**P2 — PSL store + epoch floor.** Native-DB floor copied from the v77 pattern;
graph/corpus in a compartmentalised per-publisher store, encrypted at rest.
*Acceptance:* guard test that deleting user-data JSON does not reset the floor
(direct analogue of `epochFloorHardening.test.ts`); rollback refused as rollback.

**P3 — LSEM merge discipline.** Provenance classes coexisting; local enrichment
extends, never overrides `PUBLISHER_*`; epoch advance invalidates `PUBLISHER_*`
selectively and preserves local classes; revocation purges per handshake.
*Acceptance:* a merge matrix test per class pair, and a test that an epoch
advance leaves `USER_PROVIDED` / `LOCAL_INFERRED` intact.

**P4 — Anchor v1 + WCR substrate.** Minimal fail-closed anchor form (Q6);
recordings reference node/edge/anchor ids.
*Acceptance:* ambiguous anchor fails closed with a typed reason; no positional
fallback.

**P5 — Query privacy + selection-class bundling.** Entry-class (graph + routes)
vs selection-class (Q&A bundles) load split.
*Acceptance:* per-request observability test — fetching one answer must not
reveal which.

**Non-goal, explicitly:** none of P1–P5 touches consent, trust uplift, or
execution authority; G7's guard lands in P1.

---

## 5. Question register for O

**Q1 (blocking).** Please attach `wr-connect.php` **v0.6.2** (1406 lines). The
repo copy is 418 lines and pre-SQLite; §3 cannot be answered against it.

**Q2 (blocking).** Please attach **Annex XVIII v1.0**. Every normative citation
the mission asks for (§XVIII.3.3 authoring methods, §3.4 republish triggers,
§3.7 nine artifact classes, §3.8 catalog path, §4.4 query privacy, §5.4
positional guidance, §6.3 no telemetry) is unreadable without it.

**Q3.** v1 scope cut: may `psl_capabilities` and `psl_wrlinks` ship
schema-present/empty, with the Navigation Graph, routes, anchors, FAQ and Q&A as
the working set? *(My recommendation: yes — they are the two classes with no
consumer until the recorder and WR Link surfaces exist.)*

**Q4.** Cloud-AI endpoint policy: publisher-configured endpoint + key stored
server-side. Is any egress allowlist required, or is the publisher's choice
final? Note this is the one place the script makes outbound calls to a
non-publisher origin.

**Q5.** Does v0.6.2's `?api=mgmt` already carry dual-signature + nonce + epoch?
If yes, local-AI push reuses it; if no, a new route class is needed and that
changes P1's surface.

**Q6.** Anchor v1 form. Proposal to approve or replace: `{ node_id, selector_kind,
selector_value, stability_hint }` where `selector_kind` is a closed enum,
resolution is exact-match only, and **ambiguity or absence fails closed** with no
positional fallback (§XVIII.5.4 is about *guidance*, not about resolving by
coordinates). Sufficient for recorder binding; deliberately not a query language.

**Q7.** Confirm G7's invariant: PSL fields structurally absent from the
offer/consent path, enforced by a source-walking guard.

**Q8.** Where should the PSL client's registry/endpoint configuration live?
Phase-3 used env vars deliberately ("no half-built UI"); PSL may need an admin
surface sooner.

---

## 6. Combined final rig checklist (one pass: refactor + PSL)

### 6.1 Handshake refactor — the seven hand checks (currently implemented-but-unverified)

1. Unsuppressible rule-8 alert renders on an unauthenticated message, on all
   three surfaces (`EmailMessageDetail`, `LinkWarningDialog`,
   `BeapMessageDetailPanel`), identically and with no dismiss control.
2. Zero derived affordances from a provenance-failed message.
3. Manual entry completes the full chain for that same message (the one
   downgrade path).
4. EVP-first-render: the offer shows the signed value statement, never carrier
   text; no verified EVP ⇒ no offer.
5. Consent binding: `expected_preview_hash` computed from what was **rendered**
   and passed to consent. *(The hash input is tested; the render→consent wiring
   is not — Phase-5 report §6.)*
6. Status surfaces: revoked / inactive / compromised (with warning) / superseded
   (successor surfaced) / expired; unknown code → capture error.
7. Extension sanity: MV3 build with the `@repo/shared-beap-ui` alias, load
   unpacked, reload, and `[RUNTIME_IDENTITY]` matching the stamp.

### 6.2 PSL E2E (once implemented)

Author (each of the three methods) → store → export canonical signed JSON →
deliver over the attested channel → admit under the declarative-only gate →
merge into LSEM under provenance discipline → enrich locally with PII/memory/
on-prem → ask *"show me where I download my invoice"* and get a declared route
plus a fail-closed anchor, and a corpus answer that visibly used private context
without that context leaving the machine.

Plus the negative pass: a code-bearing PSL payload is **rejected, not
sanitised**; an epoch rollback is refused; `PUBLISHER_AI_INFERRED` is visibly
distinct from `PUBLISHER_DECLARED` in the UI.

### 6.3 `integration-pending` at the combined pass

The six WRC items from the Phase-5 report carry unchanged (live resolve, live
audit round-trip, live rollback, live suspension, live delegation audit,
registry placement), **plus** PSL catalog commitment / ingest / countersignature,
which has no live WRC to run against and is contract-first by constraint.

---

## 7. Method note

Graphify was reinstalled and its hooks are active, but the graph was rebuilt
only after the VM reprovision; every claim above is source-verified by path and
line, per graph-first-never-evidence. Where I could not verify — the whole of §3
— I have said so rather than inferred.
