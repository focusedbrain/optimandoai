# WR Desk™ — Inbox AI System: Full Diagnostic Analysis

**Date:** 2025-03-18  
**Scope:** Normal Inbox + Bulk Inbox (Electron app)  
**Method:** Codebase analysis only — no changes applied.

---

## File Mapping (Actual vs Requested)

| Requested | Actual Location |
|-----------|-----------------|
| EmailInboxNormalView | `EmailInboxView.tsx` |
| EmailInboxBulkView | `EmailInboxBulkView.tsx` |
| BeapInbox.tsx | `BeapInboxDashboard.tsx` (BEAP-only) + `App.tsx` (routes Normal/Bulk) |
| useBulkClassification | `extension-chromium/.../useBulkClassification.ts` — **not used by WR Desk Electron** |
| useInboxAI | No dedicated hook — logic inline in `InboxDetailAiPanel` (EmailInboxView) |
| inboxTypes | `types/inboxAi.ts` |
| electron/main/email/ipc.ts | `electron/main/email/ipc.ts` |
| preload.ts | `electron/preload.ts` |
| InboxMessageCard | Inline in `EmailInboxBulkView` — `bulk-view-row` + `renderActionCard` |
| BeapMessageDetailPanel | Extension component — Normal Inbox uses `InboxDetailAiPanel` (inline in EmailInboxView) |

**Note:** WR Desk Electron uses `EmailInboxView` + `EmailInboxBulkView` with `useEmailInboxStore`. The extension uses `BeapBulkInbox` + `useBulkClassification` — a separate code path.

---

## 1. NORMAL INBOX — AI SPEED ISSUE

### Call Chain When User Selects a Message

```
[User selects message] 
  → selectMessage(id) in useEmailInboxStore
  → InboxDetailAiPanel mounts with messageId
  → useEffect([messageId, runAnalysis]) triggers runAnalysis()
  → window.emailInbox.aiAnalyzeMessage(messageId)
  → IPC inbox:aiAnalyzeMessage
  → callInboxOllamaChat(systemPrompt, userPrompt)
  → ollamaManager.chat(modelId, messages)
  → Response parsed → setAnalysis(result)
  → AI panel renders (Response Needed, Summary, Urgency, Action Items, Suggested action)
```

**Draft Reply** is separate: user clicks "Draft Reply" → `aiDraftReply` IPC → second LLM call.

### Findings

| Check | Result |
|-------|--------|
| **Trigger** | `useEffect` on `messageId` change — no debounce |
| **API calls** | **1 call** for analysis (`aiAnalyzeMessage`). Draft is **2nd call** on button click |
| **Streaming** | ❌ None. `callInboxOllamaChat` returns full string; no `stream: true`, no EventSource/ReadableStream |
| **Debouncing** | ❌ None on message selection |
| **6 sections** | 5 from `aiAnalyzeMessage` (needsReply, summary, urgency, actionItems, archiveRecommendation). Draft from `aiDraftReply` (manual) |
| **Lazy loading** | ❌ All-or-nothing; no progressive rendering |
| **Ollama path** | IPC → `ollamaManager.chat` (main process) |
| **Timeout** | ❌ No explicit timeout in `callInboxOllamaChat`; relies on Ollama default |

### Most Likely Cause of Slowness

1. **Single blocking call** — User waits for full JSON before any UI update.
2. **No streaming** — No incremental display; perceived latency = full LLM response time.
3. **Cold start** — Ollama model may load per-request if not kept warm.
4. **Payload size** — Body truncated to 8000 chars (`ipc.ts:1016`); reasonable.

### Quick Wins

1. **Stream the LLM response** — Show summary/urgency as tokens arrive.
2. **Combine analysis + draft** — One prompt returning both (if draft needed) to avoid 2 round-trips.
3. **Lazy load sections** — Return summary first, then urgency/actionItems in a second call.
4. **Preload on hover** — Start `aiAnalyzeMessage` when user hovers over a row.

---

## 2. BULK INBOX — BROKEN AUTO-SORT

### Flow When "AI Auto-Sort" Is Clicked

