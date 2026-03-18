# WR Desk™ — Full-Depth Regression Analysis: Inbox / Bulk Inbox Degradation Audit

**Goal:** Identify why recent refactor sessions degraded quality. Analysis only — no code changes.

---

## === PART 1: BULK RENDERING CURRENT STATE ===

### 1.1 Bulk card structure

**Full render structure of one bulk row/card:**

Each row is a `bulk-view-row` grid with `grid-template-columns: 1fr 1fr` and `grid-template-rows: 1fr auto`:

- **Left side (`bulk-view-message`):**
  - Checkbox, focus indicator (👉), from/sender
  - "View full" and "Delete" buttons
  - Subject (bold when urgent)
  - `sort_reason` (if present)
  - **`bulk-view-message-body`** — body snippet with links, scrollable (`overflow-y: auto`)
  - Footer: attachments count, category badge, needs-reply icon, pending-delete info, source badge

- **Right side (`bulk-view-ai`):**
  - `renderActionCard(msg, output, isCardExpanded)` — the AI output panel

- **Footer:**
  - `bulk-card-expand-toggle` — "▾ Show more" / "▴ Show less" to expand/collapse the row

**Expanded state:** Row grows (`height: auto`, `max-height: none`). Both left and right panels get `min-height: 120px`. Message body gets `overflow: visible` in expanded mode.

**What controls the right-side panel content:**

1. **`output?.loading`** → Loading state with "Loading…" + Delete button
2. **`hasStructured = !!(output?.category && output?.recommendedAction)`** → Full structured action card (Response Needed, Summary, Urgency, Draft, Action Items, Recommended Action, reasoning, countdown, buttons)
3. **`output?.summary || output?.draftReply`** (without full structured) → Fallback card: summary + draft + buttons
4. **Otherwise** → Empty state: "Summarize or draft a reply to see output here" + Summarize, Draft Reply, Delete buttons

### 1.2 Why analysis is missing

**Root cause:** Bulk Inbox does **not** auto-analyze when a row is focused or when messages load. Analysis appears only when:

1. User selects messages and clicks **"AI Auto-Sort"** → `aiCategorize` runs → `setBulkAiOutputs` populates `bulkAiOutputs`
2. User manually clicks **"Summarize"** or **"Draft Reply"** per row → `aiSummarize` / `aiDraftReply` → partial output (summary or draft only)

**Chain analysis:**

- **Backend:** `aiCategorize` returns `{ ok: true, data: { classifications: [...] } }` with full per-message data (category, summary, reason, recommended_action, action_explanation, etc.). IPC handler is implemented and writes to DB.
- **Frontend mapping:** `handleAiAutoSort` maps each classification to `BulkAiResult` and calls `setBulkAiOutputs((prev) => ({ ...prev, ...nextOutputs }))`. Mapping is correct.
- **State shape:** `bulkAiOutputs` is `Record<string, BulkAiResultEntry>`. When AI Auto-Sort succeeds, entries have `category` and `recommendedAction` → `hasStructured` is true → structured card renders.
- **Empty state condition:** When `output` is `undefined` or lacks both `category`/`recommendedAction` and `summary`/`draftReply`, the empty state renders. This happens when:
  - User has never run AI Auto-Sort or Summarize/Draft for that message
  - `aiCategorize` returned empty classifications (Ollama unavailable, JSON parse failure)
  - `ids` from request don't match parsed `id` from LLM (e.g. wrong format)

**Conclusion:** The analysis is missing because **Bulk does not auto-run analysis on load or focus**. Normal Inbox runs `aiAnalyzeMessage` automatically when a message is selected. Bulk requires an explicit "AI Auto-Sort" click. The empty right panel is the default state, not a bug — but it feels broken because users expect the same auto-analysis behavior as Normal Inbox.

### 1.3 Action-card degradation

**Structured `BulkAiResult` model:** Exists. `BulkAiResult` and `BulkAiResultEntry` are defined in `inboxAi.ts`. The action card logic is intact.

