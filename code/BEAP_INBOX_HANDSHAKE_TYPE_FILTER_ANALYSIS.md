# BEAP Inbox: Handshake vs Depackaged filter & handshake navigation — codebase analysis

**Task:** Codebase analysis only — no implementation.  
**Scope:** Electron app `apps/electron-vite-project` (renderer + main email/handshake paths referenced below).

---

## A. Existing type/classification model

### Exact fields / flags / enums

| Mechanism | Purpose (as used in code) | Relevant files |
|-----------|---------------------------|----------------|
| **`inbox_messages.source_type`** | DB constraint: `'direct_beap' \| 'email_beap' \| 'email_plain'` | `electron/main/handshake/db.ts` (schema v29+), `electron/main/email/messageRouter.ts` |
| **`inbox_messages.handshake_id`** | Optional link to a handshake record | Same; extracted from BEAP JSON in `messageRouter.extractHandshakeId` |
| **`inbox_messages.beap_package_json`** | Raw BEAP package when detected | `messageRouter.ts` |
| **`inbox_messages.depackaged_json`** | Decoded/preview JSON (orchestrator UI, embeddings) | `electron/main/email/beapEmailIngestion.ts` (updates **only** `depackaged_json` + `embedding_status`, not `source_type`) |

**Renderer type:** `InboxSourceType = 'direct_beap' | 'email_beap' | 'email_plain'` on `InboxMessage` (`src/stores/useEmailInboxStore.ts`).

### How “depackaged” vs “handshake (packaged)” is expressed today

**Confirmed in UI logic:**

- **Treated as depackaged for send/reply UX:** `message.source_type === 'email_plain'`  
  - Examples: `EmailInboxView.tsx` (`isDepackaged`), `EmailInboxBulkView.tsx` (draft send buttons), `InboxDetailAiPanel` in `EmailInboxView.tsx`.
- **Treated as BEAP package (non-plain) for badge:** `source_type === 'email_beap' || source_type === 'direct_beap'`  
  - Examples: `InboxMessageRow` in `EmailInboxView.tsx`, `EmailMessageDetail.tsx`.

**Confirmed in ingestion:**

- On email ingest, `messageRouter.detectAndRouteMessage` sets **`source_type` once** at insert: `detectedType === 'beap' ? 'email_beap' : 'email_plain'` (only **`email_beap`** or **`email_plain`** are written — see below).

**Important edge case (confirmed):**

- `processPendingP2PBeapEmails` in `beapEmailIngestion.ts` runs `UPDATE inbox_messages SET depackaged_json = ?, ... WHERE id = ?` **without** changing `source_type`. So a row can have **non-null `depackaged_json` while `source_type` remains `email_beap`**.

**`direct_beap` (confidence: schema + UI only, not writer found):**

- Allowed by DB CHECK and used in **TypeScript types** and UI badges (`EmailInboxToolbar`, `HandshakeBeapMessages`, etc.).
- **Grep across `electron/`:** the only `INSERT INTO inbox_messages` is in `messageRouter.ts`, and it only assigns **`email_beap` or `email_plain`**. No `direct_beap` insert was found in the Electron main email pipeline. Treat **`direct_beap` as unused for inbox rows today** unless another binary/path writes the DB outside this repo.

### Product mapping vs code

- **Product:** two visible types — *Handshake* and *Depackaged* (both “BEAP” in domain terms).
- **Closest existing mechanical mapping:**
  - **Depackaged bucket (UI today):** `email_plain` — used everywhere for “Send via Email”, attach, etc.
  - **Handshake / packaged BEAP over email bucket:** `email_beap` — matches “BEAP” / non-plain branch.
- **Caveat (confirmed):** `email_plain` **also** means “non-BEAP plain email” at ingest (`detectedType === 'plain'`). The codebase does **not** introduce a separate “BEAP-derived plain vs ordinary plain” flag on `inbox_messages`.

**Confidence level**

- **High:** `source_type`, `handshake_id`, `depackaged_json` locations and list/filter plumbing.
- **Medium:** Interpreting product “Handshake” as exactly `email_beap` — aligns with ingest and filters, but **`direct_beap`** and **depackaged_json-on-email_beap** complicate a naïve two-bucket rule.
- **Low:** Any guarantee that all real-world “depackaged BEAP” rows are `email_plain`; main-process depackage does not flip `source_type`.

---

## B. Existing inbox filter architecture

### Shared store

**`useEmailInboxStore`** (`src/stores/useEmailInboxStore.ts`):

- **`filter: InboxFilter`** with:
  - **`filter`:** `'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete' | 'pending_review' | 'urgent'`
  - **`sourceType`:** `InboxSourceType | 'all'` (default `'all'`)
  - **`handshakeId`**, **`category`**, **`search`** (optional)

