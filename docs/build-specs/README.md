# Build specs

Durable home for the build rulings, amendments, and closeouts that govern the
critical-job routing seam work. Documents are pasted/issued in chat and then
committed here verbatim so none can be lost. Files are numbered in the order
they became authoritative; later documents amend or supersede earlier ones where
they conflict.

## Index

| # | Document | Origin |
|---|----------|--------|
| 0001 | [Contradiction report](./0001-b1-contradiction-report.md) | Agent — blocking finding that stopped the original B (depackage) cutover |
| 0002 | [Amendment 1](./0002-b1-amendment-1.md) | Pipeline separation, INV-6 correction, kind rename (`validate-depackaged` → `validate-decrypted-beap`), `decrypt-qbeap` reserved |
| 0003 | [Consolidated B1 spec](./0003-b1-consolidated-spec.md) | Authoritative B1 scope + answers Q1–Q5 (validation-leg cutover only; MIME-depackage deferred to B2) |
| 0004 | [B1 closeout](./0004-b1-closeout.md) | Acceptance + three closeout tasks; soak/carry-forward notes |
| 0005 | [B2 analysis spec](./0005-b2-analysis-spec.md) | Email depackaging pipeline analysis brief (raw mail → `depackage` → BEAP capsule) — analysis only |
| 0006 | [B2 analysis report](./0006-b2-analysis-report.md) | Findings A–H, result/capsule contracts, build plan sketch, rig exit criteria, contradictions, ranked open questions |
| 0007 | [B2 build spec](./0007-b2-build-spec.md) | Binding rulings R1–R3 + INV-7; phased flag-gated cutover (`WRDESK_SEAM_DEPACKAGE_CUTOVER`, default OFF) |
| 0008 | [B2 code-complete report](./0008-b2-code-complete-report.md) | B2 status: **code-complete** (D4–D6 closed by `0012`). Commit map, flag-off evidence (exit crit. 1), verbatim rule list, typed union + taxonomy, mapping table, per-provider wiring, C4 summary, deviations, PENDING VERIFICATION (exit crit. 2–4) |
| 0009 | [B2 verification runbook](./0009-b2-verification-runbook.md) | V0–V7: rig Phase 0, guest re-verify, rig e2e (invariant-0 close), real-mail parity, Outlook `/$value` spike, no-KVM fail-closed, acceptance. Evidence → `0011`. Flag stays OFF until V7 |
| 0010 | [B2.1 remainder spec](./0010-b2.1-remainder-spec.md) | Build closing deviations D4 (provider-structured-json guest walker), D5 (residual orchestrator parse removal + `E_INLINE_PARSE_FORBIDDEN` guard), D6 (bundle uplift). Off-rig; flag stays OFF. Report → `0012` |
| 0012 | [B2.1 remainder report](./0012-b2.1-remainder-report.md) | **Code-complete, NOT accepted.** Closes D4–D6: shared depackage model + guest walker + equivalence corpus (D4), inline-parse guard + finding-A checklist (D5), bundle uplift + hash (D6). Restores B2's honest "code-complete" claim; V-series (`0009`) still gates acceptance |
| 0013 | [B2.2 envelope-clean spec](./0013-b2.2-envelope-clean-spec.md) | Build removing the last orchestrator-side parse retained flag-on (IMAP/Gmail envelope-metadata parse, deviation `0012` §3.1) so the V-series yields an **unqualified** invariant-0 claim. In-guest display envelope + provider-native bookkeeping + guard extension to headers. Off-rig; flag stays OFF. Report → `0014` |
| 0014 | [B2.2 envelope-clean report](./0014-b2.2-envelope-clean-report.md) | **Code-complete, NOT accepted.** In-guest `displayEnvelope` (RFC 2047 decode, caps, degradation) + in-guest `threadingHints`; flag-on IMAP `BODY[]`-only / Gmail `format=raw`-only bookkeeping; header-parse guard (invariant-0 surface now complete); envelope+threading parity corpus; bundle `f7310ffd…` (supersedes `cb04ae51…`). Threading audit + notification-delta recorded. V-series (`0009`) still gates acceptance |
| 0015 | [B2.2 acceptance + triage](./0015-b2.2-acceptance-and-triage.md) | **B2.2 rulings:** deviation #2 (`threadingHints`) APPROVED (correct application of 0013 §2.2); notification-ordering delta SIGNED OFF (security-aligned: notifications show attacker content only post-isolation-boundary). B2/B2.1/B2.2 jointly code-complete, V-series sole gate. **Part 2:** off-rig test-debt triage of the 28 pre-existing failures → report `0016` |
| 0016 | [Test-debt triage report](./0016-test-debt-triage-report.md) | Triage (not refactor) of the 28 pre-existing whole-repo failures: classification table (stale / broken / env-timing / orphaned), cheap fixes applied, class-(b) broken-code register, and the **`internalInference` plumbing verdict** gating Build C |
| 0017 | [Build C spec](./0017-build-c-spec.md) | **Build.** `critical_job_*` handshake service-message family + receiving-side gate & sovereign re-dispatch + `RemoteHandshakeExecutor` + topology persistence in `orchestrator-mode.json`. Activates the workstation resolution rows. Off-rig (mocked/loopback proofs); real two-machine verification deferred to the W-series. No new live behavior without explicit topology config. Report → `0018` |
| 0018 | [Build C report](./0018-build-c-report.md) | Commit map, Phase 0 hang verdict (shared vs inference-specific), refusal-test evidence, round-trip evidence (mocked + loopback), and deviations |
| W | [W-series runbook](./0019-w-series-runbook.md) | Deferred two-machine acceptance runbook (Windows workstation + mini-PC sandbox): W1 pairing+topology, W2 remote `depackage` of a real email, W3 link-down fail-closed, W4 oversize/replay refusals. Joins the V-series as B-track evidence; does not block Build C landing |

