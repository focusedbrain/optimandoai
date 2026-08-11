# WR Desk — Pre-Flight Verification (email E2E slice)
## Static / headless only. Read-and-report. No build, no app start, no code changes.

| | |
|---|---|
| HEAD | `21389e8ebe3936a573b292ad53c76a7ccd095f1b` (`21389e8`) |
| Tag | `phase-5-complete` = `f12c62626fb31024a314bb1068368e02fbb4a70f` |
| Branch | `integration/consolidated-current` |
| Verdict | **NOT-RIG-READY** — one blocking item (§F) |

**Navigation note.** The order says to use the graph to navigate. Graphify was
pip-installed into the previous VM and that VM was reprovisioned, so the tool
and the graph are gone (`graphify: command not found`). This pass navigated by
source and ripgrep instead. No claim is weakened by that — the graph was never
admissible as evidence, and every item below cites source or command output.

---

## A. Tree & identity

**A1 — PASS.** HEAD is a clean descendant of the tag, one commit ahead, and
that commit is the stamp only.

```
branch: integration/consolidated-current
HEAD:   21389e8ebe3936a573b292ad53c76a7ccd095f1b
tag:    f12c62626fb31024a314bb1068368e02fbb4a70f
tag-is-ancestor-of-HEAD exit:0
commits since tag: 1
  21389e8e chore(build): build047 stamp for the final rig build
origin tip: 21389e8ebe3936a573b292ad53c76a7ccd095f1b
git status --porcelain → (empty)
```

**A2 — PASS.**

- `graphify-out/` ignored — `.gitignore:46`; `git check-ignore -q` exit 0.
- `.cursor/*` state ignored — `.gitignore:52`; the hand-authored rule stays
  tracked: `git ls-files .cursor/` → `.cursor/rules/graphify.mdc`.
- No stray files. `git status --porcelain --untracked-files=all` → empty.
- `captures/` holds identity lists only: 5 tracked files, **0 `.json`**, 152 KB
  total. Header of `phase-5.after.txt` confirms the format (invocation, guard,
  counts, then identities).

One housekeeping note, disclosed rather than hidden: the D8 capture was written
to `code/preflight-native.json` exactly as the order specifies. That filename
is not covered by `code/.gitignore`, so it would have been a stray. It was
copied to `/tmp` and deleted; the tree is clean and nothing was committed.

## B. Build-graph sanity (static — builds NOT run)

**B3 — PASS.** All three surfaces present:

| Surface | Evidence |
|---|---|
| workspace dependency | `apps/extension-chromium/package.json:16` — `"@repo/shared-beap-ui": "workspace:*"` |
| vite alias | `apps/extension-chromium/vite.config.ts:22` |
| tsconfig path | `apps/extension-chromium/tsconfig.json:17` |

Supporting: `pnpm-lock.yaml:70,251` carry the workspace link;
`packages/shared-beap-ui/package.json` `main: src/index.ts` exists;
`apps/extension-chromium/node_modules/@repo/shared-beap-ui` is a live symlink.

**Same-module-specifier guard holds.** Exactly one definition of the component
(`packages/shared-beap-ui/src/ChannelProvenanceAlert.tsx`) and one definition of
the display rule, in that same file. All five consumers import the identical
bare specifier `@repo/shared-beap-ui` — three Electron surfaces, two extension
modules. No forked copy anywhere.

The one other occurrence of the rule-8 predicate shape is
`packages/ingestion-core/src/channelProvenance.ts:273` — that is
`channelAlertRequired`, the CANONICAL rule the display rule is deliberately
cross-checked against over the full verdict cross-product. It is the reference,
not a fork.

**B4 — PASS. Producer and consumer agree exactly.** Field lists extracted
mechanically and diffed:

```
consumer BeapInboxRow  19 fields
producer list          19 fields
producer getMany       19 fields
in consumer, NOT produced by list    : []
produced by list, NOT in consumer    : []
in consumer, NOT produced by getMany : []
produced by getMany, NOT in consumer : []
depackaged_metadata — consumer: true | list: true | getMany: true
```

The top rig risk is clear: the changed shape is coherent end to end.

**B5 — FAIL (one new error). Extension typecheck.**