**Server alignment:** `listBridgeOptionsFromFilter` passes these to `window.emailInbox.listMessages` / `listMessageIds`. Main process **`buildInboxMessagesWhereClause`** in `electron/main/email/ipc.ts` applies the **same** tab rules + optional `source_type = ?`, `handshake_id = ?`, etc.

**Client-side mirror:** `filterByInboxFilter` (used for local optimistic updates / `deriveTabCounts`) must stay aligned with SQL (documented in store comments).

### Normal Inbox

- **Component:** `EmailInboxView.tsx`.
- **Toolbar:** `EmailInboxToolbar.tsx`:
  - **Row 1:** `FILTER_TABS` — `all`, `unread`, `starred`, `archived`, `pending_delete`, `pending_review`, `deleted` (labels like “⏳ Pending Review”).
  - **Row 2:** **`SOURCE_TABS`:** All / **BEAP** (`email_beap`) / **Plain** (`email_plain`) / **Direct** (`direct_beap`).
- **Tabs vs product doc:** Normal inbox does **not** show the Bulk-only tab strip (Urgent / Pending Delete / …) in the same way as Bulk; it uses the broader `FILTER_TABS` set.

### Bulk Inbox

- **Component:** `EmailInboxBulkView.tsx`.
- **Primary tabs (confirmed in file):** `all`, `urgent`, `pending_delete`, `pending_review`, `archived` — implemented as `bulk-view-toolbar-filter-btn` buttons calling `setFilter({ filter: '...' })`, with **`tabCounts`** from server (`fetchBulkTabCountsServer` in store).
- **No `EmailInboxBulkView` usage of `EmailInboxToolbar`:** grep shows **no** `sourceType` / `SOURCE_TABS` / `EmailInboxToolbar` in `EmailInboxBulkView.tsx`. The store default `sourceType: 'all'` still applies to IPC, but **users cannot change source type in Bulk UI today**.

### Shared vs separate logic

- **Shared:** Zustand store, IPC `inbox:listMessages` / `inbox:listMessageIds`, `buildInboxMessagesWhereClause`.
- **Separate:** Normal uses `EmailInboxToolbar` + different primary filter tab set; Bulk uses its own toolbar markup and omits source-type controls.

---

## C. Best integration point for the new type filter (All / Handshake / Depackaged)

### Recommended state location

**Extend `InboxFilter` in `useEmailInboxStore.ts`** (or repurpose `sourceType` with a clear mapping). Reasons:

- **`listMessages` / `listMessageIds` already take structured filter options**; `setFilter` already resets pagination and clears multi-select when list scope changes (`setFilter` implementation).
- **Bulk tab counts** (`fetchBulkTabCountsServer`) iterate `filter` ∈ `{ all, urgent, pending_delete, pending_review, archived }` while preserving **`baseFilter`** — any new dimension must be included in that `baseFilter` so counts match the visible list.

### Server WHERE clause

Today: optional **single** `source_type = ?` (`ipc.ts`).

For product buckets:

- **Depackaged:** likely `source_type = 'email_plain'` **if** product accepts the same definition as current UI (see caveats in section A).
- **Handshake:** likely `source_type = 'email_beap'` **and optionally** `direct_beap` if those rows ever exist — would require **`IN (...)`** or OR conditions; **not** supported by current single-equality branch — **requires a small IPC/SQL extension** (confirmed gap).

### Selector / composition order

**Confirmed order in `buildInboxMessagesWhereClause`:** status/tab predicates first, then `sourceType`, then `handshakeId`, then `category`, then `search`. A handshake/depackaged dimension should compose **after** tab predicates and **with** the same ordering on the client `filterByInboxFilter` for consistency.

### Why not URL/route only?

- **No router:** `App.tsx` uses `useState<DashboardView>` for `analysis | handshakes | beap-inbox | settings` — **no URL query params** for inbox filters found in this analysis path.
- **Persisting filter in URL** would be new surface area; store + IPC already own filter state.

---

## D. Best insertion point for handshake icon

### Normal Inbox — list row

- **Component:** **`InboxMessageRow`** inside `EmailInboxView.tsx` (local function, ~lines 663–851 in current file).
- **Existing pattern:** “Source badge” (B vs ✉) from `isBeap`; metadata row includes **`message.handshake_id` → 🤝** as a **non-clickable** `<span>` (confirmed).

**Low-risk insertion:** convert 🤝 span to a **`<button type="button">`** with `stopPropagation` on click so row selection does not swallow navigation; place next to existing badges (same flex row).