**Conditional rendering:** The action card is conditionally rendered based on:
- `output?.loading` → loading UI
- `hasStructured` → full structured card
- `output?.summary || output?.draftReply` → fallback card
- else → empty state

**Required fields for structured card:** `category` and `recommendedAction`. Both come from `aiCategorize` response.

**Why buttons show in empty space:** The empty state is the **intended fallback** when no AI output exists. It shows:
- "Summarize or draft a reply to see output here"
- Summarize, Draft Reply, Delete buttons

This is not a fallback logic bug — it is the default when `bulkAiOutputs[msg.id]` is undefined or incomplete. The **perceived degradation** is that users expect to see analysis (like Normal Inbox) without having to click AI Auto-Sort. The empty state feels like "buttons only" because the primary content is the call-to-action text plus three buttons, with no analysis.

**Fallback logic:** Correct. When `hasStructured` is false but `summary` or `draftReply` exists (e.g. after manual Summarize/Draft), the fallback card shows. When neither exists, empty state shows.

---

## === PART 2: AI DATA FLOW ===

### 2.1 Bulk AI data flow

1. **Trigger:** User selects messages, clicks "AI Auto-Sort" → `handleAiAutoSort`
2. **Backend:** `window.emailInbox.aiCategorize(ids)` → IPC `inbox:aiCategorize`
3. **IPC handler** (`ipc.ts`): Fetches messages from DB, builds prompt, calls `callInboxOllamaChat`, parses JSON array, validates categories/actions, writes `sort_category`, `sort_reason`, `urgency_score`, `needs_reply` to DB, returns `{ classifications: [...] }`
4. **Response shape:** Each classification has `id`, `category`, `summary`, `reason`, `needs_reply`, `needs_reply_reason`, `urgency_score`, `urgency_reason`, `recommended_action`, `action_explanation`, `action_items`, `draft_reply?`, `pending_delete`
5. **Frontend transform:** Maps to `BulkAiResult` (camelCase), sets `pendingDeletePreviewUntil` / `archivePreviewUntil` for pending_delete/archive
6. **State write:** `setBulkAiOutputs((prev) => ({ ...prev, ...nextOutputs }))`
7. **Preview:** `addPendingDeletePreview(pendingIds)`, `addArchivePreview(archiveIds)` — 5s grace
8. **Refresh:** `fetchMessages()` — messages get updated `sort_category` from DB
9. **Render:** `bulkAiOutputs[msg.id]` read in `renderActionCard`; when `category` and `recommendedAction` exist, structured card renders

**Where it can break:**
- Ollama unavailable → `classifications: []` → no outputs set
- LLM returns invalid JSON → `parsed = []` → no outputs
- LLM returns wrong `id` format → `ids.includes(id)` fails → entry skipped
- User never clicks AI Auto-Sort → `bulkAiOutputs` stays empty

### 2.2 Normal AI data flow

1. **Trigger:** User selects a message → `InboxDetailAiPanel` mounts with `messageId`
2. **Effect:** `useEffect` runs `runAnalysis()` when `messageId` changes
3. **Backend:** `window.emailInbox.aiAnalyzeMessage(messageId)` → IPC `inbox:aiAnalyzeMessage`
4. **IPC handler:** Fetches message, calls LLM, parses JSON, returns `NormalInboxAiResult` (needsReply, summary, urgencyScore, archiveRecommendation, etc.)
5. **State:** Local `useState` in `InboxDetailAiPanel` — `setAnalysis(result)`
6. **Render:** Sections for Response Needed, Summary, Urgency, Draft Reply, Action Items, Suggested action

**Key difference:** Normal Inbox **auto-runs** analysis on selection. Bulk Inbox **requires** explicit AI Auto-Sort.

### 2.3 Where the chain breaks

**For Bulk:** The chain does not break in the technical sense. When AI Auto-Sort runs successfully, data flows correctly. The **behavioral gap** is:

- **Normal:** Select message → analysis runs automatically → panel shows full analysis
- **Bulk:** Load messages → no analysis runs → every row shows empty state with buttons

