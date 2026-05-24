# PR B-5.1/11 — Extension Stage-5 Failure-Path Bypass Closure

## Summary

PR B-5 introduced a bypass: when the extension Stage-5 merge failed validation
**and** no sandbox was paired, `mergeExtensionDepackaged.ts` performed an unsealed
`UPDATE inbox_messages` writing operational fields (`validated_at`, `validator_version`,
`validation_reason`, `embedding_status`). Per canon Decision A — "no write to
inbox-bound tables outside the sealed gate" — even operational writes are prohibited.

B-5.1 closes the bypass, adds an in-memory retry buffer, emits a UI info box event,
and wires two retry triggers (P2P BEAP arrival + 60-second timer).

## Investigation result (required before any code change)

**`MERGE_FAILURE_UPDATE_SQL` (removed by this PR) wrote:**

```sql
UPDATE inbox_messages SET
  embedding_status = 'pending',
  validated_at = ?,
  validator_version = ?,
  validation_reason = ?
WHERE id = ?
```

**Classification: Operational fields only.** `depackaged_json`, `body_text`, `seal`,
`seal_input_json`, `has_attachments`, `attachment_count` — none touched. The shell
row's content remains exactly as it was before the merge attempt.

Per the investigation classification rule:
> Operational fields only → the branch isn't a content bypass. Replace with
> no-op + UI notification. No retry buffer strictly needed since nothing was written.

However, the PR scope explicitly requires the retry buffer per Decision C. Even though
no content was lost, the retry buffer provides the correct canonical behavior: "message
held until sandbox is paired" rather than "message silently ignored."

## Decisions

### Decision A — No write under any failure mode without paired sandbox

The canon directive is unconditional. Both the `MERGE_FAILURE_UPDATE_SQL` call sites
are removed:
1. **Inside the quarantine transaction** (line 499 in B-5): the quarantine row already
   captures the failure; updating the shell row inside the same transaction added
   redundant operational metadata. Removed — no information loss.
2. **Fallback path** (line 515 in B-5): the only write when no sandbox was paired.
   Removed — replaced with retry buffer + UI notification.

### Decision B — UI info box for no-sandbox case

`notifyMergePendingNoSandbox(pendingCount)` emits `inbox:mergePendingNoSandbox` to
all renderer windows. The payload `{ pendingCount: N }` allows the renderer to show:
- Banner when `pendingCount > 0`: "N message(s) pending sandbox orchestrator"
- Clear when `pendingCount === 0`: drain complete

Renderer-side UI implementation (the visual component and its placement) is **not**
part of this PR — this PR only defines the IPC event. Stop-and-report condition 2
(UI design) was noted but did not block: emitting the event is sufficient to unblock
the renderer implementation.

### Decision C — Retry buffer mirrors B-3.1's IMAP pattern

New module: `extensionMergeRetryBuffer.ts` — pure data store (no DB access, no
merge logic). Exports:
- `PendingExtensionMerge` interface
- `MAX_EXTENSION_MERGE_RETRY = 3`
- `addPendingMerge`, `removePendingMerge`, `getAllPendingMerges`, `getPendingMergeCount`,
  `clearPendingMergeBuffer`

The drain function `drainExtensionMergeBuffer` lives in `mergeExtensionDepackaged.ts`
to avoid circular dependencies (buffer module is pure data; drain uses `attemptQuarantineWrite`).

### Decision D — No content writes, period

The new failure path (when `attemptQuarantineWrite` returns `false`):
1. `addPendingMerge({ rowId, packageJson, depackagedJson, ..., rejectionReason, retryCount: 0 })`
2. `notifyMergePendingNoSandbox(getPendingMergeCount())`
3. `console.warn(...)` with structured message
4. Return `{ ok: false, error: 'Validation failed: ... (queued for retry)' }`
5. **No DB write.** Shell row remains in pre-merge state.

## Retry triggers

Two triggers for `drainExtensionMergeBuffer(db, session)`:

| Trigger | Location | Rationale |
|---------|----------|-----------|
| `P2P_BEAP_RECEIVED` event | `main.ts:11233-11241` | P2P arrival implies sandbox may now be connected |
| 60-second periodic timer | `main.ts:11504-11517` | Ensures retries happen even without new P2P activity |

