# WR Desk™ — Full Inbox & Bulk Inbox Value Optimization Audit

**Goal:** Maximize how quickly and confidently users can clean up super large inboxes.

**Scope:** Analysis only. No code changes.

---

## === PART 1: FULL INBOX CURRENT STATE ===

### 1.1 Inbox modes and responsibilities

**Implemented inbox modes/views:**

| Mode | Component | Trigger |
|------|-----------|---------|
| **Normal Inbox** | `EmailInboxView` | `inboxBulkMode === false` |
| **Bulk Inbox** | `EmailInboxBulkView` | `inboxBulkMode === true` |
| **Pending Delete** | Filter tab within both views | `filter.filter === 'pending_delete'` |
| **Deleted** | Filter tab | `filter.filter === 'deleted'` |
| **Unread, Starred, Archived** | Filter tabs | Same store filter |

**Responsibilities by view:**

| Responsibility | Normal Inbox | Bulk Inbox | Pending Delete |
|----------------|--------------|------------|----------------|
| **Reading** | Yes — single message, 50/50 message + AI panel | Yes — grid of cards, left=message preview, right=AI output | Yes — same card layout as Bulk |
| **Triaging** | No — single-message focus | Yes — multi-select, batch actions | Yes — Undo, view countdown |
| **AI analysis** | `aiAnalyzeMessage` (single) | `aiCategorize` (batch) | N/A — messages already classified |
| **AI categorization** | No — advisory only | Yes — writes `sort_category`, `sort_reason`, `urgency_score`, `needs_reply` to DB | N/A |
| **Deletion flow** | Manual Delete button | Bulk Delete, AI Auto-Sort → 15s → markPendingDelete | Undo, 7-day countdown, eventual remote deletion |
| **Reply workflow** | Draft Reply → editable textarea → Send via Email/BEAP | Draft Reply per card, editable textarea, Send via Email | Same as Bulk when viewing |

### 1.2 Normal vs Bulk separation

**Code separation:** Clear. `App.tsx` switches between `EmailInboxView` and `EmailInboxBulkView` based on `inboxBulkMode`. Each has its own layout, AI handlers, and state.

**UI separation:** Toolbar has a Bulk Mode toggle. When enabled, the entire view switches to the grid layout. Filter tabs (All, Pending Delete, etc.) are shared via the store.

**AI responsibility split:**
- **Normal:** `aiAnalyzeMessage` — returns `NormalInboxAiResult` (needsReply, summary, urgencyScore, archiveRecommendation). No DB writes. Advisory only.
- **Bulk:** `aiCategorize` — returns classifications, writes to DB, triggers 15s pending-delete timer for spam/irrelevant. Authoritative.

**Overlap/confusion:** Both use `aiSummarize` and `aiDraftReply` for per-message operations. Bulk can call these manually (Summarize, Draft buttons) before or after Auto-Sort. Normal calls `aiAnalyzeMessage` on selection; Bulk does not auto-analyze on selection.

---

## === PART 2: NORMAL INBOX CURRENT STATE ===

### 2.1 Selection and AI behavior

**What happens when a user selects a message in Normal Inbox:**

- `useEffect` in `InboxDetailAiPanel` runs `runAnalysis()` when `messageId` changes.
- `runAnalysis` calls `window.emailInbox.aiAnalyzeMessage(messageId)`.
- **AI runs automatically on selection.** No manual trigger required.

**Function called:** `inbox:aiAnalyzeMessage` (IPC) → `aiAnalyzeMessage` (preload).

**Data returned:** `NormalInboxAiResult` — needsReply, needsReplyReason, summary, urgencyScore, urgencyReason, actionItems, archiveRecommendation, archiveReason.

**Sections rendered:** Response Needed, Summary, Urgency (bar + score), Draft Reply (manual trigger), Action Items, Suggested action (archive/keep).

### 2.2 AI panel sections

| Section | Source | Auto/Manual | Visually useful? | Helps process faster? |
|---------|--------|-------------|------------------|------------------------|
| **Advisory banner** | Static | N/A | Yes — "AI suggestions — you decide what to do" | Yes — sets tone |
| **Response Needed** | aiAnalyzeMessage | Auto | Yes — dot + Yes/No + reason | Yes |
| **Summary** | aiAnalyzeMessage | Auto | Yes — 2–3 sentences | Yes |
| **Urgency** | aiAnalyzeMessage | Auto | Yes — bar + score + reason | Yes |
| **Draft Reply** | aiDraftReply | Manual (Draft Reply button) | Yes — editable textarea | Yes when needed |
| **Action Items** | aiAnalyzeMessage | Auto | Yes — checklist | Moderate |
| **Suggested action** | aiAnalyzeMessage | Auto | Yes — "Consider archiving" / "Keep for now" | Yes |

