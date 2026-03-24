# WR Desk™ — AutoSort Session Review: Pre-Flight Analysis for Refinement

> **Purpose:** Map the current state of the implementation after the first round of prompts. This document embeds source excerpts, answers the template questions, and ties them to the **Known Issues** list for a targeted refinement sequence.
>
> **Generated from codebase snapshot:** `apps/electron-vite-project` (paths relative to `code/`).

---

## Known Issues to Fix (cross-reference)

| # | Issue | What this report shows |
|---|--------|-------------------------|
| 1 | Message count mismatch | `finalize` uses `getSessionMessages(sessionId).length` as `total`, not `targetIds.length`. Stamps only apply after a **successful** classify path. LLM headline is instructed to include counts but can disagree. See **Part 3** and **Part 5**. |
| 2 | Charts too large / layout | Two `ResponsiveContainer` charts at **height 200** each in a **2-column grid** (`1fr 1fr`). See **Part 2**. |
| 3 | Panel size / fullscreen | `.session-review-panel` is **max-width 780px**, centered flex overlay — not full dashboard. See **Part 2** and **Part 7**. |
| 4 | Labels REVIEW / DELETE | UI uses short labels **"Review"** and **"Delete"** on stat chips and history badges. See **Part 1–2**. |
| 5 | Non-urgent messages not listed | Review UI has **no** scrollable list of all session messages — only Recharts from `messages` + **AI highlight lists** from `ai_summary_json`. See **Part 1**. |
| 6 | Attachment rules | Default WRExpert content has **no** attachment-specific rules. See **Part 6**. |
| 7 | No infinite scroll | Panel scroll is **CSS overflow-y** on `.session-review-panel`; no virtualization. See **Part 1–2**. |

---

## PART 1: Current Session Review Component

### 1.1 Complete file: `src/components/AutoSortSessionReview.tsx`

See repository file (382 lines). Structure summary:

1. **Loading:** `session-review-overlay` → `session-review-panel` → "Loading session…"
2. **Error:** no `session.id` → error panel + Close
3. **Main:** overlay → panel →
   - `session-review-header` (title, `metaLine`, close)
   - optional parse warning (`summaryJsonInvalid`)
   - optional `aiSummary.headline`
   - `session-review-stats` (stat chips: Urgent, Review, Delete, Archived, optional Errors)
   - `session-review-charts` (donut + bar, each `ResponsiveContainer` **height={200}**)
   - optional **Urgent Highlights** section (from `aiSummary.urgent_highlights` only)
   - optional **Review Highlights** section (from `aiSummary.review_highlights` only)
   - optional `patterns_note`

**Data loading:** `Promise.all([api.getSession(sessionId), api.getSessionMessages(sessionId)])`.

**Derived data:**

- Category donut: aggregated from **`messages`** array (local DB rows returned by `getSessionMessages`).
- Urgency bar: bucketed from `messages[].urgency_score`.
- **`stats`:** If `session.total_messages` is set (number), chip counts use **`urgent_count`, `pending_review_count`, etc.** from the session row. Otherwise falls back to recomputing from **`messages`** with filters (urgent category or urgency ≥ 7, `pending_review` or `pending_review_at`, `pending_delete`, `archived`).

**Highlights:** Only JSON fields `urgent_highlights` and `review_highlights` from `session.ai_summary_json` — not a filtered dump of all `messages`.

**Scrolling:** `overflow-y: auto` is on **`.session-review-panel`** (see Part 2). No `react-window` / virtual list.

### 1.2 Complete file: `src/components/AutoSortSessionHistory.tsx`

See repository file (133 lines). Structure:

- Overlay → `session-history-panel` → header ("AutoSort History", close)
- Loading / empty / list of `session-history-row` with date, duration, badges (`sh-badge`: total messages, urgent, review), delete button

### Questions — Part 1

1. **Exact component structure (order):** See §1.1 — header → headline → stat chips → charts → urgent highlights → review highlights → patterns note. **No full message list.**

2. **Charts layout:** CSS **grid** on `.session-review-charts`: `grid-template-columns: 1fr 1fr`, `gap: 14px`. Each chart wrapped in `.session-chart-card`. `@media (max-width: 640px)` → single column.