Users expect Bulk to show analysis without an extra click. The "missing analysis" is a **UX/expectation mismatch**, not a data-flow bug. If users do run AI Auto-Sort and it fails (Ollama down, parse error), then the chain breaks at the backend, and empty classifications mean no `bulkAiOutputs` updates.

---

## === PART 3: NORMAL VS BULK AI UX ===

### 3.1 Normal Inbox analysis layout

**State shape:** `NormalInboxAiResult` — needsReply, needsReplyReason, summary, urgencyScore, urgencyReason, actionItems, archiveRecommendation, archiveReason. Stored in local `useState` in `InboxDetailAiPanel`.

**Panel trigger:** Message selection. `useEffect` on `messageId` runs `runAnalysis()`.

**Layout:** `inbox-detail-ai-scroll` (flex, overflow-y: auto) contains:
- Advisory banner: "AI suggestions — you decide what to do"
- Buttons: Summarize, Draft Reply, Delete
- Response Needed (dot + Yes/No + reason)
- Summary
- Urgency (bar + X/10 + reason)
- Draft Reply (textarea, editable)
- Action Items (checklist)
- Suggested action (archive/keep + Archive button)

### 3.2 Bulk Inbox analysis layout

**Equivalent sections when structured card renders:**
- Response Needed ✓
- Summary ✓
- Urgency (bar + X/10 + reason) ✓
- Draft Reply ✓
- Action Items ✓
- Recommended Action (panel + reasoning "Why:") ✓
- Pending/Archive preview + countdown + Keep ✓
- Buttons: Send, Archive, Delete, Summarize, Draft ✓

**What exists:** Full parity when `hasStructured` is true. The structured card mirrors Normal Inbox sections.

**What is missing in default state:** Any analysis. Without AI Auto-Sort, every row shows the empty state. Normal Inbox shows analysis as soon as you select a message.

**Divergence:** Bulk does not auto-analyze. The right panel is a **per-row** workspace; when empty, it shows buttons. Normal uses a **single** right panel for the selected message and auto-populates it.

### 3.3 Regression delta

**Intended shared AI UX:** Both modes should show the same depth of reasoning (urgency, summary, recommended action, reasoning). Both should feel like one AI system.

**Current Bulk regression:**
- **No auto-analysis** — User must click AI Auto-Sort. Empty rows dominate until then.
- **Empty state prominence** — When no output, the right panel is mostly buttons. Feels like "button parking" rather than a workspace.
- **No proactive guidance** — Empty state says "Summarize or draft" but does not suggest "Select messages and click AI Auto-Sort to analyze this batch."

**What was lost:** The expectation that Bulk would surface AI reasoning as readily as Normal. The code supports full reasoning when data exists; the trigger (AI Auto-Sort) is easy to miss, and the empty state does not guide users toward it.

---

## === PART 4: SCROLL + LAYOUT REGRESSIONS ===

### 4.1 Message scroll behavior

**Current behavior:** Only `bulk-view-message-body` scrolls. CSS:
- `bulk-view-message`: `overflow: hidden`, flex column
- `bulk-view-message-body`: `flex: 1`, `min-height: 0`, `overflow-y: auto`, `overflow-x: hidden`

**Structure:** The message card has a flex column. The header (from, subject, sort_reason) and footer (badges) are in sibling divs. The body is the middle flex child with `overflow-y: auto`. So the **body snippet** is the scroll container; the header and footer stay fixed.

**Desired:** The entire message area (header + body + footer) should scroll together as one unit.

**Fix direction:** Move `overflow-y: auto` to the parent `bulk-view-message` (or a wrapper containing header + body + footer), and remove overflow from `bulk-view-message-body` so it flows naturally.

### 4.2 Workspace / output panel behavior

**Current:** The right panel (`bulk-view-ai`) contains `renderActionCard`. When empty, it shows:
- "Summarize or draft a reply to see output here"
- Summarize, Draft Reply, Delete buttons