### 2.3 Draft reply flow

- **Can AI generate a reply draft?** Yes — via "Draft Reply" button.
- **Where displayed?** In the Draft Reply row, inline in the AI panel.
- **Inline or separated?** Inline — same scrollable panel as other sections.
- **Editable?** Yes — always shown in a textarea. No Edit/Preview toggle.
- **Feel:** Ready-to-send assistance. User can edit, Regenerate, or Send. Advisory tone preserved.

### 2.4 Advisory vs authoritative

- **Advisory banner** explicitly states "you decide what to do."
- **Suggested action** uses "Consider archiving" / "Keep for now" — suggestive, not commanding.
- **Archive button** is secondary style; user must click to act.
- **No auto-move, no pending delete, no bulk automation.**
- **Correct tone:** Advisory. User remains in control.

### 2.5 Value assessment — Normal Inbox

**Strong value:**
- Auto-analysis on selection reduces friction.
- Urgency bar and summary aid quick comprehension.
- Editable draft is integrated and actionable.
- Advisory framing builds trust.

**Distracting:**
- Action Items checklist may add cognitive load for simple emails.
- Two manual buttons (Summarize, Draft Reply) when analysis already runs — Summarize is redundant if analysis includes summary.

**Improvement opportunities:**
- Consider auto-running Draft Reply when needsReply is true.
- Collapse or de-emphasize Action Items when empty or low value.

---

## === PART 3: BULK INBOX CURRENT STATE ===

### 3.1 Batch flow

**When user selects multiple messages and runs AI Auto-Sort:**

1. `handleAiAutoSort` collects `multiSelectIds`.
2. Single IPC call: `window.emailInbox.aiCategorize(ids)` — **one call for the entire batch**.
3. Response: `{ classifications: [...] }` — array of per-message results.
4. **DB writes:** `sort_category`, `sort_reason`, `urgency_score`, `needs_reply` for each message.
5. **Frontend state:** `aiOutputs` updated with `BulkAiResult` per message.
6. **Visual updates:** Messages re-sorted by category; left border and background tint by category; action cards populate on right.
7. **Pending delete:** For spam/irrelevant (`pending_delete: true`), 15s timer starts; after 15s, `markPendingDelete` called; toast shown; `fetchMessages` refreshes; messages leave All (filter excludes `pending_delete=1`).

### 3.2 Classification model

**sort_category enum:** urgent, important, normal, newsletter, spam, irrelevant.

**Meaning in practice:**
- **urgent:** Invoices, deadlines, security — preserve.
- **important:** Operationally relevant, reply-worthy — preserve.
- **normal:** Catch-all — often archive.
- **newsletter:** Bulk mail — usually pending_delete.
- **spam/irrelevant:** Low-value — pending_delete, auto-move after 15s.

**Categories drive workflow:** Yes. Category determines border color, background tint, sort order, and for spam/irrelevant — automatic 15s → markPendingDelete.

**Strictness:** Prompt says "Be aggressive," "MINIMIZE clutter," "Default to pending_delete or archive." Post-processing forces spam/irrelevant → pending_delete, newsletter (no reply) → pending_delete, normal (low urgency, no reply) → archive or pending_delete. **Not biased toward keeping** — biased toward cleanup.

### 3.3 AI output area

**What renders:**
- **After AI Auto-Sort:** Structured action card — category badge, urgency (U1–U10), summary, reason, recommended action panel, action explanation, editable draft (if present), action buttons (Send, Archive, Delete, Summarize, Draft).
- **After Summarize only:** Fallback — summary + optional draft + buttons.
- **After Draft Reply only:** Fallback — draft textarea + Send + Summarize + Draft.
- **Empty:** "Summarize or draft a reply to see output here" + Summarize, Draft Reply.

**Structured:** Yes. Full action card when `category` and `recommendedAction` exist.

**Action recommendation:** Yes — prominent panel with label "Recommended" and action (Pending Delete, Archive, Manual, Draft Reply).

**Editable draft:** Yes — textarea with "Draft reply — edit before sending."

**Helps clean quickly?** Yes — category and action are scannable; primary buttons (Send, Archive, Delete) are contextual. Some reading required for summary/reason, but hierarchy supports fast decisions.

### 3.4 Authority and automation