3. **Data from `getSession` / `getSessionMessages`:**  
   - `getSession`: full `autosort_sessions` row (`SELECT *`).  
   - `getSessionMessages`: `id, from_address, from_name, subject, sort_category, urgency_score, needs_reply, sort_reason, pending_delete, pending_review_at, archived` for `last_autosort_session_id = ?`.

4. **Highlights:** Rendered only if `ai_summary_json` parses and arrays are non-empty. **Not** derived by filtering `messages` in the component for a general list.

5. **Scrolling:** Panel `overflow-y: auto`; **no** infinite scroll / virtualization.

---

## PART 2: Current CSS for Session Review (`src/App.css`)

### 2.1 Embedded block (session review + history + related autosort progress)

The following ranges cover the template prefixes:

- **`.session-review-*`** — approx. lines **4908–5246**
- **`.autosort-*`** (progress / review button) — approx. **2517–2584** (and toolbar usage elsewhere)
- **`.stat-chip*`** — **5060–5114**
- **`.highlight-*`, `.section-heading`** — **5153–5237**
- **`.session-chart-*`** — **5116–5151**
- **`.session-history-*`, `.sh-badge`** — **5248–5441**

### Questions — Part 2

1. **`.session-review-panel` max-width:** **`780px`** (also `width: 92%`, `max-height: 88vh`).

2. **`.session-review-charts` grid:** `grid-template-columns: **1fr 1fr**`; below **640px** → `1fr` only.

3. **ResponsiveContainer height:** **`200`** pixels for **both** Pie and Bar charts (`height={200}` in TSX).

4. **Media queries:** One breakpoint: **`@media (max-width: 640px)`** on `.session-review-charts` to stack charts.

---

## PART 3: Session Stats Computation (`EmailInboxBulkView.tsx`)

### 3.1 `handleAiAutoSort` (full)

Relevant block: **`handleAiAutoSort`** starts ~line **2954**; core flow:

1. `sessionApi.create()` → `sessionId`
2. Build **`targetIds`:** full-tab drain via `fetchMatchingIdsForCurrentFilter()` or selected IDs
3. If empty → `finalize` with zeros and return
4. `runAiCategorizeForIds(targetIds, true, false, { manageConcurrencyLock: false }, sessionId ?? undefined)`
5. If session APIs exist:  
   - `sessionMessages = await getSessionMessages(sessionId)`  
   - **`stats.total = sessionMessages.length`** (not `targetIds.length`)  
   - `errors: Math.max(0, targetIds.length - sessionMessages.length)`  
   - `finalize(sessionId, stats)` then `generateSummary(sessionId)`

### 3.2 `runAiCategorizeForIds` (signature and session threading)

- **Signature:**  
  `(ids, clearSelection, isRetry?, opts?, sessionId?: string) => Promise<BulkSortRunAggregate>`
- **IPC:** `window.emailInbox.aiClassifySingle(messageId, sessionId)` for each message in concurrent batches (CONCURRENCY = 5).
- **Retry pass:** `runAiCategorizeForIds(toRetry, false, true, { ... }, sessionId)` — **`sessionId` is passed through.**

Full function spans approximately **lines 2402–2818** in `EmailInboxBulkView.tsx`.

### Questions — Part 3

1. **`stats.total`:** Computed as **`sessionMessages.length`** after the batch, where `sessionMessages = getSessionMessages(sessionId)`. **Not** `targetIds.length`. Any message that never got `last_autosort_session_id` (failed classify, early IPC error) is **excluded** from this count but reflected in **`errors`** (`targetIds.length - sessionMessages.length`).

2. **`sessionId` on every `aiClassifySingle`:** **Yes** for the main Auto-Sort path — the fifth argument to `runAiCategorizeForIds` is passed into each `aiClassifySingle(messageId, sessionId)`.

3. **`getSessionMessages` after batch:** Returns **all rows** with `last_autosort_session_id = sessionId` (subject to DB state). **Not** “subset by design” — but **only stamped rows** appear.

4. **Signature:** `sessionId` is the **last** (optional) parameter of `runAiCategorizeForIds`.