**Why it feels wrong:** The right side is the "AI workspace." When empty, it is used as a **button area** — the primary content is three buttons. There is no meaningful workspace content (e.g. "Select messages and run AI Auto-Sort" or a placeholder that explains the workflow).

**Layout:** The panel is `grid-column: 2` in the row. It has `min-height: 0`, `flex: 1` (from bulk-action-card). The empty state uses `justify-content: center`, `align-items: center` — buttons are centered. Vertical space is underused for guidance or context.

**Appropriateness:** For an enterprise workspace, the empty state should either (a) explain the workflow and prompt AI Auto-Sort, or (b) show a minimal preview (e.g. message metadata) rather than only buttons.

### 4.3 Draft area behavior

**Normal mode:** Draft is in `inbox-detail-ai-row-draft` with `inbox-detail-ai-draft-textarea`. Scrollable parent is `inbox-detail-ai-scroll`. Full height is used within the scroll area.

**Bulk mode:** Draft is in `bulk-action-card-row-draft` with `bulk-action-card-draft-textarea`. Parent is `bulk-action-card-sections` with `overflow-y: auto`. In compact mode, `bulk-action-card-draft-textarea` gets smaller font/padding. Rows are fixed height (320px standard, 192px compact) until expanded.

**Regression:** In compact mode, the draft area is compressed. The bulk-action-card has `min-height: 0`, `flex: 1`; the sections scroll. No obvious regression in draft height logic — the main issue is the overall row height constraint and scroll behavior of the message body.

---

## === PART 5: SELECTION / BATCH REGRESSIONS ===

### 5.1 Current selection behavior

**Controls present:**
- **Select all** — Checkbox in toolbar; toggles all visible messages
- **Per-row checkbox** — Each row has a checkbox for multi-select
- **Selected count** — "X selected" when `selectedCount > 0`
- **Batch size selector** — `<select>` with options 10, 12, 24, 48; controls `bulkBatchSize` (page size)

**What user can select:**
- Individual messages (per-row checkbox)
- All visible messages (Select all)
- Batch size determines how many messages are loaded per page (10/12/24/48)

**Batch/page-size controls:** The batch selector exists at the **end** of the toolbar (after `flex: 1`), labeled "Batch" with a dropdown. It is **not** adjacent to the Select all checkbox.

### 5.2 Divergence from intended batch model

**Intended:** Checkbox + nearby selector for batch size (e.g. 10 / 24 / 48), clear selected count, deterministic batch workflow.

**Current:**
- Checkbox and batch selector are **far apart** — checkbox at start, batch at end
- Batch selector is present and functional
- No "page batch" concept beyond "load N per page" — user selects from visible messages
- Selected count is shown when `selectedCount > 0`

**Regression:** The batch selector is **relocated** to the far right. The intended "checkbox + nearby selector" grouping is not implemented. The workflow is deterministic (select → AI Auto-Sort → actions), but the layout does not match the reference.

---

## === PART 6: HEADER / TOOLBAR REGRESSIONS ===

### 6.1 Current toolbar structure

Bulk view uses an **inline toolbar** in `EmailInboxBulkView` (not `EmailInboxToolbar`). Order:

1. Select all (checkbox + label)
2. Selected count (when > 0)
3. Separator
4. Filter tabs: All, Pending Delete, Archived
5. Session progress (Archived X, Pending Y, remaining)
6. Separator
7. Auto-sync (checkbox)
8. Pull button
9. Separator
10. Delete (icon)
11. Archive
12. AI Auto-Sort
13. `flex: 1` (spacer)
14. Compact toggle
15. "Batch" label + batch size select

### 6.2 Space waste / control issues

- **Horizontal spread:** `flex: 1` pushes batch selector and compact toggle to the far right. Select all and batch selector are separated by many controls.
- **Filter tabs:** Three filter buttons with inline styles. Could be grouped more tightly.
- **Redundancy:** Delete and Archive appear both in toolbar and in each row's action card. Not necessarily wrong, but adds visual noise.
- **Missing grouping:** Selection controls (Select all, batch size, selected count) are not grouped. Action controls (Delete, Archive, AI Auto-Sort) are grouped but mixed with sync controls.