Method: `npx tsc --noEmit -p apps/extension-chromium/tsconfig.json` at HEAD and
at the pre-Phase-5 commit `cd282eaf`, error lines normalised (line/col
stripped) and set-differenced. That establishes new-versus-pre-existing rather
than asserting it.

```
HEAD: 184 error lines   pre-Phase-5 baseline: 183
NEW at HEAD (1):
  apps/extension-chromium/src/beap-messages/components/BeapMessageDetailPanel.tsx:
  error TS2322: Type '{ dkim: { verdict: string; }; dmarc: { verdict: string; }; } | null | undefined'
  is not assignable to type 'ChannelProvenanceAlertRecord | null | undefined'.
GONE at HEAD: (none)
```

**Cause, source-verified.** Phase 5 typed the new field as
`channelProvenance?: { dkim: { verdict: string }; dmarc: { verdict: string } } | null`
(`beapInboxTypes.ts`), widening `verdict` to `string`, while
`ChannelProvenanceAlertRecord` requires the `ChannelAlertVerdict` union. The
panel line `BeapMessageDetailPanel.tsx:622` passes the former into the latter.

**Assessment, for the author's decision (not fixed, per the order).** Runtime
behaviour is correct — the only producer is
`channelProvenanceAlertRecordFromUnknown`, which emits union members or `null`.
The extension build script is `"build": "vite build"` (`package.json:8`) with no
`tsc -b`, so esbuild transpiles without typechecking and the rig build is
unlikely to fail on this. It is nonetheless a genuine defect introduced by the
last phase, in the exact plumbing flagged as the top rig risk, and it is a
one-line type change. Reported, not applied.

Pre-existing extension errors (183, unchanged) are concentrated in
`P2pOutboundDebugModal.tsx` (45), `depackagingPipeline.ts` (16),
`InputCoordinator.ts` (15), `sidepanel.tsx` (14), `PopupChatView.tsx` (13),
`background.ts` (6), `content-script.tsx` (5) and others. Not conflated with
the above.

**B5 — Workspace typecheck: PASS (no new class).** 475 errors, of which the
largest single identifiable class is 46 × `Cannot find module
'@repo/ingestion-core'`. Cause verified statically rather than assumed:
`packages/ingestion-core/package.json` points `main`/`types` at `./dist/…`, its
build script is `tsc`, and `packages/ingestion-core/dist` **does not exist** in
a fresh checkout — so the resolution fails until that package is built. Three
of those 46 are in Phase-4/5 files (`connectOfferStaging.ts`,
`offerPresentation.ts`, `wrcCrypto.ts`); they are new *occurrences* of a
pre-existing *class*, not a new class. Vitest resolves this via the root config
alias, which is why the suites are green.

## C. Invariant guards — wired, not merely green

**C6 — PASS.** Six named guard files, 66 tests, all green in one run. Each
guard proven to exist by name, not inferred from a green file:

`email/__tests__/provenanceGatesParsing.guard.test.ts`
- `the detector is called exactly once, and only inside the gate` (:34)
- `the CPR is produced before the detector is reached` (:46)
- `a provenance-failed message resolves to the same shape as found-nothing` (:53)
- `the quarantine path contains no plain-inbox fallback` (:79)
- `all three failure conditions hold instead of degrading` (:84)
- `the inline path holds on the same conditions the seam path already did` (:92)
- `trust verdicts are never computed in the guest` (:103)
- `the guest hands over material, not a verdict` (:115)
- `every consumer of guest packages is reached through the gated router` (:121)

Fail-open closures, in source: `DepackageCutoverHeldError` thrown at
`messageRouter.ts:806, 812, 836, 1095, 1101, 1195, 1215` (class at :1035).

Guest ruling, in source: no `computeChannelPass` / `evaluateChannelAuthentication`
call exists anywhere under `depackaging-microvm/`. The single textual match is a
comment at `displayEnvelope.ts:55` naming the host function to explain why there
is exactly one implementation.

Alert non-dismissibility is asserted against the SHARED component source —
`packages/shared-beap-ui/src/ChannelProvenanceAlert.test.ts:66,69` reads
`ChannelProvenanceAlert.tsx` itself.

Ingress fail-closed uses the `relay_code_claim` fixture —
`ingressCaptureMethodFailClosed.guard.test.ts:101,102,104,111`.