5. **Preload:** `aiClassifySingle: (messageId, sessionId?) => ipcRenderer.invoke('inbox:aiClassifySingle', messageId, sessionId)` — **second argument forwarded correctly.**

---

## PART 4: IPC — `classifySingleMessage` (`electron/main/email/ipc.ts`)

### 4.1 Stamp semantics

`last_autosort_session_id` is updated **only** here:

```text
if (sessionId) {
  db.prepare('UPDATE inbox_messages SET last_autosort_session_id = ? WHERE id = ?').run(sessionId, messageId)
}
```

This runs **after** the main `UPDATE inbox_messages SET ... sort_category / pending / archived ...` and **after** `ai_analysis_json` write — still inside the **successful** try path (LLM returned parseable JSON).

**Early returns without stamp:** `Database unavailable`, `not_found`, `llm_unavailable`, `parse_failed`, any **catch** (timeout / LLM error) returning `{ messageId, error: ... }`.

**Therefore:** Failed classifies **do not** get a session stamp → `getSessionMessages` count can be **much lower** than `targetIds.length` → `stats.total` small, **`errors`** positive, while the **LLM summary** still receives only **stamped** rows — headline could still be inconsistent if the model hallucinates totals, but a common “3 vs 27” pattern is explained by **24 failures / unstamped** plus headline wording.

### 4.2 `inbox:aiClassifySingle` handler

```ts
ipcMain.handle('inbox:aiClassifySingle', async (_e, messageId: string, sessionId?: string) => {
  const out = await classifySingleMessage(messageId, sessionId)
  // scheduleOrchestratorRemoteDrain...
  return out
})
```

### Questions — Part 4

1. **Where stamped:** After successful classification DB updates + `ai_analysis_json`, **before** return; **not** in a separate SQL transaction wrapping classify + stamp (individual `prepare().run()` calls).

2. **Conditional on success:** **Yes** — error paths return before the stamp block.

3. **Silent stamp failure:** If `sessionId` is passed and UPDATE runs, failure would surface as DB error in try/catch → **`llm_error` return**, still no stamp. Wrong column name would throw at migration mismatch — **v48** migration should be present. **Stamp does not run** on classify errors.

4. **`sessionId` undefined:** Possible if renderer omits it — **per-row** `aiClassifySingle` without session is **undefined**; then the `if (sessionId)` block is skipped. Auto-Sort path passes it when `create()` succeeded.

---

## PART 5: AI Summary — `autosort:generateSummary` (`electron/main/email/ipc.ts`)

### 5.1 Handler summary (~lines 1289–1377)

- Loads **`messages`** with the **same session filter** as review list (subset of columns):  
  `WHERE last_autosort_session_id = ? ORDER BY urgency_score DESC`
- Builds numbered lines for the prompt: **`AutoSort batch — ${messages.length} messages:`**
- LLM must return JSON with `headline`, `urgent_highlights`, `review_highlights`, `patterns_note`
- **`parseAiJson`** parses model output; on failure logs and returns `null`
- Post-process: copies **`message_id`** onto highlights by **`idx`** (1-based index into the **`messages`** array)
- Persists **`ai_summary_json`** on `autosort_sessions`

### Questions — Part 5

1. **Summary query vs batch:** Uses **stamped** messages only — **same cardinality** as `getSessionMessages` **if** both queries match the same filter (they both use `last_autosort_session_id`; column lists differ slightly but row count should match).

2. **`parseAiJson`:** On parse failure, handler throws → caught → **`null`**, **`console.error('[AutoSort] Summary generation failed:', err)`**.

3. **Sample `ai_summary_json`:** Not queried from SQLite in this document; inspect with:  
   `SELECT ai_summary_json FROM autosort_sessions ORDER BY started_at DESC LIMIT 1`

---

## PART 6: WR Expert Default Rules

### 6.1 Files

- **On disk:** `electron/WRExpert.default.md` — shipped default copy (89 lines in current tree).
- **Inline fallback:** `DEFAULT_WREXPERT_CONTENT` in `electron/main/email/ipc.ts` (lines **18–106**) mirrors the same structure.
- **Runtime:** `getInboxAiRules()` reads `userData/WRExpert.md`, seeding from file or inline default; **`getInboxAiRulesForPrompt()`** strips `#` comment lines and feeds **`classifySingleMessage`** system prompt.