```
[User selects messages, clicks AI Auto-Sort]
  → handleAiAutoSort() — ids = multiSelectIds
  → runAiCategorizeForIds(ids, true)
  → window.emailInbox.aiCategorize(ids)
  → IPC inbox:aiCategorize
  → callInboxOllamaChat (batch prompt)
  → Parse JSON array → validate categories/actions
  → DB: UPDATE sort_category, sort_reason, urgency_score, needs_reply
  → Return { classifications: [...] }
  → setBulkAiOutputs((prev) => ({ ...prev, ...nextOutputs }))
  → addPendingDeletePreview(pendingIds) — 5s grace
  → addArchivePreview(archiveIds) — 5s grace
  → fetchMessages() — refresh from DB
  → setAiSortPhase('reordered') → 380ms → 'idle'
```

### Where the Chain Can Break

| Step | Status | Notes |
|------|--------|------|
| Classification hook called | ✅ | `runAiCategorizeForIds` is called; no `useBulkClassification` in Electron |
| Classification returns data | ⚠️ | Depends on Ollama; parse failure → empty `classifications` |
| State update applied | ✅ | `setBulkAiOutputs` correctly merges |
| Pending Delete move | ✅ | Bulk Auto-Sort calls `markPendingDelete` / IPC immediately when classifier recommends it (no 5s card preview). |
| Post-sort row animation | — | Removed (CSS `bulk-view-grid--reordered` / `bulk-view-row--reorder-enter` deleted; not applied in UI). |

### Auto-Run on Load

```javascript
// EmailInboxBulkView.tsx:419-430
useEffect(() => {
  if (loading || messages.length === 0 || !window.emailInbox?.aiCategorize) return
  if (aiSortPhase === 'analyzing') return
  const ids = messages.map((m) => m.id)
  const hasAnalysis = ids.some((id) => {
    const out = bulkAiOutputs[id]
    return !!(out?.category || out?.summary)
  })
  if (hasAnalysis) return
  runAiCategorizeForIds(ids, false)
}, [loading, messages, bulkAiOutputs, runAiCategorizeForIds, aiSortPhase])
```

**Bulk auto-runs analysis on load** when the batch has no analysis. The "broken" perception may be:

1. **Ollama unavailable** → `classifications` empty or `classification_failed: true`
2. **Timeout** → `callInboxOllamaChat` has no timeout; Ollama can hang
3. **JSON parse failure** → `parsed = []` → no outputs

### "Analysis failed: operation was aborted due to timeout"

This string likely comes from a **fetch/AbortController** wrapper, not from `callInboxOllamaChat` directly. The inbox IPC uses `ollamaManager.chat` with no timeout. If the error appears in the UI, it may be from a different code path (e.g. extension or HTTP bridge).

---

## 3. BULK INBOX — BADGE PLACEMENT BUG

### Where Badges Are Rendered

**Location 1 — Message card (LEFT panel) — WRONG**

```tsx
// EmailInboxBulkView.tsx:1283-1290
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, ... }}>
  ...
  {msg.sort_category && (
    <span style={{ fontSize: 10, padding: '3px 8px', ... }}>
      {msg.sort_category.toUpperCase()}
    </span>
  )}
  ...
</div>
```

This is inside `bulk-view-message-inner` → footer of the **message content area** (left). The badge appears alongside body text, attachments, and source badge.

**Location 2 — Action card (RIGHT panel) — CORRECT**

```tsx
// EmailInboxBulkView.tsx:689-694 (inside renderActionCard)
<div className="bulk-action-card-header">
  <span className="bulk-action-card-badge" style={{ background: `${borderColor}33`, color: borderColor }}>
    {(output.category ?? 'normal').toUpperCase()}
  </span>
  ...
</div>
```

This is in the **AI output card header** — the outer frame of the right panel.

### Fix Required

**Remove** the `sort_category` badge from the message content footer (lines 1283-1290). Keep it **only** in the action card header (right panel). The row already has `borderLeft` and `background` tint from `CATEGORY_BORDER`/`CATEGORY_BG` — that provides row-level visual distinction without duplicating the badge in the message body.

---

## 4. BULK INBOX — MISSING FEATURES AFTER REFACTOR

