# AutoSort Session History / Session Review — Read-Only Analysis

This document supports a future implementation pass for: per-message dates in session review, correct “open message” navigation to **post-sort** context, and evidence-based chart additions. It is grounded in repository inspection only; **no code or schema was changed** for this task.

---

## 1. Executive summary

**Date display:** Each `inbox_messages` row has `received_at` (required), `ingested_at`, and sort-related timestamps (e.g. `pending_review_at`, `pending_delete_at`). The IPC query for session messages **orders by `received_at` but does not return it**, and the `AutoSortSessionReview` `MessageRow` type omits date fields. Showing the email’s **received date** (or RFC-equivalent arrival time already modeled as `received_at`) is appropriate for history; **sorted-at** is only meaningful at batch level (`autosort_sessions.started_at` / `completed_at`), not per message in the current design. **Minimum fix:** extend `autosort:getSessionMessages` `SELECT` + renderer types + `MessageListRow` UI — no new persistence if `received_at` is sufficient.

**Post-sort link / “location”:** There is **no deep link URL**. “Open message” calls `onNavigateToMessage(messageId)`, which in `EmailInboxBulkView` only closes the overlay and calls **`selectMessage(id)`** on the inbox store. That **does not** call **`onSelectMessage`** (App-level `selectedMessageId`), and **does not** change the inbox **`filter`** (workflow tab: all / urgent / pending_review / pending_delete / archived). The bulk inbox also runs a **focus-reconciliation** effect: if `focusedMessageId` (from App props) is **not** in the current tab’s `sortedMessages`, it **forces** focus to the first row of the current list (or clears). So opening a message that now lives under another tab (e.g. archived while the user is still on “Urgent”) will **fail to land** on that message in context; behavior matches “stuck in **pre-navigation** / **pre-tab** state” rather than post-sort **workflow bucket**. Root cause is **UI navigation logic** (missing `setFilter` + missing / unsynchronized App focus), not missing post-sort fields in the session payload (session rows read **live** `inbox_messages` including `sort_category`, `archived`, `pending_delete`, `pending_review_at`).

**Additional charts:** The app uses **Recharts** only in `AutoSortSessionReview` (donut by `sort_category`, bar by `urgency_score`). There is **no “charly”** usage in this repo. Useful, low-clutter additions with **current or near-current** data include **needs_reply** split, **outcome flags** (pending delete / archived / pending review vs “inbox-normal”), and **top senders** aggregated from `from_address` / `from_name`. Time-based charts need **`received_at` in the payload** (same projection change as date display). **Account/provider** breakdown would require adding `account_id` (or similar) to `getSessionMessages`.

---

## 2. Scope and method

- **Read-only:** No application code, migrations, tests, packages, or infrastructure were modified.
- **Method:** Traced UI (`AutoSortSessionReview`, `AutoSortSessionHistory`, `EmailInboxBulkView`, `App.tsx`), store (`useEmailInboxStore`), preload bridge (`handshakeViewTypes`, `preload.ts`), and Electron IPC/SQL (`ipc.ts`, `db.ts`).
- **Uncertainty:** Exact product wording for “location” is interpreted as **in-app workflow tab + list membership + focus** (not IMAP folder paths). Remote mailbox moves are orchestrated elsewhere; session review does not surface IMAP folder names in the analyzed paths.

---

## 3. Relevant code inventory

### Frontend / UI

| File | Role |
|------|------|
| `apps/electron-vite-project/src/components/AutoSortSessionReview.tsx` | Session review overlay: stat chips, **Recharts** donut + bar, grouped message lists, **`MessageListRow`**, `onNavigateToMessage`. |
| `apps/electron-vite-project/src/components/AutoSortSessionHistory.tsx` | Past sessions list (`listSessions`); opens review via `onOpenSession(sessionId)`. |
| `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` | Hosts review/history overlays; **defines `onNavigateToMessage`**; `handleAiAutoSort` creates session and runs `runAiCategorizeForIds`; focus-reconciliation effect on `focusedMessageId` vs `sortedMessages`. |
| `apps/electron-vite-project/src/App.tsx` | Passes `selectedMessageId` / `onSelectMessage` into bulk inbox. |