- **AI classification affects workflow:** Yes — DB updated, messages re-sorted, spam/irrelevant auto-move after 15s.
- **AI recommends/triggers cleanup:** Yes — recommended action drives button visibility; pending_delete triggers timer.
- **Low-value pushed out fast:** Yes — 15s preview, then move to Pending Delete; All excludes them.
- **Feels like bulk-cleanup system:** Yes — batch selection, one-click Auto-Sort, authoritative recommendations, automatic pending delete for spam/irrelevant.

**Caveat:** Newsletter with `recommended_action: pending_delete` does **not** auto-move (backend sets `pending_delete: true` only for spam/irrelevant). Newsletter shows "Delete to move to Pending Delete" — user must click Delete manually.

### 3.5 Value assessment — Bulk Inbox

**Works well:**
- One batch call for Auto-Sort.
- Structured action cards with clear hierarchy.
- 15s preview for spam/irrelevant.
- Editable drafts inline.
- Category-based sorting and visuals.

**Time waste:**
- Newsletter with pending_delete recommendation requires manual Delete — no auto-move.
- Summarize/Draft buttons on every card add clutter when Auto-Sort already provided summary/draft.

**UX vs cleanup goal:**
- Largely aligned. Main gap: newsletter auto-move would increase throughput.

---

## === PART 4: AI ACTIONABILITY ===

### 4.1 Recommended actions

| Mode | Recommended action? | Form | Prominent? | Under 2 seconds? | Reduces work? |
|------|---------------------|------|------------|------------------|---------------|
| **Normal** | Yes | "Consider archiving" / "Keep for now" + Archive button | Moderate — secondary button | Yes | Yes |
| **Bulk** | Yes | Panel with "Recommended" + action (Pending Delete, Archive, Manual, Draft Reply) + contextual buttons | Yes — dedicated panel | Yes | Yes |

### 4.2 Draft usability

- **Both modes:** AI can create reply drafts.
- **Display:** Editable textarea in both. Not plain read-only text.
- **Editable before send:** Yes.
- **Integrated:** Yes — inline in the flow, next to message context.
- **Bulk "quick finish":** Yes — Send via Email uses edited draft, opens compose pre-filled.
- **Normal "helpful assistance":** Yes — advisory tone, user edits and sends.

### 4.3 State richness / extensibility

- **Normal:** `NormalInboxAiResult` — flat object with needsReply, summary, urgency, actionItems, archiveRecommendation. Stored in component state.
- **Bulk:** `BulkAiResult` — category, urgencyScore, summary, reason, recommendedAction, actionExplanation, draftReply, status, pendingDeletePreviewUntil. Stored in `aiOutputs` Record.
- **Architecture:** Bulk state is richer and extensible. Easy to add more fields (e.g., confidence, alternative actions). Normal is simpler but sufficient for advisory use.

---

## === PART 5: PENDING DELETE PIPELINE ===

### 5.1 Marking

- **Fields:** `pending_delete` (1/0), `pending_delete_at` (ISO timestamp).
- **When:** After 15s timer (for spam/irrelevant from Auto-Sort) or when user clicks Delete on a pending_delete recommendation (newsletter).
- **How:** `inbox:markPendingDelete` IPC — `UPDATE inbox_messages SET pending_delete = 1, pending_delete_at = ?`.

### 5.2 Preview / grace period

- **Preview state:** 15 seconds before `markPendingDelete` for spam/irrelevant. Shown as "PENDING DELETE" banner + "Moving in 15s" in action card.
- **Logic:** Frontend timer in `handleAiAutoSort`; `pendingDeletePreviewUntil` stored in aiOutputs for spam/irrelevant only.
- **Duration:** 15 seconds.
- **Appropriate:** Yes for fast cleanup. Newsletter shows "Delete to move to Pending Delete" (no auto-move).

### 5.3 Filtering and visibility

- **Pending Delete tab:** Toolbar filter; `filter.filter === 'pending_delete'`.
- **Query:** `deleted = 0 AND pending_delete = 1`.
- **All filter:** Excludes `pending_delete = 1` — `(pending_delete = 0 OR pending_delete IS NULL)`.
- **Duplicate display:** No — messages appear only in Pending Delete after move.
- **Trust/clarity:** Delete date/countdown shown per message ("Deletes on Mar 25" / "Deletes in 6d 18h"). Undo available from toast and per-card.

### 5.4 7-day final deletion

