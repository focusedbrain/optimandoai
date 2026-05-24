# Phase B — Deferred Items

The following items were scoped out of Phase B during its execution and are **not** closed
by Phase B's final hardening (B-11). They remain operational or product concerns to be
addressed in subsequent work. Each item references the decision or audit entry that
established the deferral.

---

## B-10 — UI hardening

**Status:** deferred per canon owner decision; addressed during testing session.

Items deferred from B-5.1 spec:

| Item | IPC/signal state | Deferral note |
|------|-----------------|---------------|
| Renderer-side info box "Sandbox orchestrator required" | `ipcMain` event fires; no renderer listener wired | B-5.1 specified; handler fires, renderer silently ignores |
| "Set Up Sandbox Orchestrator" button | IPC surface present | B-5.1 specified; not surfaced in renderer |
| Quarantine message status indicators (quarantined / failed / cloning) | State exists in DB | Not propagated to UI; render pass needed |
| `cloneToSandbox` button state reflection after clone | Clone tracking column written | Renderer does not reflect `cloned_to_sandbox_at` |
| Pagination-after-mutation scroll preservation | N/A | UX debt surfaced during B-8 renderer audit |

**Next step:** schedule during testing session; none of these affect the structural
seal property.

---

## QB_09 — Outbound queue retry count diagnostic

**Status:** deferred for separate diagnostic. Established in B-8.4a Question C.

`outboundQueue.backoff.test.ts` asserts fetch is called **2 times** under fake-timer
advancement. The live implementation calls fetch **10 times** (the retry-backoff loop
runs to exhaustion rather than stopping after 2). Two interpretations:

- **10-retry correct:** aggressive healing is intentional; the test expectation is stale.
- **Retry loop bug:** the drain loop should stop after a transient failure type; 10 is a
  regression.

**Decision required from canon owner:** determine whether 10-retry exhaustion under
timer-only advancement is correct behavior before tightening the test.

---

## Category 3 — Pre-Phase-B legacy test failures (~7 tests across 4 suites)

**Status:** pre-Phase-B legacy; not Phase B's responsibility. Tracked here for
visibility.

| Test file | Failing tests | Classification | Note |
|-----------|---------------|----------------|------|
| `internalInference/__tests__/hostAiRoutingCorrectness.regression.test.ts` | 2 | Cat 3 | Suite title documents "expected failures until resolver hardens"; resolver semantics decision outstanding |
| `internalInference/__tests__/internalInferenceService.test.ts` | 5 | Cat 3 | Host dispatch mocks; mirror of routing correctness debt |
| `internalInference/__tests__/internalInference.directHost.regression.test.ts` | 1 | Cat 3 | Sandbox host-chat entry-point matrix; pre-Phase-B |
| `handshake/__tests__/outboundQueue.backoff.test.ts` (QB_09) | 1 | Cat 3 / diagnostic | Retry count mismatch — see QB_09 entry above |

**Next step:** address as part of the inference resolver hardening work that the test
suites are already gated on. None of these failures indicate a sealed-storage structural
regression.

---

## TypeScript debt

**Status:** separate effort; not Phase B's responsibility to fix.

Counts established at B-8.3 baseline and confirmed unchanged at B-11 closure:

| Package | Error count | Classification |
|---------|-------------|----------------|
| `apps/electron-vite-project` | 327 | Pre-existing legacy (files untouched in Phase B carry the bulk) |
| `apps/extension-chromium` | 153 | Pre-existing legacy |

**Phase B residue:** zero errors introduced or left by Phase B PRs were identified
during B-11 categorization. The 327 + 153 count is the same baseline established before
Phase B started. All mechanical Phase B residue (e.g., missing allowlist entries,
import gaps) were fixed inline during the relevant PRs.

**Next step:** TypeScript cleanup is a standalone effort. Recommended approach: fix
per-package in order of fewest errors first, using `tsc --noEmit` as the gate.

---

## Buffer-restart recovery (extension Stage-5 retry buffer)

**Status:** tracked but not implemented. Established in B-5.1 design review.

When the extension Stage-5 retry buffer (`mergeExtensionDepackaged.ts`) has pending
entries at app restart, those entries are lost. The buffer is intentionally in-memory
only (B-5.1 design decision: no persistence to avoid a second sealed-storage surface
before the architecture is proven).

Two recovery paths:

1. **Persist buffer to sealed storage** — contradicts B-5.1 in-memory-only design;
   creates a new sealed row type outside Phase B scope.
2. **Rely on extension to resend Stage-5 data on reconnect** — the extension already
   re-emits Stage-5 payloads when the IPC session is re-established; this is the
   intended recovery path.

**Next step:** verify that the extension's reconnect flow correctly re-emits pending
Stage-5 data during the testing session. If reconnect does not re-emit, route to
canon owner for decision.

---

## Raw SELECT migrations (sealedQuery backlog)

**Status:** tracked as lint warnings; not Phase B's responsibility to bulk-fix.

The `beap-canon/no-raw-inbox-select` lint rule (introduced in B-11) emits **warnings**
(not errors) on raw `db.prepare(SELECT … FROM inbox_messages|quarantine_messages)` calls
in production code outside `sealed-storage/`. These reads return unverified content to
the renderer (UI display only; content is not propagated into new sealed rows), so they
are not structural bypasses of the seal mechanism.

Affected production files flagged at B-11 closure:

- `email/ipc.ts` (getMessage, toggleStar, getQuarantineMessages, etc.)
- `email/inboxOrchestratorRemoteQueue.ts` (queue reads)
- `email/sealedContentUpdate.ts` (seal-status pre-check read)
- `email/remoteDeletion.ts` (deletion-queue reads)
- `email/dashboardSnapshot.ts` (snapshot reads)

**Next step:** migrate each site to `sealedQuery()` in a follow-up pass. The lint
warning will track progress; when all sites are migrated the rule severity can be
escalated to `error`.
