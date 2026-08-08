# NAMED BACKLOG ITEM — “consolidation-inherited failures”

**Status: RESOLVED.** All 35 pinned identities are green in both isolation and
the full workspace; 0 new failures. See §7 “Remediation acceptance” for the
data, and §8 for what the remediation found and deliberately did not do. The
diagnosis below is preserved unchanged as the record it was ratified on.

---

**Status of the diagnosis pass (historical):** DIAGNOSIS ONLY — no fixes applied, none authorized.
**Ordered:** author ruling of 2026-08-08, point 3 — bounded diagnosis pass after
the `phase-2-complete` tag and before Phase 3 begins.
**Branch:** `integration/consolidated-current` (diagnosed at `a310cb96`).
**Why now:** `p2p/coordination-client` overlaps Phase-3 territory (resolution
infrastructure), where a permanently red suite could mask real regressions.

Every statement below is source-verified or reproduced by a run. Probes used to
obtain runtime evidence were temporary and deleted; the working tree is clean
and no test or product file was modified by this pass.

---

## 1. Headline correction to the name

Of the **35** failing identities in the five suites, only **29 are actually
consolidation-inherited**. The remaining **6 predate the consolidation
entirely** — they were already failing on `main` at `754e87e8`, before any
branch was merged. The backlog item keeps its name, but the two groups have
different owners and different fixes.

