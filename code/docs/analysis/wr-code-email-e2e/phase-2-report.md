# WR Code / Public Handshake — Email E2E Slice
## Phase 2 report — Provenance gate, fail-open closure, unsuppressible alert

| | |
|---|---|
| Branch | `integration/consolidated-current` |
| Phase-2 tip at consolidation | `a155e097` (archive tag `archive/refactor-wr-code-email-e2e-phase-2`) |
| Build items | 3 (pipeline reorder + fail-open), 12 (unsuppressible alert); 13 (2C) **not yet** |
| Status | **In progress** — 2A complete, 2B Option 2 applied, 2C and after-capture pending |
| Do-not-regress | Baseline captured earlier this phase; after-capture comparison pending |

The agent did not build or run the desktop app or the extension. Everything
below is verified by headless unit / source-walking tests, plus git archaeology
for the consolidation.

**Supersession note.** Order v1.0 “Working discipline / Branches” (per-phase
branches) is superseded by the author workflow change of 2026-08-08: one
permanent development branch `integration/consolidated-current`. Phase
boundaries are marked by per-phase reports and annotated tags
`phase-<N>-complete`. Interim rig builds are at the author’s discretion via
tags. Decision register, invariants, reports, and no-build-no-app-start stand.

---

## Consolidation (author order B + D)

### Branch map — before

| Branch | Role | Tip (pre-retirement) |
|---|---|---|
| `refactor/wr-code-email-e2e-phase-1` | Phase 1 complete | `e404d322` |
| `refactor/wr-code-email-e2e-phase-2` | Phase 2 work (2A + 2B.1) | `a155e097` |
| `cursor/refactor-art50-ai-provenance-8df1` | PR #6 (art50) | `188c3278` |
| `refactor/wr-handshake-phase-5-grants-evidence` | PR #5 (handshake 1–5) | `b9a4b835` |
| `main` | Author-designated document drops only | (unchanged policy) |

`a155e097` already contained phase-1 via ancestry `e404d322`, the main merge
`93289fd1`, the order, and all Phase-2 work to that tip.

### Branch map — after

| Branch | Role |
|---|---|
| `integration/consolidated-current` | **Sole permanent development branch** |
| `main` | Author-designated document drops only |
| Per-phase branches | **Retired** (pointers deleted after archive tags) |

Merge that folded phase-2 into consolidation: `a38e8cdc`
(`merge: integrate refactor/wr-code-email-e2e-phase-2 into consolidation`).

### Annotated archive tags created

| Tag | Peeled tip |
|---|---|
| `archive/refactor-wr-code-email-e2e-phase-1` | `e404d322` |
| `archive/refactor-wr-code-email-e2e-phase-2` | `a155e097` |
| `archive/cursor-refactor-art50-ai-provenance-8df1` | `188c3278` |
| `archive/refactor-wr-handshake-phase-5-grants-evidence` | `b9a4b835` |

Tags first, deletions later — nothing became unreachable at any point.

### Ancestor-check outputs

Against `integration/consolidated-current` (exit `0` = is-ancestor / PASS):

```
$ git merge-base --is-ancestor e404d322 integration/consolidated-current; echo $?
0
$ git merge-base --is-ancestor a155e097 integration/consolidated-current; echo $?
0
```

Against `origin/main` for the retired PR tips (exit `1` = not contained in main):

```
$ git merge-base --is-ancestor 188c3278 origin/main; echo $?
1
$ git merge-base --is-ancestor b9a4b835 origin/main; echo $?
1
```

Against consolidated for the same PR tips (PASS):

```
$ git merge-base --is-ancestor 188c3278 integration/consolidated-current; echo $?
0
$ git merge-base --is-ancestor b9a4b835 integration/consolidated-current; echo $?
0
```

Only after the phase-1 / phase-2 ancestor checks PASSED were the two phase
branch pointers deleted (remote + local).

### PR dispositions

| PR | Branch | Contained in consolidated? | Contained in main? | Disposition |
|---|---|---|---|---|
| #5 | `refactor/wr-handshake-phase-5-grants-evidence` | Yes (`b9a4b835`) | No | Closed with comment naming containing ancestry / merge `a38e8cdc`; branch deleted; tip kept via archive tag |
| #6 | `cursor/refactor-art50-ai-provenance-8df1` | Yes (`188c3278`) | No | Closed with comment naming containing commit; branch deleted; tip kept via archive tag |

No merges without author review were required — content was already reachable
from consolidation via ancestry.

### Workflow supersession