### Questions — Part 6

1. **Attachments:** **No** explicit attachment rules in `WRExpert.default.md`.
2. **Categories:** `pending_delete`, `pending_review`, `archive`, `urgent`, `action_required`, `normal` (plus coherence / draft rules).
3. **`pending_review` vs `urgent`:** Documented under separate headings; urgency bands 1–10 described; `action_required` maps to Important / Pending Review sync behavior in comments inside **`classifySingleMessage`** (maps to `pending_review` path locally).
4. **Loading:** **`getInboxAiRulesForPrompt()`** in `ipc.ts` (not the renderer).

---

## PART 7: Dashboard Layout Context

### Questions — Part 7

1. **Default window:** `electron/main.ts` creates `BrowserWindow` with **`width: 1200`**, **`height: 800`** (approx. lines 837–849).

2. **Main content width with sidebar:** No single constant in this audit — layout is flex/grid in React/CSS; **session review does not read window dimensions**.

3. **Full-panel pattern:** Session review uses a **fixed overlay** (`.session-review-overlay` **fixed inset 0**, flex **center**), not a route-level “full dashboard” pane.

4. **Z-index:** Examples in `App.css`: **1000** (session review overlay, several modals), **1100** for one layer (e.g. line ~4777). Session review overlay uses **`z-index: 1000`**.

---

## PART 8: File Naming Verification

### Questions — Part 8

1. **Session review component file:** **`AutoSortSessionReview.tsx`** — path: `src/components/AutoSortSessionReview.tsx`

2. **Session history component file:** **`AutoSortSessionHistory.tsx`**

3. **Imports in `EmailInboxBulkView.tsx`:**  
   `import { AutoSortSessionReview } from './AutoSortSessionReview'`  
   `import { AutoSortSessionHistory } from './AutoSortSessionHistory'`  
   — **matches** filenames.

4. **Other files from first implementation round (non-exhaustive):**  
   - `electron/main/handshake/db.ts` — `autosort_sessions` migration + `last_autosort_session_id` on `inbox_messages`  
   - `electron/main/email/ipc.ts` — autosort + classify + summary handlers  
   - `electron/preload.ts` — `window.autosortSession`, `aiClassifySingle` second arg (`sessionId`)  
   - `src/components/handshakeViewTypes.ts` — typings for preload  
   - `src/App.css` — session review / history / autosort progress styles  
   - `THIRD_PARTY_LICENSES/recharts-MIT.txt` (if present)

---

## Summary: What These Answers Enable

| Refinement goal | Primary lever |
|-----------------|---------------|
| **Message count bug** | Align displayed totals: use `targetIds.length` vs stamped count consistently; ensure headline uses DB or prompt count; optionally stamp or record failed IDs per session. |
| **Panel layout** | Replace centered `max-width: 780px` with dashboard-filling layout; shrink charts (side column). |
| **Labels** | Replace "Review"/"Delete" chip text with **"Pending Review"** / **"Pending Delete"**. |
| **All messages visible** | New UI section listing `getSessionMessages` (or virtualized), collapsible “Other”. |
| **Attachment rules** | Extend `WRExpert.default.md` + reconciliation in `classifySingleMessage` if attachment metadata exists in DB. |
| **Infinite scroll** | Virtualize message list; keep overlay scroll for outer shell only. |
| **Fullscreen** | Toggle class on overlay/panel + optional `z-index` / dimensions to match main window content area. |

---

## Appendix A — Type references (`handshakeViewTypes`)

`window.autosortSession` exposes: `create`, `finalize`, `generateSummary`, `getSession`, `listSessions`, `deleteSession`, `getSessionMessages` — align with `preload.ts` for refinement typings.

---

## Appendix B — Full source: `apps/electron-vite-project/src/components/AutoSortSessionReview.tsx`