| Feature | Exists? | Working? | File/Function |
|---------|---------|----------|---------------|
| Per-message Draft button | ✅ | ✅ | `renderActionCard` — "✍ Draft" button |
| Per-message email composer (send drafted reply) | ✅ | ✅ | `handleSendDraft` → `EmailComposeOverlay` or `openBeapDraft` |
| Auto-move to Pending Delete after sort | ✅ | ✅ | Immediate IPC / store update from Auto-Sort when recommended (no 5s countdown on card). |
| 5-second visual countdown | — | — | Removed with immediate-move Auto-Sort. |
| 7-day grace period folder logic | ✅ | ✅ | `inbox:listMessages` filter `pending_delete`; main process interval queues `queueRemoteDeletion` after 7 days |
| Remote origin deletion (move to trash via API) | ✅ | ✅ | `executePendingDeletions` → `emailGateway.deleteMessage` |
| Sort animation / visual story-telling | — | — | Not used; reorder-enter keyframes removed from `App.css`. |
| Retry Auto-Sort per message | ✅ | ✅ | "Retry Auto-Sort" in failure card |
| Summarize per message in bulk | ✅ | ✅ | `handleSummarize` → `aiSummarize` |
| Urgency bar in bulk card | ✅ | ✅ | `bulk-action-card-urgency-bar` |
| Response Needed indicator | ✅ | ✅ | `bulk-action-card-response-needed` |

**Verdict:** All listed features exist and are wired. The main gaps are **UX** (no auto-analysis before user action in some flows) and **reliability** (Ollama timeout, parse failures).

---

## 5. NORMAL INBOX — PARITY CHECK WITH BULK

| Section | Normal Inbox | Bulk Inbox |
|---------|--------------|------------|
| Summary | ✅ | ✅ |
| Response Needed | ✅ | ✅ |
| Urgency bar | ✅ | ✅ |
| Draft Reply | ✅ (on demand) | ✅ (when `draft_reply` in classification or manual) |
| Action Items | ✅ | ✅ |
| Suggested action | ✅ (archive/keep) | ✅ (Recommended Action: pending_delete, archive, etc.) |

**Parity:** Bulk card shows the same sections when `hasStructured` is true (i.e. when `aiCategorize` returns full data).

---

## 6. IPC / BRIDGE INTEGRITY

### Handlers in `ipc.ts`

| Handler | Exists | Registered | Calls |
|---------|--------|------------|-------|
| inbox:aiSummarize | ✅ | ✅ | `callInboxOllamaChat` |
| inbox:aiDraftReply | ✅ | ✅ | `callInboxOllamaChat` |
| inbox:aiAnalyzeMessage | ✅ | ✅ | `callInboxOllamaChat` |
| inbox:aiCategorize | ✅ | ✅ | `callInboxOllamaChat` (batch) |
| inbox:markPendingDelete | ✅ | ✅ | DB UPDATE |
| inbox:archiveMessages | ✅ | ✅ | DB UPDATE |
| inbox:deleteMessages | ✅ | ✅ | DB + `queueRemoteDeletion` |
| inbox:cancelPendingDelete | ✅ | ✅ | DB UPDATE |

### Preload Bridge (`window.emailInbox`)

All handlers are exposed: `aiSummarize`, `aiDraftReply`, `aiAnalyzeMessage`, `aiCategorize`, `markPendingDelete`, `cancelPendingDelete`, etc.

### main.ts Registration

`registerEmailHandlers()` is called; inbox handlers are registered in the same flow.

---

## 7. ARCHITECTURE SUMMARY

### Current Data Flow — Normal Inbox

```
[User selects message]
  → selectMessage(id)
  → InboxDetailAiPanel mounts with messageId
  → useEffect → runAnalysis()
  → window.emailInbox.aiAnalyzeMessage(messageId)
  → IPC inbox:aiAnalyzeMessage
  → callInboxOllamaChat (single prompt, JSON response)
  → parseAiJson → NormalInboxAiResult
  → setAnalysis(result)
  → [Response Needed, Summary, Urgency, Draft Reply, Action Items, Suggested action] render
```

