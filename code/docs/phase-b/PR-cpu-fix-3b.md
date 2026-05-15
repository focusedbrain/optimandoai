# PR: CPU Fix 3b — Correctness fixes to `drainExtensionMergeBuffer` call sites

## What this PR fixes

CPU Fix 3 (PR `cpu-fix-3`) removed a redundant 60s periodic drain call.
This follow-up patch fixes two correctness issues the code review surfaced:

### Issue 1 — Incorrect comment (vault unlock claim)

The comment added at the canonical 10s drain site incorrectly stated:

> "Event-driven drains (P2P_BEAP_RECEIVED, vault unlock) are fine"

Vault unlock does **not** call `drainExtensionMergeBuffer`. All three
vault unlock handlers (`L3083 dashboard IPC`, `L4932 ipcMain`, `L5839 WS RPC`)
call `completePendingContextSyncs` and `processOutboundQueue` on unlock
but none touch the merge retry buffer. The drain is only event-driven via
`P2P_BEAP_RECEIVED`.

**Fixed:** Comment updated at both the 10s canonical site and the
`setBeapRecipientPendingNotifier` callback.

### Issue 2 — Drain skipped when `processPendingP2PBeapEmails` rejects

Previously the three operations in `tryP2PStartup` and in
`setBeapRecipientPendingNotifier` were chained with `.then()`:

```typescript
// Before (vulnerable)
void processPendingP2PBeapEmails(handshakeDb).then((drained) => {
  if (drained > 0) notifyBeapInboxDashboard(null)
  void retryPendingQbeapDecrypt(handshakeDb).then(...)
  void drainExtensionMergeBuffer(handshakeDb, ...)  // ← skipped on reject
})
```

If `processPendingP2PBeapEmails` rejected, the `.then()` was never called,
silently skipping both `retryPendingQbeapDecrypt` and
`drainExtensionMergeBuffer` for that tick. The drain was also bare `void`,
meaning any rejection from it would be an unhandled promise rejection.

**Fixed:** Both sites refactored to failure-isolated `async` IIFEs:

```typescript
// After (failure-isolated)
void (async () => {
  try {
    const drained = await processPendingP2PBeapEmails(handshakeDb)
    if (drained > 0) notifyBeapInboxDashboard(null)
  } catch {}

  try {
    const r = await retryPendingQbeapDecrypt(handshakeDb)
    if (r > 0) notifyBeapInboxDashboard(null)
  } catch {}

  try {
    await drainExtensionMergeBuffer(handshakeDb, getCurrentSession() ?? null)
  } catch {}
})()
```

A failure in any one operation no longer prevents the others from running.
Every `drainExtensionMergeBuffer` call is `await`ed inside `try/catch`,
eliminating the unhandled rejection risk.

## What this PR does NOT do

- Does not resolve the heavy CPU / 85°C temperature issue. That requires:
  - Fix 1: gate `tryP2PStartup`'s heavy work to run only when state has changed
  - Fix 2: make `refreshEntitlements` conditional (not `force=true` every 60s)
- Does not add a single-flight guard to `drainExtensionMergeBuffer` (deferred).
- Does not modify `drainExtensionMergeBuffer` itself.
- Does not re-add the 60s drain (removed in CPU Fix 3, stays removed).

## Files changed

| File | Change |
|------|--------|
| `apps/electron-vite-project/electron/main.ts` | Fixed comment; refactored `.then()` chains to failure-isolated async IIFEs at two call sites |

## `drainExtensionMergeBuffer` call sites after this PR

```
L919   import statement
L11250 await inside try/catch — P2P_BEAP_RECEIVED event handler
L11367 await inside try/catch — 10s tryP2PStartup canonical tick
```

60s timer: zero drain calls (unchanged from CPU Fix 3).
No bare `void drainExtensionMergeBuffer(...)` calls remain.

## Verification log

```
vitest run (with patch)
  Test Files  146 failed | 104 passed (250)
  Tests  30 failed | 830 passed | 29 todo (889)

Baseline (without patch)
  Test Files  146 failed | 104 passed (250)
  Tests  30 failed | 830 passed | 29 todo (889)

Zero new failures.
Pre-existing failures: resolveSandboxInferenceTarget, hostAiRoutingCorrectness — unrelated.
```

## Targeted test — feasibility note

The prompt requested: "mock `processPendingP2PBeapEmails` to reject and verify
the drain still runs."

`tryP2PStartup` is a closure defined inside `app.whenReady()` in `main.ts` and
is **never exported**. It cannot be imported or directly tested. The `vi.mock`
path would require mocking the entire Electron runtime. This test is not
feasible for the production code path.

The correctness of the isolation change is verified by:
1. Code review of the IIFE pattern (trivially correct — sequential awaits with
   independent try/catch blocks)
2. Existing `b51ExtensionMergeBypass.test.ts` §3 tests passing, which cover
   `drainExtensionMergeBuffer`'s own semantics

## What was NOT verified

- Runtime CPU measurement. The 85°C temperature will not drop from this patch
  alone. The dominant contributors (forced Keycloak round-trip every 60s,
  unconditional heavy work in `tryP2PStartup` every 10s) are unaddressed.
- Live retry buffer behavior under concurrent `P2P_BEAP_RECEIVED` + 10s tick
  overlap (no reentrancy guard; benign in Node.js cooperative scheduling but
  not tested).