- **One permanent branch:** `integration/consolidated-current`.
- **All remaining Phase 2 and Phases 3–5 land here.**
- Nothing is committed to `main` except author-designated document drops.
- Phase completion is marked by this report series + annotated tag
  `phase-<N>-complete` (not yet applied for Phase 2 — work incomplete).
- `.cursor/` added to root `.gitignore` (`743fd75a`).

---

## 2A — Pipeline reorder + fail-open closure (build item 3)

Completed on the former phase-2 branch (now in consolidation ancestry):

| Commit | Work |
|---|---|
| `06753a90` | CPR gates BEAP detection via `detectBeapPackageFromMessage` / `NO_DETECTION` |
| `8b2a18e0` | All three fail-open degradations → `DepackageCutoverHeldError` |
| `a181aaea` | Guard tests `provenanceGatesParsing.guard.test.ts` |

Guest MAY detect; host MUST NOT act on a failed channel — D5 stays on the host.
Fail-open branches closed (~754 / ~766 / ~793 line family on the pre-refactor
inline path; guards pin the source order).

---

## 2B — Unsuppressible provenance alert (build item 12)

### Trace — how `BeapMessage` is populated

Two entry points, both documented as sole ingest paths for their side:

1. **`sanitisedPackageToBeapMessage`**
   (`apps/extension-chromium/src/beap-messages/sanitisedPackageToBeapMessage.ts`)
   — Stage-5 `SanitisedDecryptedPackage` → in-memory `BeapMessage`. The capsule
   does **not** carry a Channel Provenance Record; CPR is produced in Electron
   main from gateway `Authentication-Results` at ingest
   (`produceChannelProvenance` / `messageRouter.ts`) and persisted into
   `inbox_messages.depackaged_metadata.channel_provenance`.

2. **`inboxRowToBeapMessage`**
   (`apps/extension-chromium/src/beap-messages/inboxRowToBeapMessage.ts`)
   — sealed Electron inbox rows from `handshake.beapInbox.list` /
   `getMany`. The RPC **does not SELECT or return `depackaged_metadata`**, so
   the two alert fields (DKIM / DMARC verdicts) are not on the existing wire.
   Extending the SELECT + `BeapInboxRow` + mapper would be sync-path surgery.

### Conditional ruling — path taken

**OPTION 2** (authorised). Option 1 rejected: the two alert fields cannot ride
an existing wire message with a bounded one-field / one-population-point change
without touching the extension sync path. Option 3 rejected per order.

Applied under Option 2:

- Shared component design **ratified** (rule inside the component, structural
  typing, cross-product cross-check vs `channelAlertRequired`) — already landed
  as `ChannelProvenanceAlert` in `@repo/shared-beap-ui` (`a155e097` + follow-on).
- Electron surfaces wired from live `depackaged_metadata` (no sync change):
  `EmailMessageDetail`, `LinkWarningDialog` (+ bulk pending-link forward).
- Extension `BeapMessageDetailPanel` wired behind optional prop
  `channelProvenanceRecord`; unit-tested for prop-supplied behavior.
- Plumbing recorded as the **named item**
  **“extension CPR plumbing (Phase 5)”** in Delta v1.1 Phase-5 additions.
  Under the single-branch workflow the data lands before any end test, so a
  never-alerting extension surface never reaches a tested build.

### Tests added for 2B

| Suite | Asserts |
|---|---|
| `packages/shared-beap-ui/src/ChannelProvenanceAlert.test.ts` | Display rule matrix; fail-closed extract; non-dismissibility of component body |
| `packages/ingestion-core/__tests__/channelProvenanceAlertDisplay.crossCheck.test.ts` | Full DKIM×DMARC cross-product vs canonical `channelAlertRequired` |
| `apps/electron-vite-project/src/components/ChannelProvenanceAlert.surfaces.test.tsx` | Electron detail + link-dialog + bulk wiring |
| `apps/extension-chromium/.../BeapMessageDetailPanel.channelProvenance.test.ts` | Optional-prop contract + prop-supplied render |

---

## 2C — CPR as typed input to local scam analysis (build item 13)

**Not started.**

---

## After-capture / environment

Pending on this branch before Phase 2 can be tagged `phase-2-complete`:

- Full-workspace `pnpm test:native-db` after-capture with
  `testResults.length >= 100` validity guard.
- Failure-identity comparison to the Phase-2 baseline.
- Extension build verification on the author’s rig (agent does not build/start
  the app).

---

## Environment notes (ratified)

- Electron ABI rebuild OK in the Phase-2 sandbox session.
- Windows Phase-1 numbers are reference-only.
- Bare `pnpm test:native-db` runs one file; full workspace needs the
  flags-only JSON-output invocation; guard asserts `testResults.length`, not
  `numTotalTestSuites`.