### Current Data Flow — Bulk Auto-Sort

```
[User clicks AI Auto-Sort] (or auto-run on load when no analysis)
  → runAiCategorizeForIds(ids, clearSelection)
  → window.emailInbox.aiCategorize(ids)
  → IPC inbox:aiCategorize
  → callInboxOllamaChat (batch prompt, JSON array)
  → Parse, validate, DB UPDATE sort_category/urgency/needs_reply
  → Return classifications
  → setBulkAiOutputs(prev => ({ ...prev, ...nextOutputs }))
  → addPendingDeletePreview(pendingIds) / addArchivePreview(archiveIds)
  → fetchMessages()
  → [5s later] processExpiredPendingDeletes → markPendingDelete(ids) → DB
  → [7 days later] Main process interval → queueRemoteDeletion → executePendingDeletions → emailGateway.deleteMessage
  → AI panel renders structured cards; sort animation plays
```

**Break points:** Ollama unavailable, JSON parse failure, wrong `id` format in LLM response, or timeout (if introduced elsewhere).

---

## 8. BACKGROUND PRELOAD / IDLE PROCESSING

### Preload Queue (Normal Inbox)

| Check | Result |
|-------|--------|
| **Background worker / queue** | ❌ None. No `useEffect` or worker pre-fetches analysis for visible-but-unselected messages. |
| **Analysis cache** | ❌ None. `InboxDetailAiPanel` uses local `useState` only. When user switches messages, `analysis` resets and `runAnalysis()` is called again. No `Map`, ref, zustand slice, or localStorage keyed by message ID. |
| **Cache check before LLM** | ❌ No. `runAnalysis()` always calls `aiAnalyzeMessage`; no cache hit path. |
| **Priority logic** | ❌ No. No "analyze top 5 visible first" or scroll-based prioritization. |

**Implication:** Every message selection triggers a fresh LLM call. Re-selecting a previously viewed message re-fetches. No instant render from cache.

### Idle Processing (Bulk Inbox)

| Check | Result |
|-------|--------|
| **Auto-run on load** | ✅ Yes. `useEffect` (lines 419–430) runs `runAiCategorizeForIds(ids, false)` when messages load and batch has no analysis. |
| **requestIdleCallback** | ❌ Not used in inbox components. |
| **setTimeout-based queue** | ❌ No. Bulk uses a single batch call; no per-message queue. |
| **Rate limiting** | ❌ No. `aiCategorize` sends all IDs in one IPC call; no client-side throttling. |
| **Visual indicator** | ✅ Yes. `aiSortProgress` shows "Analyzing X message(s)…" during analysis. |

**Bulk architecture:** One batch prompt for all messages. No per-message background queue. The extension's `useBulkClassification` uses per-message concurrency (default 4); WR Desk Electron does not use that path.

### Proposed Architecture vs Current

| Proposed | Current |
|----------|---------|
| Background queue with unanalyzed IDs | ❌ Normal: none. Bulk: auto-runs once on load (all ids in one call). |
| N messages concurrently (N=2–3) | ❌ Bulk sends all in one call. No per-message concurrency. |
| `analysisCache: Map<messageId, AnalysisResult>` | ❌ Normal: no cache. Bulk: `bulkAiOutputs` in store acts as cache for bulk only. |
| Cache hit → render instantly | ❌ Normal always fetches. Bulk reads from `bulkAiOutputs` (populated by `aiCategorize`). |
| Priority: selected → next 3 → visible → off-screen | ❌ None. |

### Checklist

| Item | Exists? | Location |
|------|---------|----------|
| `analysisCache` or similar | ❌ Normal. ✅ Bulk has `bulkAiOutputs` (store) but only for bulk view. | `useEmailInboxStore.ts` |
| Background worker / web worker | ❌ | — |
| `requestIdleCallback` in inbox | ❌ | — |
| Concurrency limiting on AI IPC | ❌ | `ipc.ts` — no semaphore or queue |
| Ollama concurrent requests | N/A | Ollama typically queues requests server-side; multiple concurrent calls may serialize. |

### What Would Need to Be Added

**Normal Inbox — Preload + Cache:**

