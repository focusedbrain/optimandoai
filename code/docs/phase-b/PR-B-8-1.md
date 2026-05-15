# PR B-8.1 — Inbox Pagination for Infinite Scroll

**Prompt:** B-8.1 — Inbox Pagination for Infinite Scroll  
**Scope:** Operational extension of B-8's `beapInbox.list` IPC. Adds cursor-based pagination so the renderer's read-only mirror can load beyond the 200-row first batch. No structural changes — reads still go through `sealedQuery`.

---

## Step A Finding — Existing Handler

`handshake.beapInbox.list` in `electron/main/handshake/ipc.ts`:

```sql
SELECT ...
FROM inbox_messages
WHERE deleted = 0
ORDER BY received_at DESC
LIMIT ? OFFSET ?
```

- Default `limit = 200`, default `offset = 0`
- Sort: `ORDER BY received_at DESC` **only** — no tiebreaker for rows with the same millisecond timestamp
- Uses `sealedQuery` ✓ (gate-verified reads)

**Decision B (cursor shape):** Added `id DESC` as secondary sort key. UUIDs sort consistently as strings and provide a stable tiebreaker when two messages share the same `received_at`. Cursor encodes `{ t: received_at, i: id }` as base64url JSON.

No stop-and-report triggered: ORDER BY is clear and well-defined after adding the tiebreaker.

---

## Step B Finding — Lazy-Load Call Site

**No infinite scroll exists.** The bulk inbox uses client-side pagination:

```typescript
// BeapBulkInbox.tsx
const page = getBulkViewPage(batchSize, pageIndex)   // reads from in-memory store
onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
```

After B-8 with the 200-row cap, clicking "Next" on the last loaded page clamped to `totalPages - 1` and showed the same content — a silent dead end. Confirmed: worst case.

**Fix:** Intercept `onNext` when `pageIndex + 1 >= totalPages && hasMore`. In that case, call `loadMoreFromMain()` first, then advance `pageIndex`.

No stop-and-report triggered for any of the four conditions.

---

## Decisions A–E Recap

| Decision | Outcome |
|----------|---------|
| **A** — Cursor is opaque | Renderer sends/receives cursor strings; does not parse them |
| **B** — ORDER BY determines cursor shape | `ORDER BY received_at DESC, id DESC`; cursor = `{ t, i }` in base64url |
| **C** — Two modes: replace/extend | Implemented as `RefreshMode` union type |
| **D** — Mutations trigger replace | Existing callers already call `refreshFromMain()` (default = replace) after each mutation; no change needed |
| **E** — Default page size 200, max 1000 | `effectiveLimit = Math.min(limit ?? 200, 1000)` |

---

## Architectural Changes

### `handshake/ipc.ts` — `beapInbox.list` handler

**Before:** `LIMIT ? OFFSET ?` with `ORDER BY received_at DESC`

**After:**
- `ORDER BY received_at DESC, id DESC` (stable tiebreaker)
- Accepts `{ cursor?: string | null, limit?: number }` instead of `{ limit?, offset? }`
- Cursor is decoded inline with `decodeCursor()`; invalid/absent cursor → first-batch query
- Two query paths:
  - `cursor = null`: `WHERE deleted = 0 ORDER BY … LIMIT ?`
  - `cursor set`: `WHERE deleted = 0 AND (received_at < ? OR (received_at = ? AND id < ?)) ORDER BY … LIMIT ?`
- Returns `{ success, items, nextCursor }` where `nextCursor` is non-null iff `items.length === effectiveLimit`
- Max limit capped at 1000

### `handshakeRpc.ts` — client RPC

- New `BeapInboxListResponse` interface: `{ items: BeapInboxRow[], nextCursor: string | null }`
- `getBeapInboxMessages` signature: `(opts?: { cursor?: string | null; limit?: number }) => Promise<BeapInboxListResponse>`
- Old `{ limit?, offset? }` signature removed (backward-compat: callers with no args still work)

### `useBeapInboxStore.ts`

New exported type:
```typescript
export type RefreshMode = { kind: 'replace' } | { kind: 'extend'; cursor: string }
```

New state fields:
- `nextCursor: string | null` — tracks pagination position; `null` = all rows loaded

`refreshFromMain` signature: `(mode?: RefreshMode) => Promise<void>`
- **replace** (default): fetches `cursor = null`, replaces `messages` Map, sets `nextCursor`
- **extend**: fetches `cursor = mode.cursor`, appends new rows (skips already-present IDs), updates `nextCursor`

New method `loadMoreFromMain()`:
- If `nextCursor` is null: no-op
- If `nextCursor` is set: calls `refreshFromMain({ kind: 'extend', cursor: nextCursor })`

`getBulkViewPage` now includes `hasMore: boolean` (from `nextCursor !== null`) in its return value.

### `beapInboxTypes.ts` — `BulkViewPage`

Added `hasMore: boolean` field.

### `BeapBulkInbox.tsx`

