# WR Desk™ — Bulk Inbox Batch Automation, Action Cards & Layout Analysis

**Date:** 2025-03-17  
**Scope:** Bulk Inbox, Normal Inbox, Pending Delete pipeline, Message detail layout, Expand toggle

---

## === PART 1: BULK INBOX CURRENT STATE ===

### 1.1 Batch Selection & AI Auto-Sort

**What happens when the user selects multiple messages and clicks AI Auto-Sort:**

1. **Function called:** `handleAiAutoSort` (EmailInboxBulkView.tsx, lines 224–255)
2. **IPC call:** Single call to `window.emailInbox.aiCategorize(ids)` — **one IPC call for ALL selected messages**, not per-message.
3. **Response shape:**
   ```typescript
   { ok: true, data: { classifications: Array<{
     id: string;
     category: string;
     reason: string;
     needs_reply: boolean;
     urgency_score: number;
     pending_delete: boolean;
   }> } }
   ```
4. **After classification:**
   - Backend updates DB: `sort_category`, `sort_reason`, `urgency_score`, `needs_reply` per message
   - `pending_delete` is NOT written to DB by aiCategorize — it's only returned in the response
   - Client clears selection, calls `fetchMessages()`
   - Messages are re-sorted by `sortMessagesByCategory()` (urgent → important → normal → newsletter → spam → irrelevant)
   - Color coding: left border (`CATEGORY_BORDER`), background tint (`CATEGORY_BG`)
   - If any classification has `pending_delete: true`, client starts a **5-minute timer**, then calls `inbox:markPendingDelete(pendingIds)`
   - After markPendingDelete: toast "X messages moved to Pending Delete", `fetchMessages()` again

### 1.2 sort_category enum

Backend returns (ipc.ts aiCategorize, line 1141):
- `urgent`
- `important`
- `normal`
- `newsletter`
- `spam`
- `irrelevant`

### 1.3 spam/irrelevant visual treatment

**Current behavior (lines 750–763):**
- `isSpamOrIrrelevant = category === 'spam' || category === 'irrelevant'`
- Row gets `opacity: isSpamOrIrrelevant ? 0.6 : 1` — **YES, visually dimmed**
- Subject gets `textDecoration: 'line-through'` and `color: MUTED` when spam/irrelevant **or** pending delete
- No blur; opacity reduction only

**Pending delete flow:**
- Messages with `pending_delete: true` in the classification response are NOT immediately marked in DB
- After 5 minutes, `markPendingDelete` is called → sets `pending_delete = 1`, `pending_delete_at = now` in DB
- They are NOT auto-moved to pending delete immediately; there is a 5-minute grace period

### 1.4 Pending Delete tab/filter

**Location:** Toolbar buttons in EmailInboxBulkView (lines 464–492):
- "All" button → `setFilter({ filter: 'all' })`
- "Pending Delete" button → `setFilter({ filter: 'pending_delete' })`

**Filter logic (ipc.ts inbox:listMessages, lines 657–669):**
- `filter === 'pending_delete'` → `deleted = 0 AND pending_delete = 1`
- `filter === 'all'` (else branch) → `deleted = 0` only — **does NOT exclude pending_delete**

### 1.5 Dual display bug

**YES — messages appear in BOTH places.** When `filter === 'all'`, the query does not exclude `pending_delete = 1`. So a message with `pending_delete = 1` appears in:
- "All" tab (because all only excludes `deleted = 1`)
- "Pending Delete" tab (because it filters `pending_delete = 1`)

**Fix:** Add `(pending_delete = 0 OR pending_delete IS NULL)` to the "all" filter branch.

---

### 1.2 Per-Message AI Output Area (Right Half)

**What renders:**
- **Summarize** button → calls `handleSummarize(msg.id)` → shows `output.summary` (plain text)
- **Draft Reply** button → calls `handleDraftReply(msg.id)` → shows `output.draft` (plain text)
- **Augment** button → disabled, "coming soon"
- **Empty state:** "Summarize or draft a reply to see output here."

**Auto-triggered analysis:** None. AI output is only shown when the user manually clicks Summarize or Draft Reply per card. AI Auto-Sort does NOT populate the right-half AI output area — it only updates DB fields (`sort_category`, `sort_reason`, etc.) and re-sorts the list.

**aiOutputs state shape (lines 148–150):**
```typescript
Record<string, { summary?: string; draft?: string; loading?: string }>
```
Richer than `Record<string, string>` but not the full `BulkAiResult` — no category, urgency, recommended action, etc.

---

### 1.3 Expand/Collapse Arrow

**Added:** Yes (previous prompt).

**Placement:** Bottom center of each card, full-width strip, as third child of the grid row (grid-column: 1 / -1).

