# WR Code / Public Handshake — Email E2E Slice
## Phase 2 report — Provenance gate, fail-open closure, unsuppressible alert, CPR into analysis

| | |
|---|---|
| Branch | `integration/consolidated-current` (sole permanent development branch) |
| Phase-2 tip at consolidation | `a155e097` (archive tag `archive/refactor-wr-code-email-e2e-phase-2`) |
| Build items | 3 (pipeline reorder + fail-open), 12 (unsuppressible alert), 13 (CPR → scam analysis) |
| New tests this phase | 25 across 5 files, all green |
| Do-not-regress | **Clean** — identical failure identity set before and after (201 = 201, 0 regressions, 0 repairs) |

The agent did not build or run the desktop app or the extension. Everything
below is verified by headless unit / source-walking tests, plus git archaeology
for the consolidation section.

**Supersession note.** Order v1.0 “Working discipline / Branches” (per-phase
branches, one phase per branch) is superseded by the author workflow change of
2026-08-08: one permanent development branch `integration/consolidated-current`.
Phase boundaries are marked by these per-phase reports and annotated tags
`phase-<N>-complete`. Interim rig builds happen at the author’s discretion via
tags. Decision register, invariants, reports, and no-build-no-app-start stand.

**Baseline supersession.** Order v1.0 pins the do-not-regress comparison to
baseline `188c3278`. That baseline predates the consolidation, so the honest
comparison for this phase is against the consolidated branch immediately before
the Phase-2 work landed (`743fd75a`). Both captures are in §6; the older
phase-2-branch capture is reported there too, with its delta attributed.

---

## 1. Consolidation (author order B + D; RATIFIED at `0c8466aa`)

### Branch map — before

| Branch | Role | Tip (pre-retirement) |
|---|---|---|
| `refactor/wr-code-email-e2e-phase-1` | Phase 1 complete | `e404d322` |
| `refactor/wr-code-email-e2e-phase-2` | Phase 2 work (2A + 2B.1) | `a155e097` |
| `cursor/refactor-art50-ai-provenance-8df1` | PR #6 (art50) | `188c3278` |
| `refactor/wr-handshake-phase-5-grants-evidence` | PR #5 (handshake 1–5) | `b9a4b835` |
| `main` | Author-designated document drops only | (policy unchanged) |

`a155e097` already contained Phase 1 via ancestry `e404d322`, the main merge
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

Only after the Phase-1 / Phase-2 ancestor checks PASSED were the two phase
branch pointers deleted (remote + local).

### PR dispositions

| PR | Branch | In consolidated? | In main? | Disposition |
|---|---|---|---|---|
| #5 | `refactor/wr-handshake-phase-5-grants-evidence` | Yes (`b9a4b835`) | No | Closed with a comment naming the containing ancestry / merge `a38e8cdc`; branch deleted; tip kept via archive tag |
| #6 | `cursor/refactor-art50-ai-provenance-8df1` | Yes (`188c3278`) | No | Closed with a comment naming the containing commit; branch deleted; tip kept via archive tag |

No merges without author review were required — both tips were already
reachable from consolidation via ancestry.

### Workflow supersession, in force

- One permanent branch: `integration/consolidated-current`.
- All remaining Phase 2 and Phases 3–5 land here.
- Nothing is committed to `main` except author-designated document drops.
- Phase completion = this report series + annotated tag `phase-<N>-complete`.
- Draft PR #8 is the living integration surface.

### Repository hygiene

- `.cursor/` was first ignored wholesale (`743fd75a`), then refined
  (`5f5d06a3`) so the hand-authored Graphify↔Cursor integration stays visible:

```
.cursor/*
!.cursor/rules/
!.cursor/mcp.json
graphify-out/
```

---

## 2. Tooling — Graphify adoption

Installed in the agent sandbox: `pip install graphifyy` (0.9.36); AST-only
deterministic build (`graphify update .`) — **18,176 nodes / 46,653 edges /
647 communities**, no LLM backend needed. Auto-update hooks installed
(`graphify hook install`: post-commit, post-checkout, graph.json merge driver);
observed firing on every commit and branch switch in this session. The author’s
`.cursor/rules/graphify.mdc` was already tracked in the repo, so no rule was
generated.

**Authority boundary observed.** The graph oriented the 2C attachment-point
search (it surfaced `parseInboxAiJson.ts`, `scamWatchdogBuiltIn.ts`,
`inboxLlmChat.ts` as leads); every statement in this report and every assertion
in the new guard tests is source-verified. No guard test, invariant, or report
claim cites the graph. Graph output stays untracked.

