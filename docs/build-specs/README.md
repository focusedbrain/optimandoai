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
| 0008 | [B2 build report](./0008-b2-build-report.md) | Phase-1 worker uplift + seam bridge done; verbatim rule list, mapping table, deviations; rig/Outlook-spike blocked, Phases 2–3 staged |

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
