# PR: CPU Runaway Fix G2 — Batched `refreshFromMain` in P2P Pending Queue

## Diagnostic finding

Phase B's CPU runaway diagnostic identified **Candidate G2** as the
Phase-B-attributable cause of elevated CPU in the extension:

`processPendingP2PBeapQueue` called `refreshFromMain()` (default
`replace` mode) **once per item** in the processing loop.  With K items
pending:

- K serial IPC calls to main (`getBeapInboxMessages`).
- Each IPC call fetches up to 200 rows from sealed storage.
- Each response completely rewrites the Zustand store map.
- Combined with the 5 s poll plus the `P2P_BEAP_RECEIVED` push
  trigger, a burst of K pending items (e.g. after a reconnect) produces
  sustained, heavy work on the extension's JS thread.

B-8.2 introduced `patch` mode precisely to avoid this amplification
pattern: `refreshFromMain({ kind: 'patch', rowIds: [...] })` updates
only the affected rows in place without re-fetching the full store.

## What this PR changes

**`pendingP2PBeapQueue.ts` — one functional change:**

- The per-item `await refreshFromMain()` call is removed from inside
  the loop.
- A single `mergedRowIds: string[]` accumulator is declared before the
  loop.
- After a confirmed successful merge (`r.ok === true`), the item's
  `importResult.messageId` is pushed to `mergedRowIds`.
- After the full loop, if `mergedRowIds.length > 0`, a single
  `refreshFromMain({ kind: 'patch', rowIds: mergedRowIds })` call is
  issued.
- `cachePackage` stays in the loop — it is a cheap in-memory operation
  and its per-item placement is unchanged.

**Complexity reduction:** K×IPC×full-store-rewrite → 1×IPC×patch for
any batch size K.

## Decisions

### Decision A — Collect rowIds; single patch call after the loop

`importResult.messageId` is the `inbox_messages.id` sealed row
identifier returned by `importBeapMessage`.  It is non-null by the time
the code reaches the merge branch (the early `continue` guards both
`success` and `messageId`).  Only merges confirmed as `r.ok === true`
are collected — failed merges have no new sealed row to surface.

### Decision B — Patch mode unconditional; page-1 visibility caveat noted

Per B-8.2 Decision D, patch mode only updates rows already in the
loaded window.  If a new P2P arrival produces a row that belongs on
page 1 while the user is on page 5, the row does not appear until they
navigate back.

The previous replace-mode call would have reset the view to page 1 and
made the row immediately visible.  This behavior is **not** preserved by
this fix.

The trade-off is acceptable for the P2P pending queue: users typically
watch page 1 during active triage.  If the canon owner needs the
"new P2P arrival visible on page 1 immediately" UX, a targeted
replace-mode call conditioned on `received_at` position can be added in
a follow-up.

### Decision C — Failure modes and guards unchanged

- `globalProcessing = true / false` flow: unchanged.
- Per-item `try/catch`: unchanged.
- `ackPendingP2PBeap(item.id)`: unchanged, still called per item inside
  `verifyResult.success`.
- If all items fail to merge: `mergedRowIds` stays empty; the
  `refreshFromMain` call is skipped entirely (store already up to date).
- `refreshFromMain` rejection is swallowed with a `console.warn` (same
  pattern as before).

### Decision D — `usePendingP2PBeapIngestion` hook unchanged

The 5 s `setInterval` poll and the `P2P_BEAP_RECEIVED` push listener
are untouched.  The triggers are fine; the problem was the cost per
invocation of the processor.

## Files changed

| File | Change |
|------|--------|
| `apps/extension-chromium/src/handshake/pendingP2PBeapQueue.ts` | Batch patch refresh |
| `apps/extension-chromium/src/handshake/__tests__/pendingP2PBeapQueue.batched-refresh.test.ts` | New — 6 tests |

`usePendingP2PBeapIngestion.ts`, `useBeapInboxStore.ts`, and all other
files are **unchanged**.

## Stop-and-report conditions encountered

None.  `mergeDepackagedToElectron` does not return a rowId, but
`importResult.messageId` — available earlier in the same pipeline
branch — is the correct sealed row identifier and is already asserted
non-null before the merge branch is reached.

## Manual verification instructions (for the canon owner)

1. Re-enable the extension with this fix applied.
2. Simulate a burst: disconnect from the coordination WS, generate
   several P2P messages, then reconnect.
3. Watch CPU via Task Manager / Activity Monitor while the pending queue
   drains.
4. Expected: CPU spike is reduced or absent; a single IPC round-trip is
   visible in DevTools network panel rather than K separate requests.

**If CPU spike is gone:** G2 was the dominant cause.  G1 (WS reconnect
retry stacking) becomes lower-priority cleanup.

**If CPU spike persists but is reduced:** G2 contributes but G1 is also
active.  Proceed to the G1 fix PR.

**If CPU spike is unchanged:** a third cause not covered by the
diagnostic is active.  Disable extension; re-investigate with G2 fixed
as baseline.

## What was NOT verified

- **Whether re-enabling the extension with the fix produces acceptable
  CPU**: the canon owner verifies by re-enabling and observing real
  traffic.
- **Whether the "new P2P arrival visible on page 1 immediately" UX
  matters** (Decision B implication): the canon owner decides based on
  product requirements.
- **Whether G1 alone is sufficient to grill CPU even with G2 fixed**:
  determined by the canon owner after re-enabling.
- TypeScript compilation of the extension bundle end-to-end (not run in
  this PR; the change is localized to one file).

## Verification log

```
vitest run src/handshake/__tests__/pendingP2PBeapQueue.batched-refresh.test.ts

 ✓ §1 K items → single patch refresh (1 test)      PASS
 ✓ §2 all merges fail → no refresh (1 test)        PASS
 ✓ §3 partial merge failure → patch ids only (1)   PASS
 ✓ §4 globalProcessing guard (1 test)              PASS
 ✓ §5 refreshFromMain throws → swallowed (1 test)  PASS
 ✓ §6 cachePackage called per-item (1 test)        PASS

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  410ms
```

Full suite (63 test files): 58 passed, 5 failed.  All 5 failures are
pre-existing (vault/autofill DOM scanner tests that require a real
browser environment, plus a `@shared/handshake/policyUtils` alias
missing from the node test runner).  Zero new failures introduced.