1. **Cache:** Add `analysisCache: Record<string, NormalInboxAiResult>` to `useEmailInboxStore` (or a dedicated module).
2. **Cache check:** In `InboxDetailAiPanel`, before `runAnalysis()`, check `analysisCache[messageId]`. If hit, `setAnalysis(cached)` and skip LLM.
3. **Preload queue:** On message list load/update, enqueue unanalyzed message IDs. Process 2–3 at a time via `aiAnalyzeMessage`. Store results in cache.
4. **Priority:** Selected message = immediate (blocking). Next 3 below = high priority. Rest = low/idle.
5. **Hover preload:** Add `onMouseEnter` to `InboxMessageRow`; enqueue that message ID with high priority.

**Bulk Inbox — Already auto-runs:** No structural change needed. Optional: add `requestIdleCallback` to defer auto-run until browser idle, or add per-message progressive classification (like extension) instead of one batch.

---

## A. FINDINGS BY SECTION

### Section 1 — Normal Inbox Speed

- **Working:** Single `aiAnalyzeMessage` call returns all analysis fields; Draft is separate on-demand.
- **Broken/Missing:** No streaming, no debounce, no timeout on LLM call.
- **Files:** `EmailInboxView.tsx` (InboxDetailAiPanel), `ipc.ts` (callInboxOllamaChat).

### Section 2 — Bulk Auto-Sort

- **Working:** `runAiCategorizeForIds` → `aiClassifySingle` (per message) → DB classify write → immediate `markPendingDeleteImmediate` / `moveToPendingReviewImmediate` / `archiveMessages` when eligible → `refreshMessages`. No 5s preview step. DB 7-day pending-delete / remote deletion unchanged in main process.
- **Broken/Missing:** No timeout on `callInboxOllamaChat`; Ollama failures produce empty/invalid classifications.
- **Files:** `EmailInboxBulkView.tsx`, `ipc.ts` (`classifySingleMessage`), `useEmailInboxStore.ts`. (Legacy `pendingDeletePreviewScheduler.ts` — not present; bulk preview scheduler removed.)

### Section 3 — Badge Placement

- **Working:** Badge in action card header (right panel).
- **Broken:** Duplicate badge in message content footer (left panel) — should be removed.
- **Files:** `EmailInboxBulkView.tsx` lines 1283-1290.

### Section 4 — Missing Features

- **All features exist** in code; none are missing from the refactor.

### Section 5 — Parity

- **Bulk matches Normal** for all 6 sections when structured result exists.

### Section 6 — IPC

- **All handlers exist and are registered**; preload bridge is complete.

### Section 7 — Architecture

- **Flows documented above**; no structural breaks identified.

### Section 8 — Background Preload / Idle Processing

- **Working:** Bulk auto-runs `aiCategorize` on load when batch has no analysis; `aiSortProgress` shows during analysis; `bulkAiOutputs` acts as cache for bulk view.
- **Broken/Missing:** Normal Inbox has no analysis cache, no preload queue, no cache check before LLM, no hover preload, no `requestIdleCallback`, no concurrency limiting.
- **Files:** `EmailInboxView.tsx`, `EmailInboxBulkView.tsx`, `useEmailInboxStore.ts`.

---

## B. PRIORITY FIX LIST

| Priority | Issue | Impact | Effort | File(s) |
|----------|-------|--------|--------|---------|
| P0 | Add timeout to `callInboxOllamaChat` | Critical — prevents indefinite hangs | Low | `ipc.ts` |
| P0 | Remove duplicate badge from message content area | High — UX clarity | Low | `EmailInboxBulkView.tsx` |
| P1 | Stream LLM response for Normal Inbox | High — perceived speed | Medium | `ipc.ts`, `EmailInboxView.tsx` |
| P1 | Surface "operation aborted" / timeout in UI | High — user feedback | Low | `EmailInboxView.tsx`, `EmailInboxBulkView.tsx` |
| P2 | Combine aiAnalyzeMessage + aiDraftReply into one optional call | Medium — fewer round-trips | Medium | `ipc.ts`, `EmailInboxView.tsx` |
| P2 | Preload analysis on row hover | Medium — faster perceived load | Medium | `EmailInboxView.tsx` |
| P2 | Add analysis cache for Normal Inbox | Medium — instant render on re-select | Medium | `useEmailInboxStore.ts`, `EmailInboxView.tsx` |
| P2 | Background preload queue (top 3–5 visible) | Medium — proactive analysis | High | New module + `EmailInboxView.tsx` |
| P3 | Debounce message selection | Low | Low | `EmailInboxView.tsx` |
| P3 | `requestIdleCallback` for Bulk auto-run | Low — defer until idle | Low | `EmailInboxBulkView.tsx` |