**Appearance:**
- Chevron only: `▾` (collapsed) / `▴` (expanded)
- Height: 20px
- Opacity: 0.3 resting, 0.7 on hover
- Font size: 10px
- Color: `var(--color-text-muted, #64748b)`
- Background: `#f8fafc`, border-top: `1px solid #e2e8f0`

**Visibility:** Low — 0.3 opacity makes it subtle; requirement says it should be MORE visible.

---

## === PART 2: NORMAL INBOX CURRENT STATE ===

### 2.1 Auto-trigger

**Yes.** `InboxDetailAiPanel` has:
```javascript
useEffect(() => {
  if (!messageId) return
  setAnalysis(null)
  setDraft(null)
  setActionChecked({})
  runAnalysis()
}, [messageId, runAnalysis])
```
So `aiAnalyzeMessage` is called automatically when a message is selected.

### 2.2 AI panel sections

- **Response Needed** — Yes/No + reason
- **Summary** — 2–3 sentence summary
- **Urgency** — Bar + score/10 + reason
- **Draft Reply** — Editable textarea, Send/Edit/Regenerate
- **Action Items** — Checkable list
- **Archive** — Recommendation + "Archive now" button

### 2.3 Batch functionality

No batch/bulk in Normal Inbox. Bulk actions (Select all, Delete, Archive, AI Auto-Sort, etc.) exist only in Bulk Inbox.

---

## === PART 3: MESSAGE TITLE LAYOUT ===

**File:** `EmailMessageDetail.tsx` (lines 196–282)

**Current structure:**
```jsx
<div style={{ marginBottom: 16 }}>
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
    <div style={{ minWidth: 0, flex: 1 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
        {message.subject || '(No subject)'}
      </h2>
      <div style={{ fontSize: 12, color: '...' }}>
        From, To, Date
      </div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {/* Star, Archive, Delete, Reply buttons */}
    </div>
  </div>
</div>
```

**Layout:** Flex row, `justifyContent: 'space-between'`. Title block has `flex: 1` and `minWidth: 0`; buttons are a sibling. Title and buttons share the same row.

**CSS causing squeeze:** The flex row with `space-between` puts the title on the left and buttons on the right. The title div gets remaining space (`flex: 1`), but with long subjects it wraps into many lines while the buttons stay fixed on the right, so the title is effectively squeezed into a narrow column.

**Fix approach:** Stack layout:
1. Title block: `width: 100%`, own row, full width
2. Buttons row: below title, full width, left-aligned
3. From/To/Date: below buttons (or keep under title as today)

---

## === PART 4: PENDING DELETE PIPELINE ===

### 4.1 Marking

**Field:** `pending_delete` (int, 0/1), `pending_delete_at` (ISO string)

**How:** `inbox:markPendingDelete` (ipc.ts 1160–1170) runs:
```sql
UPDATE inbox_messages SET pending_delete = 1, pending_delete_at = ? WHERE id = ?
```

**When:** Client calls it after a 5-minute timer (handleAiAutoSort, lines 238–247).

### 4.2 Grace period timer

**Location:** EmailInboxBulkView, `pendingDeleteTimerRef`, `setTimeout(..., 5 * 60 * 1000)` (5 minutes)

**Duration:** 5 minutes before `markPendingDelete` is called.

### 4.3 Pending Delete folder

**Filter:** Same `inbox:listMessages` with `filter: 'pending_delete'` → `deleted = 0 AND pending_delete = 1`. Same message list, different filter.

### 4.4 Removal from main list

**Current:** Messages with `pending_delete = 1` are NOT filtered out of "All". They appear in both "All" and "Pending Delete" — **bug**.

**Desired:** "All" should exclude `pending_delete = 1`.

### 4.5 7-day final deletion

**Location:** ipc.ts, periodic interval (lines 1303–1327), every 5 minutes:
- `executePendingDeletions(db)` — processes `deletion_queue` (messages with `deleted = 1` and grace period ended)
- Then: select messages where `pending_delete = 1` AND `pending_delete_at <= 7 days ago` AND not already in deletion_queue
- For each: `queueRemoteDeletion(db, id, 0)` — grace 0 hours, so immediate queue for remote delete

**7-day enforcement:** Yes — `pending_delete_at <= sevenDaysAgo` is used.

### 4.6 Remote deletion

**queueRemoteDeletion** (remoteDeletion.ts):
- Sets `deleted = 1`, `deleted_at`, `purge_after` on `inbox_messages`
- Inserts into `deletion_queue` with `grace_period_ends`
- Does NOT delete from remote server directly

**executePendingDeletions** (remoteDeletion.ts):
- Selects from `deletion_queue` where `grace_period_ends <= now`
- Calls `emailGateway.deleteMessage(accountId, emailMessageId)` — deletes from remote (IMAP/Graph API)
- Updates `deletion_queue.executed = 1`, `inbox_messages.remote_deleted = 1`