## Where B1 landed in code

- Seam vocabulary / kind rename: `code/apps/electron-vite-project/electron/main/depackaging-microvm/hypervisorProvider.ts`, `.../critical-jobs/types.ts`
- Resolution table + structural validator (Q5): `.../critical-jobs/resolution.ts`
- Feature flag (`WRDESK_SEAM_VALIDATION_CUTOVER` / `seamValidationCutover`): `.../critical-jobs/featureFlags.ts`
- Live-path adapter: `.../critical-jobs/liveValidationCutover.ts`
- Cutover sites: `messageRouter.ts` (post-decrypt), `beapEmailIngestion.ts` (confidential path), `ingestionPipeline.ts` (Stage-2, also covers file-import ingress per ENTRYPOINT_AUDIT)
- Proof: `.../critical-jobs/__tests__/cutoverParity.test.ts` (flag parity + fail-closed), `.../cutoverParity.devbox.test.ts` (real-subprocess parity)

## Appendix — B.5.2 dev-box parity run (RESULT, appended per task 1)

Executed flag-on, end-to-end `validate-decrypted-beap` parity against the **real
validator subprocess** (no mock) on the dev box. The test boots the same
singleton `validatorOrchestrator` the seam dispatches to (test vault, forked
`tsx` subprocess) and, over an accept/reject corpus, compares the seam's
`ValidateResponse` to the inline `validatorOrchestrator.validate` call.

- Test: `code/apps/electron-vite-project/electron/main/critical-jobs/__tests__/cutoverParity.devbox.test.ts`
- Corpus: valid `internal_draft`, valid `initiate`, missing-`schema_version` (reject), non-JSON garbage (reject)
- Criteria: identical accept/reject verdict; **byte-identical validated `canonical_json`** on accepts; identical `rejection_reason` on rejects. Per-call seal nonce, `request_id`, and timestamps differ and are excluded (lifecycle L5: identical input → different nonces).
- Result: **5/5 passed** (liveness check + 4 corpus cases). Seam log lines confirm `kind=validate-decrypted-beap executor=in-process ok=true`, i.e. routing went through the live validator.

```
✓ cutoverParity.devbox.test.ts (5 tests)
  Test Files  1 passed (1)
       Tests  5 passed (5)
```

Conclusion: with the real validator running, the seam path is byte-identical to
the inline path on the validated content. B.5.2 satisfied.