---

## C. SPEED FIX RECOMMENDATION (Normal Inbox)

**Recommended approach:** **Stream the LLM response** (Option 1).

**Rationale:**

- Current architecture uses a single `aiAnalyzeMessage` call; streaming fits without changing the prompt shape.
- User sees progress immediately instead of a blank panel.
- `ollamaManager.chat` would need a streaming variant; many Ollama clients support `stream: true`.

**Implementation sketch:**

1. Add `inbox:aiAnalyzeMessageStream` IPC handler that returns an async generator or EventEmitter of chunks.
2. In `InboxDetailAiPanel`, consume the stream and update `analysis` as partial JSON or key-value pairs arrive.
3. Fall back to non-streaming if the model or client does not support it.

**Alternative 1:** **Preload on hover + cache** (Option 5) — Add `analysisCache` to store; on row hover, call `aiAnalyzeMessage` and store result. On click, check cache first → instant render if hit. Lower effort than streaming; high impact for repeat views.

**Alternative 2:** **Lazy load sections** (Option 4) — Call `aiSummarize` first (smaller prompt), show summary immediately, then call a second endpoint for urgency/actionItems. Lower effort but more round-trips.

---

## D. BULK SORT FIX PLAN

| Step | File | Function | Change |
|------|------|----------|--------|
| 1. Fix classification call | `ipc.ts` | `callInboxOllamaChat` | Add timeout (e.g. 60s) via `AbortController` or wrapper |
| 2. Fix state update | `EmailInboxBulkView.tsx` | `runAiCategorizeForIds` | Already correct; ensure `classification_failed` entries still set `bulkAiOutputs` with error message |
| 3. Re-wire Pending Delete | — | — | Bulk uses immediate moves; DB 7-day grace / `executePendingDeletions` unchanged in main process. |
| 4. Re-wire Archive | — | — | Already wired |
| 5. Re-wire Draft for action-required | — | — | Already in classification response; ensure `draft_reply` passed when `needs_reply` |
| 6. Restore badge placement | `EmailInboxBulkView.tsx` | Message card footer | Remove `sort_category` badge from lines 1283-1290 |
| 7. Sort animation | — | — | Intentionally not restored; classes removed from bulk view. |

---

## E. VERDICT

### 🟢 WORKING

- Normal Inbox: selection, AI panel, all 6 sections, Draft on demand, Archive/Delete.
- Bulk Inbox: AI Auto-Sort, batch classification, DB write, immediate recommended moves, Pending Delete, 7-day grace, remote deletion, per-message Summarize/Draft/Retry.
- IPC bridge: all handlers registered and exposed.
- ~~Scheduler: `startPendingDeletePreviewScheduler`~~ removed; no bulk 5s preview tick.

### 🟡 FIXABLE

- **Timeout:** Add to `callInboxOllamaChat` to prevent hangs.
- **Badge placement:** Remove duplicate from message content; keep only in action card header.
- **Error surfacing:** Show "Analysis failed" / timeout message clearly in UI when classification fails.
- **Speed:** Add streaming or lazy loading for Normal Inbox.
- **Preload/cache:** Add analysis cache + hover preload + background queue for Normal Inbox (code does not exist; needs to be built).

### 🔴 MISSING

- **None** — No features were lost in the refactor. The "broken" perception is primarily from:
  1. Ollama being unavailable or slow.
  2. No auto-analysis before user action in some flows (though Bulk does auto-run on load when batch has no analysis).
  3. Duplicate badge in the wrong place.