- **Where:** Periodic interval in ipc.ts (every 5 min). Selects messages where `pending_delete = 1` AND `pending_delete_at <= 7 days ago`.
- **Action:** `queueRemoteDeletion(db, id, 0)` — grace period 0, so immediate eligibility for `deletion_queue`.
- **Local + remote:** `queueRemoteDeletion` sets `deleted = 1`, `deleted_at`, `purge_after`; inserts into `deletion_queue`. `executePendingDeletions` runs every 5 min, calls `emailGateway.deleteMessage` for queue entries whose `grace_period_ends` has passed.
- **Remote deletion:** Yes — via IMAP/Graph API through `emailGateway.deleteMessage`.
- **Pipeline:** Complete. 7-day grace → queue → execute → remote delete. Purge of local rows 30 days after `remote_deleted_at`.

### 5.5 Value assessment — Pending Delete

- **Understandable:** Yes — countdown, Undo, clear tab.
- **Transparent:** Yes — "Deletes on Mar 25" / "Deletes in 6d 18h."
- **Reversible:** Yes — Undo restores to All.
- **Fast enough:** 15s preview is quick.
- **Clutter-free:** Messages leave All; only in Pending Delete tab.

---

## === PART 6: VISUALIZATION & SCAN SPEED ===

### 6.1 Bulk card scan speed

- **Left half:** From, subject, body preview (truncated), category badge, needs-reply icon, Undo (if pending delete), source badge, View full button.
- **Right half:** Action card (category, urgency, summary, reason, recommended action, draft, buttons).
- **Scannable without expand:** Category (border + badge), urgency (U1–U10), recommended action, primary buttons.
- **Low-priority details:** Reason, action explanation — useful but secondary.
- **Hierarchy:** Category and action are prominent. Good for category, urgency, and action recognition.

### 6.2 Expand / collapse UX

- **Exists:** Yes — `bulk-card-expand-toggle` at bottom of each row.
- **Placement:** Full width, bottom of card. "▾ Show more" / "▴ Show less."
- **Visibility:** 24px height, purple tint, opacity 0.5 → 0.85 on hover. Clearly visible.
- **Expanded behavior:** `bulk-view-row--expanded` — height auto, message body overflow visible, AI area min-height 120px. Both halves grow.
- **Helps scan speed:** Yes — collapsed keeps cards compact; expand for full read when needed.

### 6.3 Visual trust signals

| Element | Effect |
|---------|--------|
| Category border (4px left) | Strong — immediate category recognition |
| Category badge | Good — reinforces category |
| Background tint | Subtle — supports category |
| PENDING DELETE banner | Strong — red, clear |
| Recommended action panel | Good — purple accent, prominent |
| Countdown ("Moving in 15s") | Good — sets expectation |
| Delete date in Pending Delete | Good — "Deletes on Mar 25" |
| No dimming/strikethrough | Good — all messages readable |

**Readability:** No dimming or strikethrough on low-value messages. Good for trust and scan speed.

### 6.4 Visualization value assessment

**Creates value:** Category borders, badges, action panel, expand toggle, delete countdown.

**Optimization opportunities:** Slightly reduce summary/reason text density for faster scan; consider icon-only primary actions for power users.

---

## === PART 7: MESSAGE DETAIL LAYOUT ===

### 7.1 Header / title layout

- **Structure:** Stacked — subject full-width row, then action buttons, then metadata (From, To, date).
- **Subject:** `width: 100%`, `wordBreak: 'break-word'` — not squeezed by buttons.
- **Styles:** Inline in `EmailMessageDetail.tsx`. Subject is `h2`, 18px, bold.

### 7.2 Reading flow quality

- **Fast comprehension:** Yes — subject prominent, metadata clear.
- **Action clarity:** Star, Archive, Delete, Reply in dedicated row.
- **Reply drafting:** Via Normal Inbox AI panel or Bulk action card.
- **Archive/delete confidence:** Buttons visible and labeled.
- **Cognitive load:** Low — clean hierarchy.

---

## === PART 8: THROUGHPUT FRICTION ===

### 8.1 Time wasters

- **Newsletter manual Delete:** Newsletter with pending_delete recommendation does not auto-move; user must click Delete.
- **Summarize/Draft on every card:** After Auto-Sort, Summarize and Draft buttons remain on each card — redundant when summary/draft already present.
- **No keyboard shortcuts:** No bulk-action keyboard support.
- **Batch size:** Max 48 per page — may require pagination for very large inboxes.
- **Provider section:** Collapsible but adds vertical space when expanded.

### 8.2 Trust friction

- **Newsletter "Moving in 15s" vs "Delete to move":** Fixed — only spam/irrelevant show "Moving in 15s"; newsletter shows "Delete to move to Pending Delete."
- **No "Keep" during 15s:** User cannot cancel auto-move during preview for spam/irrelevant.
- **7-day clarity:** Countdown helps; some users may want explicit "Permanently deleted from server after 7 days" note.