---

## 3. 2A — Pipeline reorder + fail-open closure (build item 3)

Completed on the former phase-2 branch, now in consolidation ancestry:

| Commit | Work |
|---|---|
| `06753a90` | CPR gates BEAP detection via `detectBeapPackageFromMessage` / `NO_DETECTION` |
| `8b2a18e0` | All three fail-open degradations → `DepackageCutoverHeldError` |
| `a181aaea` | Source-walking guard tests `provenanceGatesParsing.guard.test.ts` |

**Deliberate guest-ordering reading.** The guest MAY detect; the host MUST NOT
act on a message whose channel failed. D5 evaluation stays on the host — it was
not moved into the depackaging guest, because a guest-side trust verdict would
place trust evaluation inside the component the boundary exists to distrust.

**Fail-open branches closed** (three degradations on the inline path, including
the `!sandboxHandshake` branch): each now fails closed into the
quarantine-equivalent path via `DepackageCutoverHeldError` rather than
degrading a failed depackage into a plain inbox row. The guard tests pin the
source ordering so a refactor cannot silently restore the degradation.

---

## 4. 2B — Unsuppressible provenance alert (build item 12)

### Trace — how `BeapMessage` is populated

Two entry points, each documented in source as the sole ingest path for its side:

1. **`sanitisedPackageToBeapMessage`**
   (`apps/extension-chromium/src/beap-messages/sanitisedPackageToBeapMessage.ts`)
   — Stage-5 `SanitisedDecryptedPackage` → in-memory `BeapMessage`. The capsule
   carries no Channel Provenance Record; the CPR is produced in Electron main
   from gateway `Authentication-Results` at ingest (`produceChannelProvenance`
   in `messageRouter.ts`) and persisted into
   `inbox_messages.depackaged_metadata.channel_provenance`.

2. **`inboxRowToBeapMessage`**
   (`apps/extension-chromium/src/beap-messages/inboxRowToBeapMessage.ts`)
   — sealed Electron inbox rows from `handshake.beapInbox.list` / `getMany`.
   That RPC does **not** SELECT or return `depackaged_metadata`
   (`electron/main/handshake/ipc.ts`, `handshakeRpc.ts:BeapInboxRow`), so the two
   alert fields are not on the existing wire.

### Conditional ruling — path taken: **OPTION 2**

Option 1 was not available: carrying the two verdicts would require extending
the RPC SELECT, the `BeapInboxRow` wire type, and the mapper — extension
sync-path surgery, not one field with one population point. Option 3 is
rejected by the order. Applied under Option 2:

- Shared component design **ratified** — the rule lives inside
  `ChannelProvenanceAlert` (`@repo/shared-beap-ui`), the record is structurally
  typed so the package needs no `@repo/ingestion-core` dependency, and a
  cross-product test keeps the rule honest against canonical
  `channelAlertRequired`.
- **Electron surfaces wired from live data** (no sync change needed there):
  `EmailMessageDetail` reads the CPR out of `depackaged_metadata`;
  `LinkWarningDialog` takes it as a prop; `EmailInboxBulkView` forwards the
  pending link’s message record.
- **Extension surface wired behind an optional prop**
  `channelProvenanceRecord` on `BeapMessageDetailPanel`, with the prop-supplied
  behavior unit-tested (alerting record renders, non-alerting renders nothing,
  omitted/null renders nothing — never a fake pass).
- Plumbing recorded as the **named item “extension CPR plumbing (Phase 5)”**
  in the Delta v1.1 Phase-5 additions. Under the single-branch workflow the
  data lands before any end test, so a never-alerting extension surface never
  reaches a tested build.

### Non-dismissibility and same-specifier guards

The alert has no dismiss, no acknowledge, and no null state once the trigger
holds. The art50 disclosure pattern is deliberately not reused: it carries
acknowledgement state, and an acknowledged warning is one the operator can be
trained to click away. Guard tests assert the component body contains no
`onDismiss` / `onAcknowledge` / `onClose`, no checkbox, and no button; a
separate assertion confirms the link dialog’s own risk checkbox (which gates
link opening) does not clear the alert rendered above it. Secure-Browse policy
may escalate this, never remove it.

### Tests added (2B)