Epoch floor: `epochFloorHardening.test.ts:71` (`deleting the userData cache file
does NOT reset the floor`) and `:118` (`a forged cache file cannot make a
rolled-back head resolve`); schema v77 at `handshake/db.ts:1380`.

**C7 — PASS.** `resolution.dualChannel.test.ts:334`
`no production path reaches publisher trust without both channels`, containing
`the client consults DNS and the manifest on every resolution` (:335) and
`an unconfigured deployment refuses instead of resolving` (:355). Green.

## D. Full-workspace baseline

**D8 — PASS.** Sanctioned invocation only:
`pnpm test:native-db --reporter=json --outputFile=preflight-native.json`

```
testResults.length = 563   validity guard (>=100): PASS
numTotalTests      = 6115
numFailedTests     = 166   numPassedTests = 5892
identities         = 166
```

Identity-compared against the **committed** phase-5 after-set
(`captures/phase-5.after.txt`, 166):

```
NEW identities  = 0
GONE identities = 0
```

Identical. The environment was not reprovisioned since the Phase-5 pair, so no
re-take was needed — and the comparison ran against a committed artifact rather
than a `/tmp` file, which is exactly what the capture-persistence rule exists
for.

**D9 — PASS.** Dual-mode, both directions:

| Suite | Isolation | Full workspace |
|---|---|---|
| `beapInboxClonePrepare` | 15 passed | 0 failed / 15 passed |
| `beapInboxClonePrepareSealGate` | 8 passed | 0 failed / 8 passed |
| `b9OutboundCloneIntegrity` | 8 passed | 0 failed / 8 passed |
| `pr52CloneDeterminism` | 14 passed | 0 failed / 14 passed |
| `coordination-client` | 9 passed | 0 failed / 9 passed |

## E. Rig-boundary manifest

**E10 — cannot be proven headlessly; the author's manual pass must cover:**

1. **`expected_preview_hash` computed from the actual render.** The hash input
   and its coverage are tested (Phase-4 suite); that the value passed to
   `handshake.consentToOffer` is derived from the rendered surface is UI wiring
   and is unverified here.
2. **Offer and consent-preview pixels** — that the surface appears beside the
   mail view, shows publisher / verified domain / offered entry / session-bound
   marker, and carries the audit link.
3. **MV3 extension build with the new alias** — `vite build` resolving
   `@repo/shared-beap-ui` through the crx/MV3 pipeline. Static resolution is
   confirmed (B3); the bundler run is not.
4. **The alert rendering identically on all three surfaces** — `EmailMessageDetail`,
   `LinkWarningDialog`, `BeapMessageDetailPanel`. One component is proven by
   source; identical *rendering* is a visual check.
5. **Electron app build and launch**, `[RUNTIME_IDENTITY]`, and the extension
   load/reload cycle.
6. **Cross-device handoff** is out of this slice by the order (render-and-capture
   only); listed so it is not assumed covered.

**E11 — `integration-pending`, verbatim (six items):**

1. Live resolve round-trip against a running WRC instance.
2. Live audit round-trip: `GET /v1/audit/{hash}` returning the byte-identical
   object (acceptance h).
3. Live CatalogHead rollback rejection against a real service (f) — proven here
   against the double.
4. Live suspended entry with a working audit link (g) — proven against the
   double.
5. Live delegation audit round-trip against
   `GET /v1/publishers/{part}/delegations` (v1.1 §B). Delegation *verification*
   is no longer pending: it never fetches.
6. Registry placement confirmation (D2 default STANDALONE) at deployment.

Without a WRC instance, items 1–5 leave the live-service legs of the resolution
chain untested. Everything above them — verification logic, the divergence
matrix, epoch/freshness/suspension handling — is proven against the
contract-faithful signing double.

## F. Verdict

**NOT-RIG-READY** — one blocking item: the new `TS2322` in
`BeapMessageDetailPanel.tsx:622`, caused by `BeapMessage.channelProvenance`
being typed with `verdict: string` instead of the `ChannelAlertVerdict` union
(§B5). Runtime is unaffected and `vite build` does not typecheck, so the rig
build would very likely succeed regardless — the block is on tree coherence in
the exact plumbing flagged as the top rig risk, and the correction is one line.
Everything else in A–E passes.
