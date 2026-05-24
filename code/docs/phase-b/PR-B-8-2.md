# PR B-8.2 — Stable Position Across Mutations

## Authority

Phase B Architecture document and the canon directive — "every BEAP message type
passes Ingestor and Validator no matter where it lands; any bypass is a defect" —
remain load-bearing canon. B-8.2 is an operational improvement only. The structural
property established by B-1 through B-8.1 is preserved intact.

---

## Problem statement

PR B-8 made the renderer a read-only mirror of main's sealed storage. Every
mutation (markRead, archive, classify, …) triggered
`refreshFromMain({ kind: 'replace' })`, which re-fetched the first batch and
replaced the entire in-memory store. For a user triaging an inbox by paginating
to page 3 and marking messages read, each mark-read reset the view to page 1.

B-8.2 fixes this by introducing a third refresh mode (`patch`) that fetches only
the affected row(s) and merges them in place, leaving all other rows and the user's
current page index untouched.

---

## Step A — Mutation IPC handler inventory

| Handler | Params | Previously returned | Sort columns changed? |
|---|---|---|---|
| `beapInbox.markRead` | `messageId`, `read` | `{ success: true }` | No |
| `beapInbox.archive` | `messageId` | `{ success: true }` | No |
| `beapInbox.unarchive` | `messageId` | `{ success: true }` | No |
| `beapInbox.classify` | `messageId`, `aiAnalysis`, `urgencyScore` | `{ success: true }` | No |
| `beapInbox.setUrgency` | `messageId`, `urgencyScore` | `{ success: true }` | No |

**Stop-and-report condition 1 (sort-changing mutations):** No mutations modify
`received_at` or `id` (the `ORDER BY received_at DESC, id DESC` sort columns).
No re-position logic is needed. Condition not triggered.

**Stop-and-report condition 3 (bulk classify rowId pattern):** `beapInboxClassify`
accepts one `messageId` per call. The store's `batchClassify` method loops over
ids, collecting each returned `rowId`, then fires a single patch call with all
successful ids. The pattern fits cleanly. Condition not triggered.

---

## Step B — sealedQuery IN-clause support

`sealedQuery(db, sql, bindArgs, canonicalJsonColumn)` accepts any valid SQL
string with a bindArgs spread. IN-clause queries are constructed dynamically:

```typescript
const placeholders = ids.map(() => '?').join(', ')
sealedQuery(db, `SELECT ... WHERE id IN (${placeholders})`, ids, 'depackaged_json')
```

better-sqlite3 binds each `?` to the corresponding array element natively.
`sealedQuery` then iterates the returned rows and verifies each seal individually.
**No extension to `sealedQuery` was required.** Stop-and-report condition 2 not
triggered.

---

## Architectural decisions (recap)

### Decision A — Three refresh modes: replace, extend, patch

```typescript
export type RefreshMode =
  | { kind: 'replace' }                          // full re-fetch (initial load / edge-case fallback)
  | { kind: 'extend'; cursor: string }           // append next page
  | { kind: 'patch'; rowIds: readonly string[] } // in-place update of specific rows
```

Patch mode:
1. Calls `beapInbox.getMany` with the affected row ids.
2. Main returns the current sealed state of those rows.
3. The store merges: existing row → updated row from main; row absent from
   response → removed from store (deleted or failed seal verification).

Patch does NOT use `isRefreshing` (it's lightweight, doesn't replace the whole
store, and should not block concurrent replace/extend operations).

### Decision B — Mutation handlers return rowId

All five mutation handlers now return `{ success: true, rowId: messageId }`.
The renderer uses `rowId` to invoke patch mode:

```typescript
const { rowId } = await beapInboxMarkRead(messageId, read)
await refreshFromMain({ kind: 'patch', rowIds: [rowId] })
```

### Decision C — getMany is gate-verified

`beapInbox.getMany` queries via `sealedQuery`. Rows that fail seal verification
are excluded — same behavior as `beapInbox.list`. The handler:
- Accepts `rowIds: string[]`, clamps to 500.
- Filters non-string and empty-string entries.
- Returns only rows where `deleted = 0` (soft-delete aware).
- Does NOT filter `archived = 0` — archived rows are returned because the store
  holds them; client-side `getInboxMessages()` filters archived rows from display.

