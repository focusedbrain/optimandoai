# Sent Context Blocks Missing from Context Graph — Root Cause Analysis

**Date:** 2025-03-14  
**Bug:** After a successful handshake (ACTIVE), the handshake detail shows "1 Context Item · 1 Public · 0 Private · 0 Sent · 1 Received". The SENT block is missing when filtering by "Sent"; sidebar shows "1 block" but Context Graph shows (0) for Sent.

---

## 1. How context blocks are tagged as "sent" vs "received"

**Table:** `context_blocks` (not `context_store`)

**Column:** `source TEXT NOT NULL CHECK (source IN ('received','sent'))`

- **`source = 'received'`** — Block was received from the counterparty (ingested when we process their capsule)
- **`source = 'sent'`** — Block was sent by us (our own context)

**Key insight:** The UI reads from `context_blocks` via `queryContextBlocks()`. The `context_store` table is used only for the 3-phase delivery lifecycle (pending → pending_delivery → delivered → received) and does **not** have a `source` column. The UI never reads from `context_store`.

---

## 2. The insert path for OUR OWN context during acceptance

### What happens during accept (acceptor flow)

**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts` (lines 774–811)

1. **Initiator blocks** (from their initiate capsule): `insertContextStoreEntry` with `status: 'pending'`, `content: null` (stubs)
2. **Receiver blocks** (our blocks — profile + adhoc): `insertContextStoreEntry` with `status: 'pending_delivery'`, `content: contentStr`

**Critical:** `insertContextStoreEntry` writes to `context_store` only. The `ContextStoreEntry` interface and INSERT statement do **not** include `source`. The `context_store` table has no `source` column.

**Conclusion:** Our own blocks are stored in `context_store` for delivery (so they can be sent in the context_sync capsule). They are **never** inserted into `context_blocks` with `source = 'sent'`.

### When are blocks inserted into context_blocks?

**Only path:** `ingestContextBlocks()` in `contextIngestion.ts` — called from `enforcement.ts` when we **receive** a capsule (accept, initiate, refresh, context_sync).

```ts
// contextIngestion.ts line 112 — HARDCODED
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, 'pending', ?, ?, ?, ?)`
```

`ingestContextBlocks` always inserts with `source = 'received'`. There is no code path that inserts our own blocks into `context_blocks` with `source = 'sent'`.

---

## 3. How the Context Graph UI queries blocks

**Component:** `HandshakeWorkspace.tsx` (and `HandshakeQuickReview.tsx`, `HandshakeContextSection.tsx`)

**Query:** `window.handshakeView?.queryContextBlocks(record.handshake_id)`  
→ IPC `handshake:queryContextBlocks`  
→ `queryContextBlocks(db, { handshake_id })` in `contextBlocks.ts`  
→ `SELECT ... FROM context_blocks WHERE handshake_id = ?`

**Filter logic (HandshakeWorkspace.tsx lines 769–775):**

```ts
const filteredBlocks = blocks.filter((b) => {
  if (filter.direction !== 'all' && b.source !== filter.direction) return false
  // ...
})
```

- `filter.direction === 'sent'` → keeps only `b.source === 'sent'`
- `filter.direction === 'received'` → keeps only `b.source === 'received'`

**Counts (lines 789–790):**

```ts
const sentCount = blocks.filter(b => b.source === 'sent').length
const receivedCount = blocks.filter(b => b.source === 'received').length
```

**Root cause:** Our sent blocks are never in `context_blocks`, so `sentCount` is always 0 and the "Sent" filter returns no blocks.

---

## 4. Compare with Chrome extension flow

The extension uses the same handshake RPC layer. When running in Electron, `HandshakeWorkspace` and `queryContextBlocks` are in the Electron app. There is no separate extension-specific path for displaying context blocks — both use the same `context_blocks` table and `queryContextBlocks`.

**No shim is involved.** The bug is in the Electron main process: we never persist our own blocks to `context_blocks` with `source = 'sent'`.

---

## 5. The fix

**When:** When we build and enqueue our `context_sync` capsule in `tryEnqueueContextSync`, we have the list of blocks we are about to send. These are our "sent" blocks.

**Where:** `apps/electron-vite-project/electron/main/handshake/contextSyncEnqueue.ts`

**What:** Before `enqueueOutboundCapsule`, call `persistContextBlocks(db, handshakeId, blocks, 'sent', session.wrdesk_user_id)` to persist our blocks to `context_blocks` with `source = 'sent'`.

**Data mapping:** The `allowed` array (from `getContextStoreByHandshake(..., 'pending_delivery')`) has `block_id`, `block_hash`, `content`, `type`, `scope_id`, `publisher_id`. Map to `ContextBlockInput`:

- `payload` = `content` (string)
- `relationship_id` = `record.relationship_id`
- `handshake_id` = `handshakeId`
- `data_classification` = `'public'`
- `version` = `1`
- `visibility` = `'public'`

---

## 6. Fix applied

**File:** `apps/electron-vite-project/electron/main/handshake/contextSyncEnqueue.ts`

Before `enqueueOutboundCapsule`, added a call to `persistContextBlocks(db, handshakeId, toPersist, 'sent', session.wrdesk_user_id)` where `toPersist` maps each `allowed` block to `ContextBlockInput`. This ensures our sent blocks appear in `context_blocks` with `source = 'sent'`, so the Context Graph UI shows them when filtering by "Sent".