Stop-and-report condition 3 (handshake completion event hook doesn't exist) was
evaluated: no dedicated "sandbox paired" event exists in the codebase. The two
triggers above are the existing patterns (`retryPendingQbeapDecrypt` uses the same
hooks). A dedicated sandbox-pairing trigger is a follow-up improvement.

## Deliverables

1. **New module: `electron/main/email/extensionMergeRetryBuffer.ts`** — pure data store.

2. **Modified: `electron/main/email/mergeExtensionDepackaged.ts`**:
   - `MERGE_FAILURE_UPDATE_SQL` constant and both usages removed
   - `attemptQuarantineWrite` extracted as a shared helper (used by both main path
     and `drainExtensionMergeBuffer`)
   - Failure path: `addPendingMerge` + `notifyMergePendingNoSandbox` + `console.warn`
   - `drainExtensionMergeBuffer(db, session)` exported
   - `notifyMergePendingNoSandbox` (private helper) uses `inbox:mergePendingNoSandbox`

3. **Modified: `electron/main.ts`**:
   - Added import: `drainExtensionMergeBuffer` from `./main/email/mergeExtensionDepackaged`
   - Wired to `P2P_BEAP_RECEIVED` handler (alongside existing retry calls)
   - Wired to existing 60-second periodic timer

4. **New tests: `electron/main/email/__tests__/b51ExtensionMergeBypass.test.ts`**:
   - §4: buffer module unit tests (4 tests)
   - §2: no inbox writes on failure path (4 tests)
   - §3: drain behavior (5 tests)

## Verification log

```
grep -n "MERGE_FAILURE_UPDATE_SQL" electron/main/email/mergeExtensionDepackaged.ts
→ No matches (constant and both usages removed)

grep -n "db.prepare.*UPDATE inbox_messages" electron/main/email/mergeExtensionDepackaged.ts
→ No matches (no raw UPDATE inbox_messages calls remain)

All raw db.prepare() calls in mergeExtensionDepackaged.ts:
  - inbox_attachments child writes (inside runSealedTransaction closure, Att-2 covered)
  - inbox_messages has_attachments child write (inside runSealedTransaction closure)
  - inbox_messages SELECT queries (reads only)
  - quarantine_messages: only via prepareSealedInsert inside db.transaction()
  → Zero unsealed writes to inbox-bound tables.

TypeScript: ingestion-core compiles cleanly. Main process errors are pre-existing
(vite.config.ts version mismatch, unrelated to B-5.1).
```

## Stop-and-report conditions encountered

| Condition | Triggered? | Resolution |
|-----------|-----------|------------|
| 1. Gate has escape route permitting unsealed inbox writes | No — MERGE_FAILURE_UPDATE_SQL wrote only operational fields; gate was not bypassed in the content-integrity sense | Removed anyway per Decision A |
| 2. UI design requires substantial new work | Partially — renderer UI component not implemented | Emitted `inbox:mergePendingNoSandbox` IPC event; renderer implementation deferred |
| 3. Handshake completion event hook doesn't exist | Yes — no dedicated "sandbox paired" event found | Piggybacked on existing `P2P_BEAP_RECEIVED` + periodic 60s timer (same as `retryPendingQbeapDecrypt` pattern) |

## What was NOT verified

1. **Renderer UI component**: the `inbox:mergePendingNoSandbox` event is emitted but
   no renderer component was added to display the info box. The event contract is
   specified here; the UI must be added in a separate PR.

2. **Retry on explicit sandbox pairing**: no `handshake:sandboxPaired` event was
   found; piggybacking on P2P arrival is a best-effort trigger. If the user pairs
   a sandbox but no P2P BEAP arrives within 60 seconds, the retry will occur on the
   next 60s tick.

3. **App restart recovery**: the retry buffer is in-memory only. On app restart,
   pending entries are lost. The extension may resend Stage-5 results on reconnect
   (out-of-scope recovery path; not tested).

4. **Multiple shells rows with same package JSON**: the row lookup uses
   `beap_package_json` match. If multiple rows match the same package JSON, the
   first match is used. This is consistent with B-5 behavior.