```tsx
/**
 * Full-screen AutoSort session review with category/urgency charts and AI highlights.
 */

import { useEffect, useState, useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import './handshakeViewTypes'

const CATEGORY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  important: '#ea580c',
  pending_review: '#d97706',
  normal: '#3b82f6',
  newsletter: '#8b5cf6',
  spam: '#94a3b8',
  irrelevant: '#94a3b8',
}

const URGENCY_BUCKET_META: { name: string; fill: string; min: number; max: number }[] = [
  { name: 'Low', fill: '#94a3b8', min: 1, max: 3 },
  { name: 'Medium', fill: '#3b82f6', min: 4, max: 6 },
  { name: 'High', fill: '#d97706', min: 7, max: 8 },
  { name: 'Critical', fill: '#dc2626', min: 9, max: 10 },
]

function formatCategoryLabel(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function bucketUrgency(score: number | null | undefined): number {
  const u = typeof score === 'number' && !Number.isNaN(score) ? Math.round(score) : 5
  if (u <= 3) return 0
  if (u <= 6) return 1
  if (u <= 8) return 2
  return 3
}

type SessionRow = {
  id?: string
  started_at?: string
  completed_at?: string
  total_messages?: number
  urgent_count?: number
  pending_review_count?: number
  pending_delete_count?: number
  archived_count?: number
  error_count?: number
  duration_ms?: number | null
  ai_summary_json?: string | null
  status?: string
}

type MessageRow = {
  id: string
  sort_category?: string | null
  urgency_score?: number | null
  from_name?: string | null
  from_address?: string | null
  subject?: string | null
  pending_delete?: number | null
  pending_review_at?: string | null
  archived?: number | null
}

type AiSummaryParsed = {
  headline?: string
  urgent_highlights?: Array<{
    idx?: number
    from?: string
    subject?: string
    reason?: string
    action?: string
    message_id?: string
  }>
  review_highlights?: Array<{
    idx?: number
    from?: string
    subject?: string
    reason?: string
    action?: string
    message_id?: string
  }>
  patterns_note?: string
}

export interface AutoSortSessionReviewProps {
  sessionId: string
  onClose: () => void
  onNavigateToMessage: (messageId: string) => void
}

export function AutoSortSessionReview({
  sessionId,
  onClose,
  onNavigateToMessage,
}: AutoSortSessionReviewProps) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const api = window.autosortSession
        if (!api?.getSession || !api?.getSessionMessages) {
          if (!cancelled) setSession(null)
          return
        }
        const [s, msgs] = await Promise.all([api.getSession(sessionId), api.getSessionMessages(sessionId)])
        if (cancelled) return
        setSession((s as SessionRow) ?? null)
        setMessages(Array.isArray(msgs) ? (msgs as MessageRow[]) : [])
      } catch {
        if (!cancelled) setSession(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const aiSummary = useMemo((): AiSummaryParsed | null => {
    const raw = session?.ai_summary_json
    if (!raw || typeof raw !== 'string') return null
    try {
      return JSON.parse(raw) as AiSummaryParsed
    } catch {
      return null
    }
  }, [session?.ai_summary_json])

  const summaryJsonInvalid = Boolean(session?.ai_summary_json && !aiSummary)

  const categoryData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of messages) {
      const cat = (m.sort_category || 'unknown').trim() || 'unknown'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return Array.from(counts.entries()).map(([name, value]) => ({
      name: formatCategoryLabel(name),
      value,
      color: CATEGORY_COLORS[name] ?? '#64748b',
    }))
  }, [messages])

  const urgencyBarData = useMemo(() => {
    const buckets = [0, 0, 0, 0]
    for (const m of messages) {
      const idx = bucketUrgency(m.urgency_score ?? null)
      buckets[idx] += 1
    }
    return URGENCY_BUCKET_META.map((b, i) => ({
      name: b.name,
      count: buckets[i],
      fill: b.fill,
    }))
  }, [messages])

  const stats = useMemo(() => {
    const s = session
    if (s && typeof s.total_messages === 'number') {
      return {
        urgent: s.urgent_count ?? 0,
        review: s.pending_review_count ?? 0,
        delete: s.pending_delete_count ?? 0,
        archived: s.archived_count ?? 0,
        errors: s.error_count ?? 0,
      }
    }
    return {
      urgent: messages.filter(
        (m) => m.sort_category === 'urgent' || (m.urgency_score != null && m.urgency_score >= 7)
      ).length,
      review: messages.filter((m) => m.sort_category === 'pending_review' || !!m.pending_review_at).length,
      delete: messages.filter((m) => !!m.pending_delete).length,
      archived: messages.filter((m) => !!m.archived).length,
      errors: 0,
    }
  }, [session, messages])

  const metaLine = useMemo(() => {
    if (!session) return ''
    const started = session.started_at ? new Date(session.started_at).toLocaleString() : '—'
    const total = session.total_messages ?? messages.length
    const dur =
      typeof session.duration_ms === 'number' ? `${Math.round(session.duration_ms / 1000)}s` : '—'
    return `${started} · ${total} messages · ${dur}`
  }, [session, messages.length])

  if (loading) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div className="session-review-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <p className="session-review-loading">Loading session…</p>
        </div>
      </div>
    )
  }

  if (!session?.id) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div className="session-review-panel session-review-panel--error" onClick={(e) => e.stopPropagation()}>
          <p>Session not found</p>
          <button type="button" className="session-review-close-inline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const urgentHighlights = aiSummary?.urgent_highlights?.length ? aiSummary.urgent_highlights : []
  const reviewHighlights = aiSummary?.review_highlights?.length ? aiSummary.review_highlights : []

  return (
    <div className="session-review-overlay" onClick={onClose} role="presentation">
      <div className="session-review-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="session-review-header">
          <div>
            <h2 className="session-review-title">AutoSort Session Review</h2>
            <p className="session-review-meta">{metaLine}</p>
          </div>
          <button type="button" className="session-review-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {summaryJsonInvalid && (
          <p className="session-review-parse-warn">Could not parse saved AI summary JSON.</p>
        )}

        {aiSummary?.headline ? (
          <div className="session-review-headline">{aiSummary.headline}</div>
        ) : null}

        <div className="session-review-stats">
          <div className="stat-chip stat-chip--urgent">
            <span className="stat-chip-value">{stats.urgent}</span>
            <span className="stat-chip-label">Urgent</span>
          </div>
          <div className="stat-chip stat-chip--review">
            <span className="stat-chip-value">{stats.review}</span>
            <span className="stat-chip-label">Review</span>
          </div>
          <div className="stat-chip stat-chip--delete">
            <span className="stat-chip-value">{stats.delete}</span>
            <span className="stat-chip-label">Delete</span>
          </div>
          <div className="stat-chip stat-chip--archived">
            <span className="stat-chip-value">{stats.archived}</span>
            <span className="stat-chip-label">Archived</span>
          </div>
          {stats.errors > 0 ? (
            <div className="stat-chip stat-chip--errors">
              <span className="stat-chip-value">{stats.errors}</span>
              <span className="stat-chip-label">Errors</span>
            </div>
          ) : null}
        </div>

        <div className="session-review-charts">
          <div className="session-chart-card">
            <h3 className="session-chart-title">Category Breakdown</h3>
            {categoryData.length === 0 ? (
              <p className="session-chart-empty">No category data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="session-chart-card">
            <h3 className="session-chart-title">Urgency Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={urgencyBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {urgencyBarData.map((entry, index) => (
                    <Cell key={`urg-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {urgentHighlights.length > 0 ? (
          <section className="session-review-section session-review-section--urgent">
            <h3 className="section-heading">Urgent Highlights</h3>
            <ul className="highlight-list">
              {urgentHighlights.map((h, i) => (
                <li key={`u-${i}`} className="highlight-card highlight-card--urgent">
                  <div className="highlight-card-head">
                    <strong>{h.from || 'Unknown'}</strong>
                    <span className="highlight-subj">{h.subject || '(No subject)'}</span>
                  </div>
                  {h.reason ? <p className="highlight-reason">{h.reason}</p> : null}
                  {h.action ? <p className="highlight-action">{h.action}</p> : null}
                  {h.message_id ? (
                    <button
                      type="button"
                      className="highlight-link"
                      onClick={() => onNavigateToMessage(h.message_id!)}
                    >
                      Open message
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {reviewHighlights.length > 0 ? (
          <section className="session-review-section session-review-section--review">
            <h3 className="section-heading">Review Highlights</h3>
            <ul className="highlight-list">
              {reviewHighlights.map((h, i) => (
                <li key={`r-${i}`} className="highlight-card highlight-card--review">
                  <div className="highlight-card-head">
                    <strong>{h.from || 'Unknown'}</strong>
                    <span className="highlight-subj">{h.subject || '(No subject)'}</span>
                  </div>
                  {h.reason ? <p className="highlight-reason">{h.reason}</p> : null}
                  {h.action ? <p className="highlight-action">{h.action}</p> : null}
                  {h.message_id ? (
                    <button
                      type="button"
                      className="highlight-link"
                      onClick={() => onNavigateToMessage(h.message_id!)}
                    >
                      Open message
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {aiSummary?.patterns_note ? (
          <p className="session-review-note">{aiSummary.patterns_note}</p>
        ) : null}
      </div>
    </div>
  )
}
```

---

## Appendix C — Full source: `apps/electron-vite-project/src/components/AutoSortSessionHistory.tsx`

```tsx
/**
 * List of past AutoSort sessions — open review or delete.
 */

import { useEffect, useState, useCallback } from 'react'
import './handshakeViewTypes'

type SessionRow = {
  id: string
  started_at?: string | null
  completed_at?: string | null
  total_messages?: number | null
  urgent_count?: number | null
  pending_review_count?: number | null
  duration_ms?: number | null
  status?: string | null
}

export interface AutoSortSessionHistoryProps {
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}

export function AutoSortSessionHistory({ onClose, onOpenSession }: AutoSortSessionHistoryProps) {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const api = window.autosortSession
      if (!api?.listSessions) {
        setSessions([])
        return
      }
      const rows = await api.listSessions(100)
      setSessions(Array.isArray(rows) ? (rows as SessionRow[]) : [])
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await window.autosortSession?.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.error('[AutoSort] deleteSession failed:', err)
    }
  }

  return (
    <div className="session-review-overlay" onClick={onClose} role="presentation">
      <div className="session-history-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="session-history-header">
          <h2 className="session-history-title">AutoSort History</h2>
          <button type="button" className="session-review-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {loading ? (
          <p className="session-history-loading">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="session-history-empty">
            No AutoSort sessions recorded yet. Run AI Auto-Sort to create your first session.
          </p>
        ) : (
          <div className="session-history-list">
            {sessions.map((row) => {
              const started = row.started_at ? new Date(row.started_at) : null
              const dateStr = started
                ? `${started.toLocaleDateString()} ${started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                : '—'
              const durSec =
                typeof row.duration_ms === 'number' && row.duration_ms >= 0
                  ? Math.round(row.duration_ms / 1000)
                  : null
              const total = row.total_messages ?? 0
              const urgent = row.urgent_count ?? 0
              const review = row.pending_review_count ?? 0

              return (
                <div
                  key={row.id}
                  className="session-history-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenSession(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenSession(row.id)
                    }
                  }}
                >
                  <div className="session-history-info">
                    <div className="session-history-top-line">
                      <span className="session-history-date">{dateStr}</span>
                      {durSec != null ? <span className="session-history-duration">{durSec}s</span> : null}
                    </div>
                    <div className="session-history-badges">
                      <span className="sh-badge sh-badge-total">{total} messages</span>
                      {urgent > 0 ? <span className="sh-badge sh-badge-urgent">{urgent} urgent</span> : null}
                      {review > 0 ? <span className="sh-badge sh-badge-review">{review} review</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="session-history-delete"
                    title="Delete session"
                    aria-label="Delete session"
                    onClick={(e) => void handleDelete(e, row.id)}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## Appendix D — CSS excerpt locations (`src/App.css`)

| Class prefix | Approx. line range |
|--------------|---------------------|
| `.session-review-*`, `.session-chart-*`, `.highlight-*`, `.section-heading`, `.stat-chip*` | 4908–5237 |
| `.session-history-*`, `.sh-badge*` | 5248–5441 |
| `.autosort-progress-*`, `.autosort-review-btn` | 2517–2584 |

---

*End of pre-flight analysis.*