### Normal Inbox — detail

- **Component:** **`EmailMessageDetail.tsx`** — `formatSourceBadge(sourceType)` and BEAP technical panel (`msg-detail-beap-*` classes). Optional second line for handshake-specific affordance if list icon is insufficient when no row is visible.

### Bulk Inbox — cards

- **Primary card UI:** **`BulkActionCardStructured`** in `EmailInboxBulkView.tsx` (large structured card with analysis popover, draft, etc.).
- **No `handshake_id` / 🤝** found in the bulk card header in the analyzed sections; bulk focuses on AI chrome and actions.
- **Compact / grid:** root uses `bulk-view-root` + `bulkCompactMode` class (`bulk-view--compact`); any icon should respect **narrow headers** and existing `bulk-action-card-header` layout.

**Low-risk for Bulk:** small icon in **`bulk-action-card-header`** row (near category badge / urgency) **or** on the collapsed strip if there is a single-line title row — inspect the exact collapsed header JSX for the card wrapper (pattern: `bulk-action-card`).

### Icon system

- **Confirmed:** heavy use of **emoji** (🤝, 📎, ⭐, 👉) and **inline SVG** (e.g. session history button in Bulk toolbar) — no single Lucide/Heroicons layer required by existing inbox code.
- **HandshakeView** also uses 🤝 for “chat scoped to this handshake” (`HandshakeView.tsx`).

---

## E. Existing handshake navigation path

### In-app Handshakes view

- **Route:** Not URL-based — **`App.tsx`** sets `activeView === 'handshakes'` and renders **`<HandshakeView />`** with:
  - **`selectedHandshakeId`**, **`selectedHandshakeEmail`** (state in `App.tsx`)
  - **`onHandshakeScopeChange(id, email)`** updates selection and clears message/document selection.

### How selection works

- **`HandshakeView`:** `handleHandshakeClick` / list buttons call `onHandshakeScopeChange(r.handshake_id, counterpartyEmail(r))`.
- **`HandshakeBeapMessages`:** when a handshake is selected, loads **`window.emailInbox.listMessages({ handshakeId, filter: 'all' })`** — inbox messages **scoped to that handshake** inside the Handshake workspace.

### IPC intended for “open handshake UI” from elsewhere

- **`OPEN_HANDSHAKE_REQUEST`** in `electron/main.ts` opens the **Chrome extension command center popup** (`dashboard-handshake-request`), **not** the in-app `HandshakeView`. Same pattern for `OPEN_BEAP_INBOX`.

**Confirmed gap:** There is **no** existing callback from `EmailInboxView` / `EmailInboxBulkView` to `App.tsx` to set `activeView` + `selectedHandshakeId`. **Deep-link-style navigation from inbox row to in-app Handshake detail would require new props or an app-level event.**

---

## F. Message-to-handshake mapping

### Confirmed mapping

- **`inbox_messages.handshake_id`** — nullable string, populated when the BEAP package yields an id via `extractHandshakeId` in `messageRouter.ts` (header / receiver_binding / root `handshake_id`).
- **IPC list filter:** `buildInboxMessagesWhereClause` supports **`handshakeId`** → `handshake_id = ?` (already used by `HandshakeBeapMessages` via `listMessages({ handshakeId })`).

### Uncertainty

- Messages with **`handshake_id` null** but still “handshake-related” in product sense — **no second id** found in this analysis.
- **`email_plain` rows:** may lack `handshake_id` even when content is relationship-related (depends on plain pipeline).

### Stability

- **`handshake_id` on the message row** is the stable join key to **`handshakes.handshake_id`** (see `electron/main/handshake/db.ts` and `window.handshakeView.listHandshakes`).

---

## G. Risks / blockers

### Confirmed risks

1. **`email_plain` is not exclusively “depackaged BEAP”** — includes ordinary plain email (`messageRouter` plain path).
2. **`depackaged_json` without `source_type` flip** — depackaged content can exist on **`email_beap`** rows; UI “depackaged” = `email_plain` may **not** match all rows with depackage data.
3. **`direct_beap`** — in schema/types but **no insert** found in `messageRouter`; filtering only `email_beap` may miss future `direct_beap` rows if writers appear later.
4. **Bulk Inbox has no source-type UI** — adding a type filter is **new UI** there; must coordinate with **`fetchBulkTabCountsServer`** so tab counts respect the type dimension.
5. **Handshake navigation** — no existing in-app bridge from inbox children to `App` handshake state; **new wiring** required for click-to-handshake.
6. **`setFilter` clears `multiSelectIds`** on scope change — changing type filter will **clear selection** (by design today).

### Probable risks