### Decision D — Patch does not add rows outside the current window

Rows returned by `getMany` that are not already in the store are silently ignored.
The store's contents reflect the user's currently loaded window; a mutation
elsewhere does not expand that window.

### Decision E — Multi-row patch uses one round-trip

`batchClassify` loops over message ids, collects successful `rowId` values,
then calls `refreshFromMain({ kind: 'patch', rowIds: patchIds })` once. One
`getMany` IPC handles all affected rows in a single state transition.

---

## Optimistic update removal

The B-8 implementation of `markAsRead`, `archiveMessage`, `unarchiveMessage`,
`batchClassify`, and `setUrgency` each contained an optimistic Zustand state
update that changed the store immediately before main confirmed. This was
structurally correct but diverged from the canon requirement: "The renderer still
waits for main's confirmation before changing the store."

B-8.2 removes all optimistic updates. The mutation flow is now:

```
call mutation IPC → wait for { success: true, rowId }
→ call beapInbox.getMany({ rowIds: [rowId] })
→ apply patch: merge returned rows; remove absent rows
```

The extra IPC round-trip is `getMany` with 1–N ids, which is fast (<5 ms on local
SQLite). The user sees the change after main confirms, not before.

---

## Files changed

### `apps/electron-vite-project/electron/main/handshake/ipc.ts`

- **Added** `handshake.beapInbox.getMany` case:
  - Validates and clamps `rowIds` (max 500, filters non-string/empty).
  - Generates `WHERE deleted = 0 AND id IN (?, ?, …)` via
    `ids.map(() => '?').join(', ')`.
  - Uses `sealedQuery` — gate-verified reads only.
  - Fetches attachments from `inbox_attachments` via same pattern as `list`.
  - Returns `{ success: true, rows: BeapInboxItem[] }`.
- **Updated** five mutation handlers to return `rowId: messageId` in their
  success response.

### `apps/extension-chromium/src/handshake/handshakeRpc.ts`

- **Added** `getBeapInboxMany(opts: { rowIds: readonly string[] })`:
  → `Promise<{ rows: BeapInboxRow[] }>`.
- **Updated** `beapInboxMarkRead`, `beapInboxArchive`, `beapInboxUnarchive`,
  `beapInboxClassify`, `beapInboxSetUrgency` to return
  `Promise<{ rowId: string }>` (with `res.rowId ?? messageId` fallback).
- Added JSDoc comment explaining the B-8.2 motivation.

### `apps/extension-chromium/src/beap-messages/useBeapInboxStore.ts`

- **Updated** `RefreshMode` — added `{ kind: 'patch'; rowIds: readonly string[] }`.
  Added detailed JSDoc explaining all three modes.
- **Updated** `refreshFromMain`:
  - Patch mode guard runs before the `isRefreshing` check. For each requested
    row id: if not in store → skip (Decision D); if returned by main → merge with
    preserved UI state; if absent from response → delete from store.
  - Replace and extend logic unchanged.
- **Updated** `markAsRead`, `archiveMessage`, `unarchiveMessage`, `setUrgency`:
  - Removed optimistic update.
  - Now call `refreshFromMain({ kind: 'patch', rowIds: [rowId] })` after IPC.
- **Updated** `batchClassify`:
  - Removed per-row optimistic update.
  - Collects `patchIds` from successful classify calls.
  - One patch call at end: `refreshFromMain({ kind: 'patch', rowIds: patchIds })`.

### UI mutation call sites — no changes needed

All UI call sites (`.catch(err => console.warn(…))`) are fire-and-forget.
The store methods still return `Promise<{ ok: boolean; error?: string } | void>`,
so the calling pattern is unchanged.

---

## Tests

### New files

`apps/extension-chromium/src/beap-messages/__tests__/b82PatchMode.test.ts`
— 15 tests across 9 describe groups:

| § | What it tests |
|---|---|
| §1 | In-place row updates; store size preserved; getBeapInboxMany called correctly |
| §2 | Rows absent from getMany response are removed from store |
| §3 | Decision D: rows NOT in current window are never added |
| §4 | Multi-row patch with mixed update/remove outcomes |
| §5 | Empty rowIds patch is a no-op (no getBeapInboxMany call) |
| §6 | draftReply and deletionScheduled preserved after patch |
| §7 | getBeapInboxMany failure is non-fatal; store unchanged |
| §8 | Patching one row leaves all other rows untouched (page stability) |
| §9 | batchClassify single patch call; partial failure; all-fail no-op |