| Suite | Asserts |
|---|---|
| `packages/shared-beap-ui/src/ChannelProvenanceAlert.test.ts` | Display-rule matrix; fail-closed structural extract; non-dismissibility of the component body |
| `packages/ingestion-core/__tests__/channelProvenanceAlertDisplay.crossCheck.test.ts` | Full DKIM×DMARC verdict cross-product vs canonical `channelAlertRequired` |
| `apps/electron-vite-project/src/components/ChannelProvenanceAlert.surfaces.test.tsx` | Electron detail + link-dialog + bulk wiring; alert renders with no dismiss control |
| `apps/extension-chromium/.../BeapMessageDetailPanel.channelProvenance.test.ts` | Optional-prop contract; prop-supplied render / non-render |

---

## 5. 2C — CPR as typed input to local scam analysis (build item 13)

### Attachment point — verified, and it is not `ai_analysis_json`

The order named `ai_analysis_json` as a candidate. Verified: that column is the
analysis **output** sink (written back after the model responds, in
`email/ipc.ts` and read by `inboxRowToBeapMessage`). It is not an input
attachment point.

**The actual input attachment point** is the combined inbox analysis prompt:

- `electron/main/email/scamWatchdog.ts` —
  `buildScamWatchdogUserContext` (user prompt) and
  `appendScamWatchdogToSystemPrompt` (system prompt);
- consumed by both analysis handlers in `electron/main/email/ipc.ts`:
  `inbox:aiAnalyzeMessage` and `inbox:aiAnalyzeMessageStream`.

Scam Watchdog is a peer category of the same single inference call, so wiring
the CPR here reaches the local scam-analysis path without adding a model, a
call, or a second prompt. It is mode-agnostic (host and sandbox differ only in
transport), so both get the input.

### What was wired

- `ChannelProvenanceAnalysisInput` — a typed, bounded projection: SPF / DKIM /
  DMARC verdicts, the `channel_pass` aggregate, and the authenticated sender
  domain. Nothing else. The depackaging boundary keeps raw
  `Authentication-Results` out of the record, and this projection has no slot
  for them; a test asserts the projected key set exactly.
- `channelProvenanceAnalysisInput(metadata)` — fail-closed decode of a
  `depackaged_metadata` blob (object or JSON string). Malformed or absent ⇒
  `null`.
- `buildChannelProvenanceAnalysisBlock` — renders the verdicts as declared
  evidence. Absence is stated explicitly (“not available … do NOT infer that it
  was authenticated”) rather than left silent, so a missing record can never
  read as an authenticated one.
- Both handlers now SELECT `depackaged_metadata` and pass the decoded input
  into the prompt builder. This is Electron-local; no sync path is touched.

### One-directional layering, guarded

Prompt-level: an unauthenticated channel **may strengthen** a concrete finding
but is **never a finding on its own** (an unauthenticated channel alone stays
`scamStatus: "clear"`); an authenticated channel **never clears, softens, or
outweighs** a concrete signal; and the model is told the rule-8 warning belongs
to the application — it must not restate it, claim to replace it, or call the
message verified because of these verdicts.

Code-level guards (`channelProvenanceAnalysisInput.guard.test.ts`, 11 tests):
the analysis module never imports or references `ChannelProvenanceAlert` /
`channelAlertRequired` / `shared-beap-ui`; the alert component never reads
scam-analysis output (`scam`, `ai_analysis_json`, `aiClassification`); both
handlers are source-walked for the `depackaged_metadata` SELECT and the CPR
argument; and the analysis result is never written back into the alert’s source
of truth.

**Conditionality.** The block only reaches a model when the deployment actually
runs that analysis mode — both handlers return early when no LLM provider is
available. No analysis, no CPR block; the alert is unaffected either way.

---

## 6. Test capture and do-not-regress

### Invocation (exact)

```
pnpm test:native-db --reporter=json --outputFile=<path>
```

**Bare-command trap.** `pnpm test:native-db` with no arguments runs a
*single* default file (`messageRouter.depackageSeam.test.ts`) — see
`scripts/run-native-db-tests.cjs`, which substitutes `DEFAULT_FILES` when
`process.argv.slice(2)` is empty. Passing **flags only** (no file paths) makes
`targets` non-empty without naming a file, so vitest runs the full workspace
under Electron’s embedded Node. A capture that forgets the flags silently
measures one file.

**Validity guard.** Assert `testResults.length >= 100`, not
`numTotalTestSuites`. `numTotalTestSuites` counts `describe` blocks (≈2,000 here)
and stays large even for a one-file run, so it cannot detect the trap;
`testResults.length` is the file count and can.

### Captures