- Subscribes to `loadMoreFromMain` from store
- Destructures `hasMore` from `getBulkViewPage` result
- `BatchToolbar` `hasMore` prop added (defaults `false`)
- Next button: `disabled={pageIndex >= totalPages - 1 && !hasMore}`
- Next button label: `'Load More →'` when `pageIndex >= totalPages - 1 && hasMore`, else `'Next →'`
- `onNext` handler: if at last loaded page and `hasMore`, calls `loadMoreFromMain().then(() => setPageIndex(nextIdx))`

---

## Stop-and-Report Conditions Encountered

1. **Existing handler doesn't have stable ORDER BY:** Not triggered — ORDER BY was present (`received_at DESC`). Added `id DESC` as tiebreaker.
2. **Lazy-load entangled with B-8 mutators:** Not triggered. The pagination is orthogonal to mutators; `getBulkViewPage` is a pure selector.
3. **Scroll-position preservation requires architectural changes:** Not triggered. `pageIndex` is React local state in `BeapBulkInbox.tsx`, not store state. Mutations trigger a replace refresh (store content resets to first 200 rows) but `pageIndex` is not reset by the store. If the user is past the now-loaded pages after a mutation, `getBulkViewPage` will show an empty page (clamped by `safePageIndex`). This is the accepted trade-off per Decision D.
4. **200 cap enforced downstream:** Not triggered. `getBulkViewPage` slices the in-memory messages Map; it has no independent cap.

---

## Tests

### `b81BeapInboxPagination.test.ts` (main process)

New test suite:
- §1 First batch: `nextCursor` non-null at limit, null below limit, null on empty
- §2 Cursor decoded and passed to `sealedQuery`; second call SQL contains cursor-predicate form
- §3 Last batch: `nextCursor` null when rows < limit
- §4 `limit` respected; clamped at 1000; defaults to 200
- §5 Malformed cursor handled gracefully (first-batch fallback, no crash)
- §6 `sealedQuery` called (not raw `db.prepare`) for `inbox_messages` reads

### `b81InboxPagination.test.ts` (extension renderer)

New test suite:
- §1 Replace mode: clears store, sets `nextCursor`, resets to null, calls with `cursor = null`
- §2 Extend mode: appends without replacing, preserves existing UI state on overlap, updates `nextCursor`
- §3 `loadMoreFromMain`: no-op when cursor null, extends with current cursor, propagates new cursor
- §4 `getBulkViewPage.hasMore`: false when null, true when set, transitions correctly

### Updated `b8InboxStoreMirror.test.ts`

- `mockGetBeapInboxMessages` mock type updated to return `BeapInboxListResponse`
- All `mockResolvedValue([...])` calls updated to `mockResolvedValue(mockList([...]))`
- `getStore()` reset includes `nextCursor: null`
- §1.6: verifies `nextCursor` is set from response
- §1.7: verifies `nextCursor` resets to null on subsequent replace

---

## Verification Log

| Check | Result |
|-------|--------|
| `beapInbox.list` uses `sealedQuery` (not raw `db.prepare`) for `inbox_messages` | ✓ |
| `ORDER BY received_at DESC, id DESC` in both query paths | ✓ |
| Cursor = base64url JSON `{t, i}` — no PII | ✓ |
| `nextCursor` null when `items.length < effectiveLimit` | ✓ |
| `limit` capped at 1000 | ✓ |
| `getBeapInboxMessages` returns `BeapInboxListResponse` | ✓ |
| `RefreshMode` exported from store | ✓ |
| `refreshFromMain()` default still `{ kind: 'replace' }` — backward compat | ✓ |
| `loadMoreFromMain()` no-op when `nextCursor === null` | ✓ |
| `getBulkViewPage` includes `hasMore` | ✓ |
| `BeapBulkInbox` Next button disabled when `!hasMore && onLastPage` | ✓ |
| `BeapBulkInbox` `loadMoreFromMain` wired to Next click | ✓ |
| `b8InboxStoreMirror.test.ts` updated to new response shape | ✓ |

---

## What Was NOT Verified

1. **Manual scroll test** — loading past row 200 in a running app with >200 messages was not verified. A manual smoke test by the canon owner is recommended.
2. **Performance with very large inboxes** — batches of 200 per page are fetched lazily; no pagination throughput testing was performed.
3. **Scroll position after mutation + replace** — mutations cause `refreshFromMain({ kind: 'replace' })` which resets the store to the first 200 rows. If the user was on page 18+ when a mutation occurs, after the refresh `getBulkViewPage` will return an empty page (the store no longer has those rows). The component's `safePageIndex` clamp will push the user to the last loaded page. Adding an explicit `setPageIndex(0)` after mutations was not done — it's a UX concern outside B-8.1's scope.
4. **Whether `loadMoreFromMain()` race-conditions with `refreshFromMain(replace)`** — both check `isRefreshing` before proceeding. If a mutation triggers a replace while a load-more is in flight, the second call will no-op (isRefreshing guard). The store will end up with the replace result. Considered acceptable.
5. **`limit` parameter wiring to UI** — no UI control exposes the `limit` parameter. All loads use the default 200.