- **Auto-Sort / bulk AI:** rows disappear from a tab when `sort_category` / pending flags change; adding another filter increases combinations to regression-test.
- **Compact mode / small headers:** icon + click target size.
- **Async refresh:** `fetchAllMessages({ soft: true })` replaces pages; icons must key off **message id + handshake_id** from latest payload.

### Missing data that could block a perfect product match

- A **single authoritative boolean or enum** “Handshake vs Depackaged” separate from `source_type` / marketing labels — **does not exist**; derivation is from **`source_type` + optional `depackaged_json`**, with the ambiguities above.

---

## H. Lowest-risk implementation plan (no code — ordered work)

### 1. Files to touch first (dependency order)

1. **`electron/main/email/ipc.ts`** — extend `InboxListFilterOptions` + `buildInboxMessagesWhereClause` (and any `listMessages` / `listMessageIds` typings) to support the new bucket semantics **without breaking** existing `sourceType` callers.
2. **`src/stores/useEmailInboxStore.ts`** — extend `InboxFilter`, `listBridgeOptionsFromFilter`, `filterByInboxFilter`, and **`fetchBulkTabCountsServer` / `loadBulkInboxSnapshotPaginated`** so Bulk counts + pages use the same filter.
3. **`src/components/EmailInboxToolbar.tsx`** — replace or supplement `SOURCE_TABS` labels/values to match product (All / Handshake / Depackaged), mapping to IPC.
4. **`src/components/EmailInboxBulkView.tsx`** — add a **secondary control** (new row or chips) for the same filter; ensure it does not collide with existing tab strip.
5. **`src/App.tsx`** — pass **`onNavigateToHandshake?: (handshakeId: string) => void`** (or similar) into inbox components so the handshake icon can set `activeView('handshakes')` + `selectedHandshakeId` + email if available.
6. **`src/components/EmailInboxView.tsx`** — `InboxMessageRow`: clickable 🤝 with `stopPropagation`.
7. **Optional:** `EmailMessageDetail.tsx` — redundant affordance + `title` / accessibility.

### 2. Phase 1 (minimal vertical slice)

- Define **exact product mapping** to SQL (document edge cases from section A).
- Implement **store + IPC** filtering for the three buckets; **default = show both** (equivalent to current `sourceType: 'all'` for email buckets).
- Add **UI control** in **normal** inbox toolbar only; verify `listMessages` totals and row sets.

### 3. Validate before phase 2

- Rows with **`email_beap` + `depackaged_json`** — expected inclusion/exclusion for “Depackaged” and “Handshake”.
- **`email_plain`** non-BEAP mail — product decision: include in “Depackaged” or exclude via extra predicate.
- **Tab counts** in Bulk with new filter applied (all five tabs).
- **Performance:** extra SQL branch should stay index-friendly (`idx_inbox_messages_source_type` exists in `db.ts`).

### 4. Regressions to test

- **Tab × type:** All / Urgent / Pending Delete / Pending Review / Archived × new type filter.
- **Normal inbox:** existing `FILTER_TABS` + search + category if used.
- **Bulk:** Auto-Sort selection scope, `loadMoreBulkMessages` pagination, soft refresh, compact mode.
- **Navigation:** from inbox → Handshakes with a known `handshake_id`; behavior when id **missing** or handshake **not in list** (HandshakeView still lists from `listHandshakes()`).
- **HybridSearch / `selectedMessageId`:** ensure switching views does not leave inconsistent scope (App already clears message selection when leaving inbox in some cases — re-read `App.tsx` effects when adding navigation).

---

## Appendix: key file reference

| Area | File |
|------|------|
| Inbox message model + filter | `src/stores/useEmailInboxStore.ts` |
| SQL WHERE for lists | `electron/main/email/ipc.ts` (`buildInboxMessagesWhereClause`) |
| Ingest → `source_type` / `handshake_id` | `electron/main/email/messageRouter.ts` |
| Depackage JSON update | `electron/main/email/beapEmailIngestion.ts` |
| Normal list row + 🤝 | `src/components/EmailInboxView.tsx` (`InboxMessageRow`) |
| Normal toolbar tabs + source | `src/components/EmailInboxToolbar.tsx` |
| Bulk tabs | `src/components/EmailInboxBulkView.tsx` (toolbar ~4026–4174) |
| Detail / badges | `src/components/EmailMessageDetail.tsx` |
| App-level views + handshake selection | `src/App.tsx`, `src/components/HandshakeView.tsx` |
| Handshake-scoped inbox list | `src/components/HandshakeBeapMessages.tsx` |

---

*Analysis generated from repository inspection; no implementation performed.*