### 8.3 Value gaps

- **Good AI output, weaker rendering:** Action cards are strong; could emphasize primary action even more (e.g., larger Send button).
- **Useful recommendations, lower emphasis:** Archive button is secondary; could be more prominent when recommended.
- **Newsletter auto-move:** Backend could set `pending_delete: true` for newsletter when recommended_action is pending_delete to enable 15s auto-move.
- **Draft without quick-send:** Draft is editable and Send exists; flow is good. Minor: could add "Copy to clipboard" for BEAP flow.
- **Deletion clarity:** Largely good; Pending Delete tab and countdown support trust.

---

## === PART 9: ARCHITECTURE READINESS ===

### 9.1 Current state shape and extensibility

- **Bulk:** `BulkAiResult` / `BulkAiResultEntry` — rich. Easy to add confidence, alternative actions, or more metadata.
- **Normal:** `NormalInboxAiResult` — sufficient for advisory. Could add `recommendedAction` enum if needed.
- **Extensibility:** Richer action cards, more actions, better prioritization — all feasible. `aiOutputs` is a flexible Record.

### 9.2 Architectural constraints

- **AI handlers:** Separate for Normal (`aiAnalyzeMessage`) vs Bulk (`aiCategorize`). No shared "unified" analysis — intentional and fine.
- **State:** Bulk `aiOutputs` is component state; lost on unmount. Could persist to support navigation back to Bulk without re-running Auto-Sort.
- **IPC:** Single batch call for categorize — good. No streaming or incremental results.

---

## === PART 10: VALUE SCORING & OPPORTUNITY RANKING ===

### Scores

| Area | Score | Justification |
|------|-------|---------------|
| **Bulk cleanup speed** | 8/10 | One batch call, 15s auto-move, structured cards. Newsletter manual Delete costs a point. |
| **Bulk cleanup confidence** | 8/10 | Clear categories, actions, countdown. Minor: no "Keep" during 15s. |
| **Normal inbox usefulness** | 8/10 | Auto-analysis, urgency, summary, editable draft. Action Items sometimes redundant. |
| **AI actionability** | 8/10 | Recommendations drive buttons; drafts editable. Good integration. |
| **Draft usability** | 9/10 | Editable inline in both modes; Send pre-fills compose. Strong. |
| **Visualization clarity** | 8/10 | Category borders, badges, action panel. Expand toggle clear. |
| **Pending delete clarity** | 9/10 | Countdown, Undo, tab separation. Transparent. |
| **Trust / reversibility** | 8/10 | Undo, advisory tone in Normal, clear 7-day flow. |
| **Scan speed** | 7/10 | Good hierarchy; summary/reason text can slow scan at scale. |
| **Overall value delivery** | 8/10 | Strong foundation; newsletter auto-move and minor UX tweaks would push to 9. |

### Top opportunities (analysis only, no implementation)

1. **Newsletter auto-move to Pending Delete**
   - **Affects:** Bulk Inbox — newsletter with `recommended_action: pending_delete`.
   - **Why:** Backend currently sets `pending_delete: true` only for spam/irrelevant. Extending to newsletter would enable 15s auto-move, increasing cleanup throughput.
   - **Improves:** Speed, retention reduction.

2. **"Keep" during 15s preview**
   - **Affects:** Bulk Inbox — spam/irrelevant during 15s before markPendingDelete.
   - **Why:** User cannot cancel the scheduled move. A "Keep" button would increase control and trust.
   - **Improves:** Trust, reversibility.

3. **Reduce Summarize/Draft button prominence after Auto-Sort**
   - **Affects:** Bulk action cards — when full structured result exists.
   - **Why:** Summarize and Draft are always shown; when Auto-Sort already provided summary/draft, they add clutter. Could collapse to "More actions" or hide when sufficient.
   - **Improves:** Scan speed, clarity, low cognitive load.

4. **Persist aiOutputs across Bulk view navigation**
   - **Affects:** Bulk Inbox — when user switches to Normal and back.
   - **Why:** `aiOutputs` is component state; leaving Bulk clears it. Persisting (e.g., in store or session) would avoid re-running Auto-Sort.
   - **Improves:** Speed, UX.

5. **Stronger primary action emphasis in action cards**
   - **Affects:** Bulk action cards — Send, Archive, Delete buttons.
   - **Why:** When recommended action is draft_reply_ready, Send could be larger or more prominent. Archive when recommended could be primary instead of secondary.
   - **Improves:** Actionability, scan speed.

---

*End of audit. No code changes made.*