| Group | Count | Introduced at | Nature |
|---|---|---|---|
| **B** — consolidation-inherited | 29 | `dffec032` (merge of `cursor/graphify-knowledge-graph-c56a`, PR #7) | Single root cause, test-assumption |
| **A** — pre-existing main failures | 6 | predate `754e87e8` | Three distinct causes |

### Attribution method

The five suites were re-run at six points on the branch’s first-parent history.
Only the failure counts move; the suite set is identical.

| Commit | Description | Failures in the five suites |
|---|---|---|
| `754e87e8` | main + Order v1.0 (pre-consolidation) | 6 |
| `a155e097` | phase-2 branch tip (old baseline) | 6 |
| `a38e8cdc` | merge phase-2 into consolidation | 6 |
| **`dffec032`** | **merge #7 (`3442b5bc` — “fix(handshake): close three Host-AI / IPC authorization gaps”)** | **35** |
| `2a24cdba` | align #7 regression fixtures | 35 |
| `743fd75a` | consolidated tip before Phase-2 2B/2C work | 35 |

The step is a single commit wide. `dffec032` changed exactly three production
files: `handshake/internalSandboxesApi.ts`, `handshake/ipc.ts`, and
`internalInference/p2pDc/p2pDcCapabilities.ts` (plus its own regression tests
and the graph artifacts). Nothing under `email/`, `sealed-storage/`, or `p2p/`
changed in that merge — the breakage is behavioural, through
`internalSandboxesApi`.

---

## 2. Group B — 29 failures, introduced by `dffec032`

**Classification: TEST-ASSUMPTION (single root cause, all 29).**

| Suite | Failures |
|---|---|
| `pr52CloneDeterminism.test.ts` | 14 |
| `beapInboxClonePrepare.test.ts` | 11 |
| `beapInboxClonePrepareSealGate.test.ts` | 2 |
| `b9OutboundCloneIntegrity.test.ts` | 2 |

### Mechanism

PR #7 replaced the `local_role`-based host/sandbox role derivation in
`internalSandboxesApi.ts` with the canonical coordination-device-id derivation
`deriveInternalHostAiPeerRoles(record, getInstanceId())`, on the stated grounds
that “`local_role` is a per-device view that can disagree with the ledger”. The
new derive requires the local instance id to equal the record’s
`initiator_coordination_device_id` or `acceptor_coordination_device_id`.

Every fixture in these four suites still encodes the retired model — they set
`local_role: 'initiator'` with `initiator_device_role: 'host'` /
`acceptor_device_role: 'sandbox'` and set **no coordination device ids at all**.

Reproduced directly (temporary probe, since deleted):

```
getInstanceId()          = "init-instance-11111111"
derive(fixture as written) = {"ok":false,"code":"POLICY_FORBIDDEN","reason":"device_id_not_in_handshake"}
derive(fixture + initiator_coordination_device_id = getInstanceId())
                           = {"ok":true,"localRole":"host","peerRole":"sandbox",...}
```

So `isLocalHostPeerSandbox` → false → `isEligibleActiveInternalHostSandboxRecord`
→ false → `prepareBeapInboxSandboxClone` returns not-ok → every
“prepare succeeds” assertion fails with `expected false to be true`.

### Judgement

The product is behaving as designed and failing **closed** on a device identity
it cannot place in the handshake — that is the authorization gap #7 set out to
close. No product defect is visible here. The fix is confined to the fixtures:
give them coordination device ids consistent with `getInstanceId()`, exactly as
`2a24cdba` already did for the #7 regression fixtures it did touch. These four
suites were simply missed.

**Risk if deferred:** low for correctness, high for signal. 29 permanently red
assertions in the clone-prepare path mean any *real* regression there is
invisible.

---

## 3. Group A — 6 failures, predating the consolidation

These were failing on `main` at `754e87e8`. Last commits touching the files on
that line: `3008950e` (“Fix sandbox clone trusted read before sealedQuery; bump
build025”) for the seal-gate suite, `2e4f98b2` (“Symmetric P2P auth tokens,
backfill, and build83 stamps”) for the coordination client. They are not
attributable to any consolidation merge.

### A1 — three seal-gate failures: **TEST-ENVIRONMENT (harness schema drift)**

```
SqliteError: table inbox_messages has no column named validated_at
```

`test/harness/sealed-storage.ts` → `createHarnessDb()` builds a hand-rolled
in-memory `inbox_messages` schema that has never been given `validated_at` /
`validation_reason`, while `beapInboxClonePrepareSealGate.test.ts` INSERTs both
(lines 201, 299, 335). Production has the columns. Pure harness lag; two column
declarations. No product involvement.

### A2 — one seal-gate failure: **UNRESOLVED — product defect not excluded**

`native direct_beap vmk row + depackaged body + outer-only → prepare succeeds`
does not insert `validated_at`, so it is not the schema. Probed result:

```
{"ok":false,"code":"MESSAGE_NOT_FOUND","error":"Inbox message was not found or could not be verified."}
```

The row exists — `sealedQuery` returned nothing, i.e. seal verification rejected
the harness-built seal under the outer-only provider binding this test sets up.
Whether the harness seal builder or the product’s trusted-read path is wrong is
**not** decidable from this pass. This is the only item where a product defect
cannot be excluded from the evidence gathered. Note also that the returned code
conflates “not found” with “failed verification”, which is worth a look on its
own terms.

### A3 — `CC_06_outbound_via_relay`: **TEST-ASSUMPTION (asserts a retired capability)**

The test asserts that with `use_coordination: false` the outbound capsule goes
to a relay URL with a Bearer token. Probed drain result:

```
{"delivered":false,"queued":true,"code":"PREFLIGHT_FAILED","failure_class":"CONFIG_PERMANENT",
 "error":"Coordination relay required — direct-LAN P2P ingest is retired"}
```

The product deliberately retired that path and fails closed with a typed,
permanent config error. `fetch` is correctly never called. The test encodes a
capability that no longer exists; it should be rewritten to assert the refusal,
or deleted — not “fixed” by restoring the path.

### A4 — `CC_05b_coordination_merges_queue_handshake_id`: **TEST-ASSUMPTION, with a product question**

Probed drain result:

```
{"delivered":false,"error":"No pending capsule to process","queued":false}   fetchUrls = []
```

The queue is empty: `enqueueOutboundCapsule` accepted a capsule shaped
`{header, metadata, payloadEnc}` — no `schema_version`, no `capsule_type` — and
left nothing pending. The fixture no longer satisfies enqueue validation, which
is a test-assumption problem.

**Flagged for the author:** the enqueue returned without queueing and without
surfacing a typed rejection to its caller; the failure only becomes visible one
layer later as “No pending capsule to process”. Under the never-fails-silently
invariant that is a candidate product defect independent of the test. Not
investigated further in this bounded pass.

---

## 4. Isolation finding — this suite can produce a FALSE GREEN

`CC_05b` fails deterministically in isolation at **every** commit probed
(`754e87e8`, `a155e097`, `a38e8cdc`, `dffec032`, `743fd75a`), including when run
completely alone with `-t`. Yet in the old phase-2-branch full-workspace
baseline it **passed**, and in both consolidated full-workspace captures it
fails.

So its full-run outcome depends on which other files are scheduled alongside it.
The dangerous direction is the one observed: a genuinely broken test reported
**green** in a full-workspace run. Counting failures alone would not have caught
this; only the identity-set comparison did.

This bears directly on the author’s stated Phase-3 concern, and sharpens it:
the risk is not only that a permanently red suite masks a new regression, but
that this particular suite can also go falsely green. Both directions argue for
resolving A3/A4 before Phase 3 leans on this area.

---

## 5. Pinned failing identities (35)

Frozen at `a310cb96`. Any change to this set is a signal.

**Group B — introduced by `dffec032` (29)**

`b9OutboundCloneIntegrity.test.ts`
1. B-9 §1 — source read uses sealedQuery (Decision B) > §1.1 valid sealed row passes seal verification → prepare succeeds
2. B-9 §2 — no DB writes on the outbound prepare path (Decisions C / D) > §2.1 successful prepare writes nothing to inbox_messages

`beapInboxClonePrepare.test.ts`
3. 13: direct_beap with body_text succeeds and returns clone_reason sandbox_test
4. 13: email_beap with beap_qbeap_decrypted depackaging succeeds
5. 13: empty body still prepares clone (placeholder text)
6. direct_beap with session artefact uses native response path
7. email_beap depackaged mail without session uses email response path and plain extraction
8. email_plain with beap_package_json is accepted as received BEAP for prepare
9. external link flow: provenance encodes external_link_or_artifact_review and triggered_url
10. outbound depack qBEAP row can still be cloned (uses body/placeholder)
11. plain email (email_plain) is accepted for prepare
12. prepare succeeds when relay is down but sandbox_keying_complete (queued send path OK)
13. visible inbox row: unrelated account_id does not block prepare (list is the boundary)

`beapInboxClonePrepareSealGate.test.ts`
14. ledger row + outer-only provider → prepare succeeds
15. targetHandshakeId=auto picks sole sendable sandbox

`pr52CloneDeterminism.test.ts`
16. extractSourceSessionImportArtefact > test 1: valid artefact at canonical position is extracted correctly
17. extractSourceSessionImportArtefact > test 2: depackaged_json without artefact field → session_import_artefact null
18. extractSourceSessionImportArtefact > test 3: null depackaged_json → session_import_artefact null
19. extractSourceSessionImportArtefact > test 4: malformed JSON in depackaged_json → session_import_artefact null (no throw)
20. extractSourceSessionImportArtefact > test 5: artefact field is an array (not object) → session_import_artefact null
21. prepareBeapInboxSandboxClone (PR 5.2 assertions) > test 6: source row with artefact → prepare payload includes session_import_artefact
22. prepareBeapInboxSandboxClone (PR 5.2 assertions) > test 7: source row without artefact → payload has session_import_artefact: null
23. prepareBeapInboxSandboxClone (PR 5.2 assertions) > test 8: depackaged_metadata populated → available (column included in SELECT)
24. clone config body byte-equivalence > test 9: clone with source artefact — prepare payload carries session_import_artefact
25. clone config body byte-equivalence > test 10: clone without source artefact — prepare payload has no artefact, provenance in metadata
26. clone config body byte-equivalence > test 11: body contains no provenance — source body bytes pass through unchanged
27. End-to-end determinism > test 12: source artefact → clone → sandbox row's session_import_artefact bytes match source
28. End-to-end determinism > test 13: clone body byte-equivalence — body field passes through unchanged (no provenance)
29. End-to-end determinism > test 14: Option A — validation mark is NOT propagated; prepare yields no validated_at field

**Group A — predating the consolidation (6)**

`beapInboxClonePrepareSealGate.test.ts`
30. direct_beap sandbox-clone-of-plain vmk row + outer-only → prepare succeeds (trusted read) — A1
31. email_plain vmk row + body_text only (no depackaged_json) + outer-only → prepare succeeds — A1
32. email_plain vmk row + outer-only + conformant validation → prepare succeeds — A1
33. native direct_beap vmk row + depackaged body + outer-only → prepare succeeds (list-boundary trusted read) — A2

`coordination-client.test.ts`
34. CC_06_outbound_via_relay: use_coordination=false → outbound goes to relay URL with Bearer token — A3
35. CC_05b_coordination_merges_queue_handshake_id: BEAP message package POST includes top-level handshake_id — A4

---

## 6. Summary for the fix-vs-defer decision

| Item | Count | Class | Where the change would go | Product defect? |
|---|---|---|---|---|
| B | 29 | test-assumption | fixtures in 4 suites: add coordination device ids matching `getInstanceId()` | No |
| A1 | 3 | test-environment | `test/harness/sealed-storage.ts`: add `validated_at`, `validation_reason` | No |
| A2 | 1 | unresolved | harness seal builder **or** product trusted-read path | Not excluded |
| A3 | 1 | test-assumption | rewrite to assert the retired-path refusal, or delete | No |
| A4 | 1 | test-assumption | fixture capsule shape | Silent enqueue drop flagged separately |

No fixes were applied. The author decides fix-vs-defer per class.

---

## 7. Remediation acceptance

Author decision of 2026-08-08: fix all five groups as one bounded package,
“consolidation-inherited remediation”, on `integration/consolidated-current`.

### Commits

| Commit | Item | Change |
|---|---|---|
| `892bacf5` | A1 | `test/harness/sealed-storage.ts`: `validated_at`, `validation_reason` |
| `a5ad04b2` | B | Coordination device ids in the fixtures of three clone suites |
| `32996715` | A2 | Seal-gate suite rewritten to the contract it actually has |
| `c5447a40` | A3 + A4 | Retired-relay refusal pinned; enqueue result asserted; ambient orchestrator mode pinned and restored |

**No product code was changed by this package.** Every change is in tests or
the test harness.

### Dual-mode verification (mandatory for these suites)

Isolation — each suite run alone:

| Suite | Result |
|---|---|
| `beapInboxClonePrepare` | 15 passed |
| `beapInboxClonePrepareSealGate` | 8 passed |
| `b9OutboundCloneIntegrity` | 8 passed |
| `pr52CloneDeterminism` | 14 passed |
| `coordination-client` | 9 passed |

Full workspace — `pnpm test:native-db --reporter=json --outputFile=…`:

| | Pre-remediation `8089bb44` | Post-remediation |
|---|---|---|
| `testResults.length` (files) | 552 | 552 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 5,976 | 5,976 |
| `numFailedTests` | 201 | **166** |
| `numPassedTests` | 5,718 | **5,753** |

**Identity comparison: 35 removed, 0 new.** All 35 removed identities are the
pinned inherited ones; none elsewhere changed state. Remaining failures inside
the five suites in the full workspace: **0**. No A2-dependent remainder.

### Ambient-state robustness

Because the false green traced to ambient orchestrator mode, all five suites
were additionally run with the shared `orchestrator-mode.json` forced to
`sandbox` and to `host`: 45 passed in the four clone suites under each, and the
coordination suite passed under `sandbox` both as a whole and with `CC_05b`
alone. The coordination suite restores the ambient value it found, so it adds
no pollution of its own.

## 8. What the remediation found (and did not do)

### A2 — no product defect; the tests encoded a retired read path

`sealedQuery` picks the verification provider per row from `seal_key_source`:
`'ledger'` → outer, anything else → inner, with no fallback. The four cases
sealed rows with the inner key, tagged them `vmk`, unbound the inner provider,
and expected the read to succeed. No product change can satisfy that without a
verification bypass, and reject mode states there is none in any environment.
The commits these tests came from are named “Fix sandbox clone trusted read
**before** sealedQuery” — the pre-B-9 trusted read that “source read uses
sealedQuery (Decision B)” deliberately removed.

Three of the four are about content extraction per row shape, not key routing,
so they now seal per the product's own policy: `effectiveInboxRowSealKeySource`
returns `'ledger'` for every one of these shapes (two are `email_plain`, which
is never confidential; two are `direct_beap` on a non-confidential handshake).
The fourth asserted cloning a row with no canonical plaintext; it now pins the
refusal.

Also noted, not acted on: `verificationKeySourcesForInboxRow` declares a
two-provider policy (`['outer','inner']`) for non-confidential rows and is used
by `inboxSealedRead.ts`, but `sealedQuery` routes from `seal_key_source` alone.
The two do not agree. It changes nothing here — the seal bytes were made with a
key that was not available either way — but it is a real divergence between a
policy module and the gate that should share it.

### A4 — no silent drop; the never-fails-silently condition did not trigger

`enqueueOutboundCapsule` returns a typed `EnqueueOutboundCapsuleResult` on every
path and logs the refusal. The observed rejection was
`SANDBOX_DATA_EGRESS_FORBIDDEN`, correctly refusing a content-bearing
`message_package` from a node classified as sandbox. The authorized minimal
typed rejection was therefore **not implemented — it already exists**. The
silence was the test discarding the return value, which the test now asserts.

### NAMED FINDING — “test-isolation bidirectional risk”, root cause identified

Flagged only, per the ruling; recorded here because the mechanism turned out to
be concrete and cheap to state. `test/mocks/electron.ts` points `userData` at a
single shared `os.tmpdir()/vitest-electron-mock`, and `orchestrator-mode.json`
inside it **persists across test files and across whole runs**. Two suites write
it and neither restores it:

- `handshake/__tests__/pairingCodeRelayGap.rig.test.ts` → `mode: 'sandbox'`, `instanceId: 'init-instance-11111111'`
- `email/__tests__/userDataBootstrapPersistence.test.ts` → `mode: 'sandbox'`

Whichever ran last decides whether a later suite is an “effective sandbox node”
and may send outbound. That is why `CC_05b` was green in one full-workspace run
and red in isolation. The state also survives between runs, so a suite's result
can depend on a *previous* run. Not investigated further and not fixed beyond
making the coordination suite self-determining.

### NAMED ERROR-TAXONOMY ITEM — `MESSAGE_NOT_FOUND` conflation

`readInboxRowForClonePrepare` returns `MESSAGE_NOT_FOUND` (“not found or could
not be verified”) for three materially different states: the row is absent; the
row exists but `sealedQuery` filtered it (bad seal, wrong key source, no
provider); the row exists but carries no canonical plaintext column. Callers
and operators cannot tell a missing message from a tampered one from a
key-availability problem, and the diagnosis above needed a probe to establish
which had occurred.

**Remediation proposal (not implemented):** keep `MESSAGE_NOT_FOUND` for a
genuinely absent row and add two sibling codes — `SOURCE_UNVERIFIABLE` (present,
seal verification filtered it) and `SOURCE_NO_CANONICAL_CONTENT` (present, no
canonical plaintext to clone). The existing failure branches already
distinguish inner- and outer-vault unavailability, so this is the same pattern
extended to the two cases that currently collapse. User-facing copy can stay
identical where disclosure matters; the distinction is for logs, typed
handling, and tests.

### Discovered, reported, not implemented

- The seal-policy divergence in A2 above.
- The shared-userData isolation defect and its two writers.
- The error-taxonomy item and its proposal.