So: `queueRemoteDeletion` queues; `executePendingDeletions` performs the remote delete when grace period ends. For pending_delete flow, `queueRemoteDeletion(..., 0)` queues with 0-hour grace, so the next run of `executePendingDeletions` will delete from remote.

---

## === PART 5: EXPAND ARROW STATE ===

**Element:** `bulk-card-expand-toggle` (EmailInboxBulkView lines 991–1003)

**Current:**
- Opacity: 0.3 resting, 0.7 hover
- Height: 20px
- Font size: 10px
- Color: `var(--color-text-muted, #64748b)`
- Background: `#f8fafc`
- Position: Bottom of each card, full width
- Content: Chevron only (`▾` / `▴`)

**When expanded:** Both halves (message + AI output) grow; `bulk-view-row--expanded` sets `height: auto`, `max-height: none`; `bulk-view-message-body` gets `overflow: visible`.

---

## === PART 6: IMPLEMENTATION PLAN ===

### 6.1 Batch Auto-Analysis (Bulk Inbox Only)

**Feasible:** Yes, with backend and frontend changes.

**Files to modify:**
- `electron/main/email/ipc.ts` — extend `aiCategorize` (or add new handler) to also return `recommendedAction`, `actionExplanation`, and optionally `draftReply` when `needs_reply`
- `src/components/EmailInboxBulkView.tsx` — new Action Card UI in right half, richer `aiOutputs` shape, merge AI Auto-Sort results into `aiOutputs`

**Key changes:**
1. Extend aiCategorize prompt/response to include `recommendedAction`, `actionExplanation`, `draftReply` (when needs_reply)
2. After aiCategorize, merge classifications into `aiOutputs` with full `BulkAiResult` shape
3. Render Action Card (category badge, urgency, summary, recommended action box, draft reply box when present)

**Risks:** Larger LLM payload, more tokens; prompt changes may affect JSON parsing.

---

### 6.2 Pending Delete Flow (Revised)

**Feasible:** Yes.

**Files to modify:**
- `src/components/EmailInboxBulkView.tsx` — remove `opacity: 0.6` for spam/irrelevant; add 15-second preview badge; change timer from 5 min to 15 sec (or add 15s preview phase)
- `electron/main/email/ipc.ts` — add `(pending_delete = 0 OR pending_delete IS NULL)` to "all" filter

**Key changes:**
1. Remove opacity reduction for spam/irrelevant
2. Show "PENDING DELETE" badge in action card for 15 seconds before calling markPendingDelete
3. Fix "all" filter to exclude pending_delete
4. 7-day flow already exists; ensure Pending Delete tab shows "Deletes on Mar 25" (compute from `pending_delete_at + 7 days`)

**Risks:** UX change from 5 min to 15 sec may surprise users; ensure Undo remains available.

---

### 6.3 Expand/Collapse Arrow (More Visible)

**Feasible:** Yes.

**Files to modify:**
- `src/App.css` — `.bulk-card-expand-toggle` styles

**Key changes:**
- Opacity: 0.5 resting, 0.85 hover
- Height: 24px
- Add label: `▾ Show more` / `▴ Show less`
- Background: `rgba(124, 58, 237, 0.03)` resting, `rgba(124, 58, 237, 0.08)` hover

**Risks:** None.

---

### 6.4 Normal Inbox — Remove Auto-Trigger, Keep Manual Buttons

**Feasible:** Yes.

**Files to modify:**
- `src/components/EmailInboxView.tsx` — InboxDetailAiPanel

**Key changes:**
1. Remove the `useEffect` that calls `runAnalysis()` on messageId change
2. Remove or hide: Response Needed, Urgency, Action Items, Archive sections
3. Keep: Summarize, Draft Reply buttons; show only summary and draft output on click

**Risks:** Users who relied on auto-analysis will need to click Summarize/Draft Reply.

---

### 6.5 Normal Inbox Message Title — Full Width

**Feasible:** Yes.

**Files to modify:**
- `src/components/EmailMessageDetail.tsx` — header block (lines 196–282)

**Key changes:**
1. Change outer div to `flexDirection: 'column'`
2. Title + From/To/Date: full width, first row
3. Buttons: second row, full width, left-aligned

**Risks:** None.

---

### 6.6 AI Output State Shape (Bulk)

**Feasible:** Yes.

**Files to modify:**
- `src/components/EmailInboxBulkView.tsx` — `aiOutputs` state and handlers

**Key changes:**
1. Define `BulkAiResult` type
2. Change `aiOutputs` to `Record<string, BulkAiResult>`
3. handleSummarize/handleDraftReply merge into this shape
4. AI Auto-Sort merges classifications into aiOutputs
5. Render logic uses `output?.category`, `output?.recommendedAction`, etc.

**Risks:** Migration of existing `{ summary, draft, loading }` into new shape; ensure backward compatibility during transition.