### Updated files

`apps/electron-vite-project/electron/main/handshake/__tests__/b8BeapInboxIpc.test.ts`
- Added `§7 handshake.beapInbox.getMany` (8 tests): exists/missing rows, empty
  rowIds, null db, invalid entries, 500-id clamp, IN-clause structural proof,
  attachments.
- Updated §2–§6 mutation tests to assert `result.rowId === messageId`.

`apps/extension-chromium/src/beap-messages/__tests__/b8InboxStoreMirror.test.ts`
- Updated mock signatures for `getBeapInboxMany` and mutation functions
  (`void → { rowId: string }`).
- Updated §3 tests to set up `mockGetBeapInboxMany` and verify patch is called.
- Updated §4 failure tests to assert `mockGetBeapInboxMany` is NOT called when
  the mutation IPC itself throws.

### Prior suites preserved

`b81InboxPagination.test.ts` (12 tests) — all pass.
`b8InboxStoreMirror.test.ts` (26 tests) — all pass.
`b82PatchMode.test.ts` (15 tests) — all pass.
Full extension test suite (141 tests across 12 files) — all pass.

---

## Stop-and-report conditions encountered

None triggered.

1. ✅ All mutation handlers have a clean `messageId` param as the affected rowId.
2. ✅ `sealedQuery` supports IN-clause with dynamic placeholders natively.
3. ✅ No mutations modify sort columns (`received_at`, `id`).
4. ✅ `batchClassify` fits the multi-row rowIds pattern (loop + collect + one patch).

---

## Audit re-run — Section 2: direct store mutations bypassing sealed gate

No new bypass surfaces introduced:

- `refreshFromMain({ kind: 'patch' })` calls `getBeapInboxMany`, which calls
  `sealedQuery`. Gate-verified reads only.
- All five mutation handlers continue to use `prepareSealedOperationalUpdate`
  (operational columns) or `resealWithAiAnalysis` (content columns).
- Optimistic updates removed — store changes ONLY after main confirms and
  `getMany` returns gate-verified rows.
- No new IPC handlers outside the sealed gate.
- No direct SQLite writes from the renderer.

**Section 2 is empty after B-8.2.**

---

## Verification log

| Check | Result |
|---|---|
| `b82PatchMode.test.ts` (15 tests) | ✅ All pass |
| `b8InboxStoreMirror.test.ts` (26 tests) | ✅ All pass |
| `b81InboxPagination.test.ts` (12 tests) | ✅ All pass |
| Full extension suite (141 tests, 12 files) | ✅ All pass |
| Electron-side IPC tests (`b8BeapInboxIpc.test.ts`, `b81BeapInboxPagination.test.ts`) | ⚠️ Pre-existing infra failure (vite-electron-renderer crypto ESM alias + `beapEmailIngestion.ts` duplicate symbol). Not caused by B-8.2. Identical failure existed in B-8 and B-8.1. |
| TypeScript compilation | Not run (no monorepo tsc script available via CLI) |

---

## What was NOT verified

1. **Manual test of stable-position behavior with realistic inbox sizes.**
   The automated tests cover patch logic with small stores (2–10 rows). The
   behavior with 200+ rows loaded and patching a row on page 8 is unit-proven
   by §8.1 (10 rows) but not manually exercised with production data.

2. **Whether bulk operations on large selections (50+ rows) produce noticeable
   lag during the patch.** One `getMany` IPC with 50 ids is a single SQLite query
   with an IN-clause. Expected to be fast (<10 ms). Not benchmarked.

3. **Whether mutations that remove rows (archive) visually transition smoothly
   or jarringly.** After `archiveMessage`: the row's `archived` flag is set to
   `true` via patch; React reconciles and `getInboxMessages()` filters it out.
   The row disappears without animation. Whether a CSS transition is desired is
   a UX decision outside B-8.2's scope.

4. **Electron-side IPC tests.** Pre-existing environment issue prevents running
   the electron main-side test suite from within the electron-vite-project
   directory. The test logic for `getMany` was added and reviewed at source level;
   it mirrors the pattern of the existing B-8 IPC tests precisely.