---

## === PART 7: AUTOMATIC ACTION PIPELINE ===

### 7.1 Archive flow

1. AI Auto-Sort returns `recommended_action: 'archive'` for some messages
2. Frontend sets `archivePreviewUntil` in `bulkAiOutputs` and calls `addArchivePreview(archiveIds)`
3. `addArchivePreview` sets `archivePreviewExpiries[id] = expiresAt` (5s from now), removes ids from `keptDuringArchivePreviewIds`
4. `ArchiveCountdown` shows "Archiving in Xs"
5. `pendingDeletePreviewScheduler` runs every 1s: `incrementCountdownTick`, `processExpiredArchivePreviews`
6. `processExpiredArchivePreviews` finds expired ids, calls `archiveMessages(idsToArchive)`
7. Messages are archived and removed from list; `clearBulkAiOutputsForIds` clears their outputs

**Grace period:** 5 seconds. **Keep:** `keepDuringArchivePreview` adds id to `keptDuringArchivePreviewIds`; expired check skips those ids.

### 7.2 Pending Delete flow

1. AI Auto-Sort returns `pending_delete: true` (spam/irrelevant/newsletter) for some messages
2. Frontend sets `pendingDeletePreviewUntil` and calls `addPendingDeletePreview(pendingIds)`
3. `addPendingDeletePreview` sets `pendingDeletePreviewExpiries[id] = expiresAt` (5s)
4. `PendingDeleteCountdown` shows "Moving in Xs"
5. Scheduler runs `processExpiredPendingDeletes`
6. `processExpiredPendingDeletes` calls `markPendingDelete(idsToMove)` → DB update `pending_delete = 1`
7. Toast shown; `fetchMessages` refreshes; messages move to Pending Delete (still in "all" filter depending on backend)

**Grace period:** 5 seconds. **Keep:** `keepDuringPreview` adds id to `keptDuringPreviewIds`.

### 7.3 Undo / Keep behavior

- **Keep during preview:** "Keep" button in the pending/archive preview area; cancels the scheduled auto-action for that message
- **Undo after move:** For pending delete, toast shows "Undo"; `handleUndoPendingDelete` calls `cancelPendingDelete`, clears toast, removes from recent batches, decrements session count, clears state, fetches messages

**State:** `keptDuringPreviewIds`, `keptDuringArchivePreviewIds` persist across view switches. Coherent.

### 7.4 State-machine coherence

The state machine is coherent:
- `pendingDeletePreviewExpiries`, `archivePreviewExpiries` — when each preview expires
- `keptDuringPreviewIds`, `keptDuringArchivePreviewIds` — user opted to keep
- Scheduler runs every 1s when either has entries
- Expired ids are processed; kept ids are skipped
- Archive and pending delete are handled symmetrically

---

## === PART 8: SORTING / PRIORITY LOGIC ===

### 8.1 Current sort order

`sortMessagesByCategory` uses `CATEGORY_ORDER`:
- spam: 0, irrelevant: 1, newsletter: 2, normal: 3, important: 4, urgent: 5

Secondary sort: `urgency_score` descending (higher first). Tertiary: `received_at` descending.

**Result:** Pending-delete candidates (spam, irrelevant, newsletter) first, then archive candidates (normal), then manual-review (important, urgent) last. Matches intended "speed-first" order.

### 8.2 Cleanup suitability

Sorting supports fast cleanup: low-value mail appears first. Post-processing in `aiCategorize` forces spam/irrelevant → pending_delete, newsletter (no reply) → pending_delete, normal (low urgency, no reply) → archive. "Manual review" is used sparingly per prompt and overrides.

**Potential issue:** If the LLM overuses `keep_for_manual_action`, post-processing overrides it for spam/irrelevant/newsletter and for normal+low-urgency. The logic is sound; any overuse would be from the model, not the code.

---

