# B1 — CONSOLIDATED SPEC + ANSWERS Q1–Q5 (authoritative; replaces the never-delivered B1 ruling)

Context: you never received the original B1 ruling document — only your contradiction report and Amendment 1. This document is the complete, authoritative B1 specification, consistent with Amendment 1 (which you applied correctly in 9089e6db). Where your working assumption in (c) conflicts with this text, this text wins. Your §4 confirmation is accepted; commit 9089e6db is approved as-is.

## ANSWERS FIRST

**Q1 — the §2 spec.** Full operative text is §B below. **Your working assumption was inverted:** B1 cuts over **no** depackage/MIME work at all. B1 = the **validation legs only**: `validate-decrypted-beap` and `validate-native-beap`. The MIME-depackage cutover (raw provider mail → `depackage`) is a separate later build (B2) with its own analysis; do not touch it. Flag name and default: §B.3.

**Q2 — Site 2 (`processBeapPackageInline`).** You traced it correctly and missed nothing: it is pure pipeline-2. It was never meant to have its *decrypt* dispatched — that is deferred to the future `decrypt-qbeap` build. Site 2 IS in B1 scope, but only for the **validation call that runs after the decrypt** (`validatorOrchestrator.validate(...)` → `dispatch({kind:'validate-decrypted-beap'})`).

**Q3 — Site 1 (`messageRouter.ts:505–533`).** Same answer. The decrypt block at 505–533 stays byte-untouched. B1's target at Site 1 is the post-decrypt `validatorOrchestrator.validate(...)` call. Do NOT target any MIME-parse call site — that is B2, out of scope.

**Q4 — view-attachment workstation row.** Do **not** drop the row — it is INV-6-conformant; the INV-6 *wording* needs sharpening instead. Refine the doc text to: *key-requiring jobs execute at the key holder; remote routing is permitted precisely when it delivers the job TO the key holder; forbidden is any rule that would require key material to move.* Then annotate key-locality per kind:
- `decrypt-qbeap` → **consumer-local**: the handshake private keys are by definition local to the consuming orchestrator, so any remote/appliance rule would mean shipping keys → forbidden everywhere. (Your `supports() === false` on RemoteHandshakeExecutor stands.)
- `view-attachment` → **custody-holder-local**: the artifact's custody private key lives at the sandbox (the depackage-time custody target). The workstation row routing view-attachment remote-to-sandbox routes the job to the key holder — legal and intended (it is placement-matrix topology (c)). Appliance rules for view-attachment are illegal (the appliance is content-key-less).
Add an `keyLocality` annotation on the kind metadata and encode the guard per Q5.

**Q5 — structural validation.** Yes, encode it now; the table validator is the structural memory of these invariants. `validateResolutionTable` must enforce:
1. (absolute, INV-1) `workstation → in-process` rejected for the untrusted-content kinds: `depackage`, `open-link`, `view-attachment`. No marker can legalize it.
2. (transitional, INV-1 refinement) `workstation → in-process` permitted ONLY for `validate-decrypted-beap` and `validate-native-beap`, ONLY when the rule carries `transitional: true`. Tracking note in the table source: transitional rules are deleted when Build C topology routing + fetch relocation land.
3. (INV-6 guard) reject any rule resolving `decrypt-qbeap` to `remote-handshake` or placing it on an appliance context; reject any `view-attachment` rule on an appliance context; `view-attachment → remote-handshake` from workstation is legal (custody holder).
Add validator tests for each rejection and each permitted case.

## §B — B1 OPERATIVE SPEC (the cutover)

### B.1 Prerequisite commit (before any call-site change)
Add the transitional workstation rules to the table: `validate-decrypted-beap` and `validate-native-beap` on `role=workstation` → `in-process`, `transitional: true` (replicating today's reality: the forked validator subprocess / pure validateCapsule on the host). Implement the Q5 validator refinement + tests in the same commit. Without this rule, flag-on dispatch on current machines fails `E_NO_EXECUTOR` — the rule is what makes B1 runnable while neither regressing nor overstating today's isolation.

### B.2 Cutover sites (trace first, list exact sites in the report, then change)
1. **`validate-decrypted-beap`** — replace the inline `validatorOrchestrator.validate(...)` calls on the post-decrypt path with `dispatcher.dispatch({kind:'validate-decrypted-beap', ...})`: in `messageRouter.ts` (after the 505–533 decrypt block) and at the `processBeapPackageInline` convergence in `beapEmailIngestion.ts`. The InProcessExecutor reaches the same forked `validator-process`, so parity is byte-identical by construction.
2. **`validate-native-beap`** — replace the `validateCapsule` invocation on the wire path (`ingestion/ingestionPipeline.ts`, `processIncomingInput`) with a dispatch of that kind. If tracing reveals multiple call sites, cut over the pipeline entry point, not each leaf; list whatever you find.
3. **Untouched:** the qBEAP/pBEAP decrypt blocks (future `decrypt-qbeap` build); all MIME/raw-mail parsing (B2); extension Stage-5; clone path; sealing (stays host-side exactly as today, INV-2).

### B.3 Flag
`WRDESK_SEAM_VALIDATION_CUTOVER` (env) + persisted config key `seamValidationCutover`. Default **OFF**. Original inline code paths remain intact behind the flag — no deletion in B1.

### B.4 Behavior requirements
1. Flag off → byte-identical behavior, zero diff in suites.
2. Flag on (in-process, transitional rule active) → byte-identical parity on the corpus: same `ValidationResult`/seal outcome, same `inbox_messages`/`quarantine_messages` content, same attachments. jobIds/timestamps/signatures may differ.
3. Error mapping: dispatcher errors (`E_NO_EXECUTOR`, timeout, `E_SAFETEXT_REJECTED` n/a here, `E_ROLE_FORBIDDEN`) map onto existing failure handling — quarantine with reason code or the transport's existing retry; never an unvalidated insert; never a silent drop. Document the mapping table.
4. INV-5 logging at all touched sites (jobId/kind/executor/duration/outcome only; remove or gate any existing log that prints decrypted/canonical JSON in the touched blocks).
5. Quarantine pairing and clone-gesture regression suites green with flag on.
6. Small conventional commits; each leaves the branch working with the flag off.

### B.5 Proof obligations
1. Flag off: full email + ingestion suites green.
2. Flag on: parity corpus green (extend Build A's corpus with wire-path fixtures for `validate-native-beap`).
3. Fail-closed: test-only table without the transitional rules → flag-on dispatch yields `E_NO_EXECUTOR` → mapped to quarantine/retry; the inline path is never entered as a fallback; nothing inserts unvalidated.
4. Final report: exact call sites changed, error-mapping table, parity evidence, validator-refinement diff (Q5), INV-6 wording diff (Q4), deviations with rationale.

Proceed: Q4+Q5 changes and B.1 as the first commits, then B.2. If anything in this document contradicts what you find in the code, report before absorbing.