### Preload / IPC / API surface

| File | Role |
|------|------|
| `apps/electron-vite-project/electron/preload.ts` | Exposes `window.autosortSession` (`create`, `finalize`, `getSession`, `listSessions`, `deleteSession`, `getSessionMessages`, `generateSummary`). |
| `apps/electron-vite-project/src/components/handshakeViewTypes.ts` | TypeScript `AutosortSessionAPI` for `window.autosortSession`. |

### AutoSort / session logic

| File | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/ipc.ts` | IPC handlers for autosort; **`autosort:getSessionMessages`** SQL; **stamps `last_autosort_session_id`** before classify; LLM classify updates `inbox_messages` sort state. |

### Persistence / database

| File | Role |
|------|------|
| `apps/electron-vite-project/electron/main/handshake/db.ts` | `autosort_sessions` table; `inbox_messages.last_autosort_session_id`; `inbox_messages.received_at`, `ingested_at`, etc. |

### Charting / visualization

| File | Role |
|------|------|
| `apps/electron-vite-project/src/components/AutoSortSessionReview.tsx` | **Only** consumer of **Recharts** in this app (`PieChart`, `BarChart`, …). |
| `apps/electron-vite-project/package.json` | Declares `recharts` (^3.8.0). |

### Shared types / store

| File | Role |
|------|------|
| `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` | `InboxMessage`, `InboxFilter`, **`selectMessage`** (loads `getMessage` + updates store), **`setFilter`** (refetches list for tab). |

---

## 4. Current AutoSort Session Review architecture

1. **Toolbar Auto-Sort** (`EmailInboxBulkView.handleAiAutoSort`): optionally `autosortSession.create()` → resolves target message IDs → `runAiCategorizeForIds(…, sessionId)` so main-process classify stamps each row with `last_autosort_session_id` (even before LLM success).
2. **Finalize + summary:** `getSessionMessages(sessionId)` → counts → `finalize(sessionId, stats)` → `generateSummary(sessionId)` (Ollama JSON → `autosort_sessions.ai_summary_json`). `lastSessionId` stored in React state for “Review” button.
3. **History:** `AutoSortSessionHistory` calls `listSessions(limit)` (only **`status = 'completed'`** rows).
4. **Review:** `AutoSortSessionReview` loads **`getSession` + `getSessionMessages`** in parallel. Session header uses `started_at`, `total_messages`, `duration_ms`. Message bodies are grouped by **urgent / pending review / other** using **`sort_category`, `urgency_score`, `pending_review_at`**.
5. **Charts:** Derived entirely from the **`messages`** array returned by `getSessionMessages` (same fields as list rows).

**Important semantic:** Session membership is **`inbox_messages.last_autosort_session_id = sessionId`**. There is **no separate `autosort_session_messages` snapshot table**. Rows are **live** projections of `inbox_messages`. Any later manual or AutoSort change can **diverge** from what the user saw at review time; a newer AutoSort run **overwrites** `last_autosort_session_id`, so older sessions may **lose** messages from `getSessionMessages` for those IDs.

---

## 5. Current per-message row data model

### Source of truth

`ipc.ts` handler **`autosort:getSessionMessages`**:

```sql
SELECT id, from_address, from_name, subject, sort_category, urgency_score, needs_reply, sort_reason, pending_delete, pending_review_at, archived
FROM inbox_messages
WHERE last_autosort_session_id = ?
ORDER BY urgency_score DESC, received_at DESC
```

- **`received_at` is used for ordering but not exposed** to the renderer.
- **`account_id`, `email_message_id`, `ingested_at`, IMAP fields** are not selected.

### Renderer model

`AutoSortSessionReview.tsx` **`MessageRow`** (local type): `id`, `sort_category`, `urgency_score`, `sort_reason`, `from_*`, `subject`, `pending_delete`, `pending_review_at`, `archived`. **No date fields.**

### What “sorted” means in DB (post-batch)

After classify (`ipc.ts` ~3585–3640): LLM categories map into `sort_category`, `archived`, `pending_delete`, `pending_review_at`, `urgency_score`, etc. (e.g. **archive** → `archived = 1` with `sort_category` mapped to **`newsletter`** per `sortCategoryMap`). High urgency forces **urgent** and clears pending flags.

This is the **post-sort location** in product terms for this app: **workflow bucket** (tabs) + flags on the message row, not a separate “link target” column.

---

## 6. Date-display analysis

### What date fields exist

| Field | Table | Meaning |
|-------|--------|---------|
| `received_at` | `inbox_messages` | Required; typical **email arrival / message date** for UX. |
| `ingested_at` | `inbox_messages` | Local ingest time. |
| `pending_review_at` / `pending_delete_at` | `inbox_messages` | Workflow timestamps (subset of messages). |
| `started_at` / `completed_at` | `autosort_sessions` | Batch run times (shown in header / history list). |

There is **no per-message “sorted_at”** column in schema.

### Which date to show

- For **“when was this email from?”** → **`received_at`** (best aligns with user mental model; already canonical on `InboxMessage` in the store).
- **`ingested_at`** is weaker for “email date.”
- **Session timestamps** answer “when did we run AutoSort?”, not per-message history.

### Is the date already in the payload?

**No.** The IPC projection omits it; the UI type omits it.

### Where it would come from

Minimum: **add `received_at` to the `SELECT`** in `autosort:getSessionMessages` (optional: `ingested_at` if product wants both).

### Minimum safe future fix path

1. Extend SQL + typings (`MessageRow`, optional `Record` typing from preload).
2. Format in `MessageListRow` (locale string, handle missing/null defensively).
3. No DB migration if `received_at` is already populated for all non-degenerate rows.

---

## 7. Post-sort link root-cause analysis

### Current link-generation path

1. **`MessageListRow`** (`AutoSortSessionReview.tsx`): row click and **“Open message”** call `onNavigate(msg.id)` → props **`onNavigateToMessage`**.
2. **`EmailInboxBulkView`** (~5670–5677):

```ts
onNavigateToMessage={(id) => {
  setShowSessionReview(null)
  void selectMessage(id)
}}
```

3. **`selectMessage`** (`useEmailInboxStore.ts` ~814–842): loads full message via `getMessage(id)`; sets **`selectedMessageId` / `selectedMessage`** in the **Zustand store** only.

### What actually determines “location”

- **List highlight, keyboard focus, and Hybrid Search scope** follow **`focusedMessageId`** from **`App.tsx` → `selectedMessageId` prop**, updated via **`onSelectMessage`** when the user clicks a row — **not** via `selectMessage` alone.
- **Which messages appear in the grid** is driven by **`filter`** (`InboxFilter.filter`: `all` | `urgent` | `pending_review` | `pending_delete` | `archived` | …) and bulk fetch logic — unchanged by session review.

### Pre-sort vs post-sort state

- **Session review content** (categories, flags) comes from **current** `final` row in `inbox_messages` for that `id` — i.e. **post-sort DB state** (unless the user changed or re-sorted later).
- **Navigation** does **not** switch the inbox to the tab that contains that post-sort state.

### Is post-sort destination persisted?

**Yes** on `inbox_messages` (`sort_category`, `archived`, `pending_delete`, `pending_review_at`, etc.). **No separate “Open URL” field** exists.

### Why behavior matches “pre-sort location”

**Most likely user-visible mechanism:** User remains on the **same workflow tab** as before opening review. The opened message may **no longer match** that tab’s query. Then `EmailInboxBulkView`’s effect (**~2376–2385**) runs:

- If **`focusedMessageId`** is not in **`sortedMessages`**, it **reassigns** focus to **`sortedMessages[0]`** or clears — **clobbering** the intent to open the chosen id unless the tab/list contains that id.

Even before that effect runs, **not calling `onSelectMessage(id)`** means **App-level** `selectedMessageId` may stay stale relative to store-driven expand/panel logic.

### Ruled-out alternatives (with caveats)

| Hypothesis | Verdict |
|------------|---------|
| **`getSessionMessages` returns pre-sort categories** | **Unlikely** as default: it reads live `inbox_messages` after classify updated them. (Staleness possible only if classify failed after session stamp or user changed data later.) |
| **Wrong persisted field on snapshot row** | **N/A**: no per-session snapshot row; live join. |
| **`MessageListRow` builds a wrong URL** | **N/A**: only passes `id`. |
| **Backend missing post-sort data** | **No** for core workflow flags; they are on `inbox_messages`. |

### Confidence

**High** that the primary defect is **frontend navigation**: missing **filter alignment** + missing / unsynchronized **App `onSelectMessage`**, compounded by **focus-reconciliation** when the id is absent from the current tab’s list.

---

## 8. Current charting setup

| Item | Detail |
|------|--------|
| **Library** | **Recharts** (`AutoSortSessionReview.tsx` imports; `package.json`). |
| **Where used** | **Only** `AutoSortSessionReview.tsx` in this project (grep across `electron-vite-project`). |
| **Charts** | (1) **Category breakdown** — pie/donut from **`sort_category`** counts. (2) **Urgency distribution** — bar chart from **`urgency_score`** bucketed into Low/Medium/High/Critical. |
| **Data prep** | `useMemo` over **`messages`** from `getSessionMessages`; colors from local maps (`CATEGORY_COLORS`, `URGENCY_BUCKET_META`). |

**“Charly”:** **Not present** in codebase (search returned no matches).

---

## 9. Additional chart opportunities

Principle: session review already has **two** charts; more should **avoid redundancy** with the donut (category) and bar (urgency).

### Immediately feasible with existing `getSessionMessages` fields

| Chart | Why useful | Fields | UI fit | Clutter / risk |
|-------|------------|--------|--------|----------------|
| **Reply-needed split** | Validates triage quality (how many still need reply). | `needs_reply` (0/1) | Small second row in sidebar or horizontal bar under stat chips. | Low; different axis than category. |
| **Outcome / action flags** | Shows batch effect: archived vs pending delete vs pending review vs “cleared”. | `archived`, `pending_delete`, `pending_review_at` / `sort_category` | Stacked bar or single “sankey-style” table; keep one visual. | Medium: overlaps **partially** with category; position as “lifecycle outcome” not “AI label.” |
| **Top senders (bar)** | Spots bulk/newsletter senders dominating the batch. | `from_address` / `from_name` | Compact horizontal bar (top 5–8). | Medium: PII in aggregate; still session-local. |

### Feasible with same SQL projection as date (add `received_at`)

| Chart | Why useful | Fields | Notes |
|-------|------------|--------|--------|
| **Received time histogram** | See if batch is skewed to recent mail vs old backlog. | `received_at` (bucket by hour/day) | **Requires** extending SELECT; client-side bucketing only. |

### Feasible with modest IPC / projection changes

| Chart | Data gap | Change |
|-------|----------|--------|
| **Per-account or provider** | `account_id` not in `getSessionMessages` | Add column to SELECT; optionally map to display name elsewhere. |

### Not recommended / low value (here)

| Idea | Reason |
|------|--------|
| Second category breakdown (e.g. raw LLM label) | **Not persisted** separately from `sort_category`; redundant. |
| Duplicate urgency + category in multiple chart types | Same dimensions as existing donut + bar. |
| Large time-series across many sessions | Out of scope for single-session review; belongs on analytics page. |
| **Confidence / score** charts | No confidence field in projection or `MessageRow`. |

---

## 10. Gap analysis

| Desired behavior | Current codebase | Gap |
|------------------|------------------|-----|
| Show **message date** in session lists | No date in IPC projection/UI | Add `received_at` (etc.) to SQL + UI. |
| Open message in **post-sort** context | Only `selectMessage(id)`; no tab change; App focus may be stale; reconciliation effect | Derive target **`InboxFilter.filter`** (and related flags) from message row; **`setFilter`** + await refresh; **`onSelectMessage(id)`**; ensure ordering avoids clobber. |
| Richer session analytics | Donut + urgency bar only | Optional charts per §9; bounded sidebar height / collapsible sections. |

---

## 11. Risks and edge cases

| Risk | Detail |
|------|--------|
| **Stale vs live session** | `getSessionMessages` is **live**; later edits / new AutoSort change what review shows. |
| **`last_autosort_session_id` overwrite** | A newer session **steals** message membership; **old session’s list shrinks** for that message. |
| **Missing dates** | `received_at` is NOT NULL in schema; still guard UI if repair/legacy rows odd. |
| **Deleted / missing messages** | `getMessage` may fail; store sets `selectedMessage` null; user sees broken selection. |
| **Category vs tab mapping** | Tabs use **workflow filters**; deriving tab from row must mirror **`buildInboxMessagesWhereClause`** / store semantics (e.g. urgent vs archived). |
| **Focus reconciliation** | Changing filter **async** — select after list contains id or reconcile after fetch. |
| **Charts** | Too many Recharts **`ResponsiveContainer`** instances can hurt low-end machines; keep height modest (already ~150px). |

---

## 12. Recommended future fix-prompt inputs

**Files likely to change**

- `apps/electron-vite-project/electron/main/email/ipc.ts` — `autosort:getSessionMessages` SELECT (dates; optional `account_id`).
- `apps/electron-vite-project/src/components/AutoSortSessionReview.tsx` — `MessageRow`, `MessageListRow`, optional charts.
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` — **`onNavigateToMessage`** implementation; possibly pass **`setFilter` + `onSelectMessage`** into a dedicated callback.
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` — possibly a small helper **`deriveWorkflowFilterForMessage(msg)`** shared with list logic (or mirror rules carefully).

**Behaviors to preserve**

- Session review grouping (urgent / pending review / other).
- Stat chips and finalize counts (session row vs recompute fallback).
- **`listSessions`** only showing **completed** sessions.
- **Attachment guard** and urgency rules in classify (don’t change when touching navigation).

**Assumptions to validate**

- “Post-sort location” = **workflow tab** where the message appears **today** per DB flags, not remote IMAP path.
- Users expect **App-level** selection + bulk highlight to match after “Open message.”

**Risks to avoid**

- Calling `onSelectMessage` **without** switching filter → reconciliation effect **overwrites** selection.
- Dual source of truth: **always** sync App `selectedMessageId` with store when opening from review.

**Suggested implementation sequence**

1. **Projection:** Add `received_at` to `getSessionMessages`; display in UI.
2. **Navigation contract:** From review, fetch minimal row (already have row in `messages`; or `getMessage`) → compute **`filter`** → `setFilter` → **`refreshMessages` / wait until id in list** → `onSelectMessage(id)` + `selectMessage(id)` if both are still required.
3. **Regression test manually:** archived + urgent + pending_review cross-tab opens; keyboard focus; Hybrid Search scope.
4. **Charts (optional):** Add one small chart (e.g. `needs_reply`) before time histogram.

---

## 13. Final conclusion

- **Incorrect “post-sort” open behavior** — **most likely root cause:** session review only invokes **store `selectMessage`**, does **not** align **inbox workflow filter** with the message’s **post-sort bucket**, and does **not** reliably update **App-level focus**; combined with **`EmailInboxBulkView`’s focus-reconciliation** when the id is **not in the current tab’s list**, the user lands in a **pre-open / wrong-tab** experience. Persistence of post-sort state on **`inbox_messages` is largely adequate** for computing the right tab.
- **Best candidate date field to show:** **`received_at`** (exposed via IPC + UI).
- **Most valuable chart additions (balanced):** **Reply-needed** breakdown and **top senders** from existing fields; **received-time distribution** after adding **`received_at`** to the payload — avoiding redundant third view of the same category/urgency story.

---

*End of read-only analysis. No repository code was modified to produce this document.*