## === PART 9: PERFORMANCE-RELEVANT REGRESSIONS ===

### 9.1 Rendering / rerender observations

- **Countdown components:** `PendingDeleteCountdown` and `ArchiveCountdown` subscribe to `countdownTick`. When previews exist, `countdownTick` increments every second → these components re-render every second. Each row with a preview has one of these.
- **Bulk row rendering:** Rows are rendered in a single `.map`; there is no `React.memo` or row extraction. When `bulkAiOutputs`, `multiSelectIds`, `expandedCardIds`, `pendingDeletePreviewExpiries`, `archivePreviewExpiries`, etc. change, **all rows** re-render.
- **Store subscription:** `useEmailInboxStore(useShallow(...))` selects many fields. Any change to those fields causes the whole component to re-render, and thus all rows.
- **Empty state:** Empty state rendering is cheap (a few divs and buttons). Not a major cost.
- **Scheduler:** Runs every 1s when previews exist. Causes `countdownTick` update → store update → subscriber re-renders. Acceptable for typical batch sizes.

### 9.2 State fragility observations

- **bulkAiOutputs** is keyed by message id. When messages are archived/deleted, `clearBulkAiOutputsForIds` removes them. Orphaned entries could accumulate if ids are not cleared in all code paths — low risk.
- **View switch:** When switching Normal ↔ Bulk, `setBulkMode` runs. `bulkAiOutputs` persists. Preview expiries and kept sets persist. Scheduler keeps running. No obvious fragility.
- **Pagination:** Changing `bulkPage` fetches new messages. `bulkAiOutputs` is not cleared. Old page's outputs remain; new page's messages may have no outputs. Expected.

---

## === PART 10: ROOT CAUSE SUMMARY ===

### 10.1 Broken behaviors

1. **Bulk Inbox shows no analysis by default** — Empty state with buttons until user runs AI Auto-Sort
2. **Scroll: only message body scrolls** — Header and footer stay fixed; entire message area should scroll together
3. **Empty workspace feels like button parking** — Right panel shows buttons instead of guidance or meaningful workspace content
4. **Batch selector far from checkbox** — Not "checkbox + nearby selector" as intended
5. **No auto-analysis in Bulk** — Normal auto-analyzes on selection; Bulk does not
6. **Perceived loss of reasoning depth** — When AI Auto-Sort is not run, no reasoning is visible; when run, full reasoning exists but is easy to miss

### 10.2 Likely root causes

1. **No auto-analysis trigger** — Bulk never calls `aiCategorize` or `aiAnalyzeMessage` on load or focus
2. **Layout/scroll container** — `overflow-y: auto` on `bulk-view-message-body` instead of parent
3. **Empty state design** — Emphasizes buttons over workflow guidance
4. **Toolbar layout** — `flex: 1` separates selection controls from batch selector
5. **Shared logic divergence** — Normal auto-runs analysis; Bulk requires explicit action
6. **Expectation mismatch** — Users expect Bulk to behave like Normal (auto-analysis, visible reasoning)

### 10.3 What must be restored first

1. **Auto-run analysis for Bulk** — On load or when first row is focused, run `aiCategorize` for the current batch (or a subset) so analysis appears without requiring AI Auto-Sort click. Alternatively, make the empty state clearly prompt "Select messages and click AI Auto-Sort" so the workflow is obvious.
2. **Fix message scroll** — Move scroll container to the full message area (header + body + footer) so the whole card scrolls together.
3. **Improve empty workspace** — Replace or augment the button-only empty state with guidance (e.g. "Select messages above and click AI Auto-Sort to analyze") so the right panel functions as a workspace, not just a button area.
4. **Group selection controls** — Place Select all, batch size selector, and selected count together (e.g. checkbox | batch 10/24/48 | "X selected").
5. **Align Bulk with Normal** — Ensure both modes surface AI reasoning by default; if Bulk cannot auto-analyze on load (cost/latency), at least make the trigger and empty state clearly guide the user.

---

*End of analysis. No code changes made.*