| Capture | Commit | `testResults.length` | Guard | Total tests | Failed | Passed |
|---|---|---|---|---|---|---|
| Consolidated baseline (before Phase-2 work) | `743fd75a` | 547 | PASS | 5,951 | 201 | 5,693 |
| After | `8089bb44` | 552 | PASS | 5,976 | 201 | 5,718 |

**Failure identity comparison (after vs consolidated baseline): 0 regressions,
0 repairs — the two identity sets are equal.** The deltas are exactly the work
added: +5 test files, +25 tests, +25 passing (14 from 2B, 11 from 2C).

### The older phase-2-branch capture, and why it differs

The earlier baseline taken on `refactor/wr-code-email-e2e-phase-2` recorded 543
files / 5,927 tests / 173 failures. Comparing the after-capture to *that* set
shows 30 apparently-new failures in five suites
(`beapInboxClonePrepare`, `beapInboxClonePrepareSealGate`,
`b9OutboundCloneIntegrity`, `pr52CloneDeterminism`,
`p2p/coordination-client`). **Attributed, not assumed:** those five suites were
re-run at `743fd75a` — before any Phase-2 2B/2C commit — and fail there too
(35 failures). They arrived with the consolidation merges that the phase-2
branch did not contain, not with this phase’s work. Two `llm/diagnostics`
failures present in the old set pass now, from the same merges. This is why the
consolidated-branch capture is the operative baseline.

**Fragility note.** These counts are not stable identities across machines or
runs. Suite totals shift with merges, several suites are environment-gated
(`skipIf(!Database)` outside the Electron runtime), and a handful are
order-sensitive. Only the **failure identity set** comparison is meaningful;
raw counts are context, not a pass criterion.

**ABI blocker retired.** Order v1.0 recorded a `better-sqlite3` ABI mismatch
that skipped SQLite-bound suites in agent environments, with an instruction not
to rebuild native modules. Running vitest under Electron’s embedded Node
(`ELECTRON_RUN_AS_NODE=1`, `scripts/run-native-db-tests.cjs`) loads the shipping
binary natively — no rebuild, no second binary. Those suites execute in both
captures; the blocker no longer applies and no suites are skipped for ABI
reasons.

**Platform caveat.** All captures here are Linux, agent sandbox. Phase-1
numbers were taken on Windows and are reference-only; they are not comparable
to these and were not used in any comparison.

**Extension build verification: pending on the author’s rig.** The agent does
not build or start the app or the extension. The extension wiring
(`@repo/shared-beap-ui` dependency, vite alias, tsconfig path, the optional
prop) is verified by unit tests and source walking only.

---

## 7. Exit criteria (Phase 2)

| Criterion | Status |
|---|---|
| Order guard tests green on both flag paths | Met — `provenanceGatesParsing.guard.test.ts` (9 tests) green |
| D5 verdict logic unit-tested (DKIM-only pass under SPF-breaking forwarding; full-fail routing) | Met — `channelProvenance.test.ts` (Phase 1, still green) |
| Alert renders from one shared component on inbox and link-dialog surfaces | Met on Electron; extension behind the optional prop (Option 2, named Phase-5 item) |
| Guard test proves non-dismissibility | Met |
| Fail-open branch closed with test; quarantine path exercised | Met |
| Do-not-regress vs baseline | Met — identical failure identity set |

---

## 8. Out of scope, recorded not implemented

- **extension CPR plumbing (Phase 5)** — the named Option-2 item: return
  `depackaged_metadata` from `handshake.beapInbox.list` / `getMany`, extend
  `BeapInboxRow`, and map `channel_provenance` in `inboxRowToBeapMessage` so the
  extension panel’s prop is fed from live data.
- Phase-5 surfaces (Connect offer, consent preview) are not yet wired to the
  alert — they do not exist yet; Order v1.0 §2B schedules them for Phase 5.
- **consolidation-inherited failures** — the named backlog item covering
  `p2p/coordination-client` and the four clone-prepare suites, which fail on the
  consolidated branch independently of this phase. Not in Phase-2 scope. A
  bounded diagnosis-only pass was ordered for after this tag and before Phase 3;
  its findings and the pinned failing identities live in
  `consolidation-inherited-failures.md`.

---

## 9. Environment notes (ratified)

- Electron ABI rebuild is unnecessary; the native-db runner is the supported path.
- Windows Phase-1 numbers are reference-only.
- Bare `pnpm test:native-db` runs one file; full workspace requires the
  flags-only invocation; the guard asserts `testResults.length`.
- Graph output (`graphify-out/`) is derived and per-machine; never committed,
  never cited as evidence.
