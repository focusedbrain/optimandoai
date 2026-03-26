# WR Desk™ — AutoSort Session Diagnostic: What Actually Happened?

**Purpose:** Trace the exact data flow of an AutoSort session step by step, with raw data at every layer, to locate inconsistencies (e.g. “4 messages” vs “27 emails sorted”, “0 urgent” chips vs one urgent card, archived despite attachments).

**Codebase root (this analysis):** `apps/electron-vite-project/`

**Important:** Steps 1–2 require querying the **live** vault database on your machine. This report records **schema and code-derived truth** from the repo. **Live SQL output was not captured here** because inbox data lives in **SQLCipher-encrypted** vault DB files; paste your own query results into the placeholders below when you run them with the app’s tooling or an unlocked SQLCipher client.

---

## STEP 1: Raw Database — The Session Row

### 1.0 Where is the database?

| Fact | Detail |
|------|--------|
| **Not** `%APPDATA%/wr-desk/` for this app | Electron `userData` is overridden in `electron/main.ts` to **`%USERPROFILE%\.opengiraffe\electron-data`** (see `app.setPath('userData', customUserDataPath)`). |
| **Inbox / handshake tables** | Documented in `electron/main/handshake/db.ts` as living in the **existing vault SQLCipher database** — not a separate plain `.sqlite` file. |
| **Observed files on a dev machine** (example) | `handshake-ledger.db`, `orchestrator.db`, `vault_vault_<id>_<suffix>.db` under `.opengiraffe/electron-data/`. |
| **WRExpert rules file** | `path.join(app.getPath('userData'), 'WRExpert.md')` → e.g. `%USERPROFILE%\.opengiraffe\electron-data\WRExpert.md` |

Plain `sqlite3` against `vault_vault_*.db` will typically **fail or return nothing** without the SQLCipher key and PRAGMA setup the app uses.

### 1.1 Queries to run (paste FULL output below)

```sql
-- 1a. The most recent session — what did the DB actually record?
SELECT * FROM autosort_sessions ORDER BY started_at DESC LIMIT 3;

-- 1b. How many messages are stamped for the latest session?
SELECT COUNT(*) as stamped_count,
       last_autosort_session_id
FROM inbox_messages
WHERE last_autosort_session_id IS NOT NULL
GROUP BY last_autosort_session_id
ORDER BY last_autosort_session_id DESC
LIMIT 5;

-- 1c. The actual messages in the latest session — what are their real classifications?
SELECT
  m.id,
  m.from_name,
  m.from_address,
  m.subject,
  m.sort_category,
  m.urgency_score,
  m.needs_reply,
  m.pending_delete,
  m.pending_review_at,
  m.archived,
  m.sort_reason,
  m.last_autosort_session_id,
  LENGTH(m.ai_analysis_json) as analysis_json_length
FROM inbox_messages m
WHERE m.last_autosort_session_id = (
  SELECT id FROM autosort_sessions ORDER BY started_at DESC LIMIT 1
)
ORDER BY m.urgency_score DESC;

-- 1d. Column list (attachment-related: has_attachments, attachment_count per migrations)
PRAGMA table_info(inbox_messages);

-- 1e. Session messages with attachment flags
SELECT m.id, m.subject,
       m.has_attachments,
       m.attachment_count,
       m.sort_category,
       m.archived
FROM inbox_messages m
WHERE m.last_autosort_session_id = (
  SELECT id FROM autosort_sessions ORDER BY started_at DESC LIMIT 1
);

-- 1f. The AI summary JSON stored on the session — what did the LLM actually produce?
SELECT ai_summary_json FROM autosort_sessions ORDER BY started_at DESC LIMIT 1;
```

**Paste zone — 1a:**

```
(live output)
```

**Paste zone — 1b–1f:**

```
(live output)
```

### 1.2 Schema reference (from migrations)

- **`autosort_sessions`**: includes `id`, `started_at`, `completed_at`, `total_messages`, `urgent_count`, `pending_review_count`, `pending_delete_count`, `archived_count`, `error_count`, `duration_ms`, `ai_summary_json`, `status`, etc. (see `electron/main/handshake/db.ts` migration “Schema v48”).
- **`inbox_messages`**: includes `has_attachments`, `attachment_count`, `last_autosort_session_id`, `sort_category`, `urgency_score`, `archived`, `body_text`, `ai_analysis_json`, …

---

## STEP 2: Raw Database — Attachment Evidence

### 2.1 Queries

```sql
PRAGMA table_info(inbox_messages);

SELECT
  m.id,
  m.subject,
  SUBSTR(m.body_text, 1, 200) as body_preview,
  m.has_attachments,
  m.attachment_count,
  m.sort_category,
  m.archived
FROM inbox_messages m
WHERE m.last_autosort_session_id = (
  SELECT id FROM autosort_sessions ORDER BY started_at DESC LIMIT 1
);

SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%attach%';
```

**Expected:** `inbox_attachments` table exists (migration v29 in `db.ts`). You can join or query attachment rows per `message_id` once you confirm column names with `PRAGMA table_info(inbox_attachments)`.

**Paste zone:**

```
(live output)
```

---

## STEP 3: The Classify Prompt — What Did the LLM Actually See?

**Source file:** `apps/electron-vite-project/electron/main/email/ipc.ts`

### 3.1 `getInboxAiRulesForPrompt()`

Rules are read from **`WRExpert.md` in `userData`**; if missing, seeded from `WRExpert.default.md` next to the bundle or from inline `DEFAULT_WREXPERT_CONTENT`. **Comment lines (`#`) are stripped** before injection.

```142:148:apps/electron-vite-project/electron/main/email/ipc.ts
function getInboxAiRulesForPrompt(): string {
  const raw = getInboxAiRules()
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && line.trim() !== '')
    .join('\n')
}
```

### 3.2 `classifySingleMessage` — system prompt, user prompt, truncation

**Included DB fields for classification:** `from_address`, `from_name`, `subject`, `body_text`, **`has_attachments`**, **`attachment_count`**.

**Body truncation:** first **500** characters of `body_text` (not 8000 — that limit is used elsewhere for inbox context docs).

**Attachments in the user prompt:** **Yes.** A line is added: either `Has attachments: yes (N file(s) per message metadata)` or `Has attachments: no (0 files per message metadata)`.

```3047:3072:apps/electron-vite-project/electron/main/email/ipc.ts
    const userRules = getInboxAiRulesForPrompt()
    const systemPrompt = `${userRules}

Return ONLY a JSON object with this exact shape — no explanation, no markdown:
{
  "category": "pending_delete" | "pending_review" | "archive" | "urgent" | "action_required" | "normal",
  "urgency": <number 1-10>,
  "needsReply": <boolean>,
  "summary": "<one sentence>",
  "reason": "<one sentence>",
  "draftReply": "<draft reply or null>"
}`

    const from = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
    const attCount = typeof row.attachment_count === 'number' ? row.attachment_count : 0
    const hasAtt = (row.has_attachments === 1 || attCount > 0) ? 'yes' : 'no'
    const attachmentLine =
      hasAtt === 'yes'
        ? `Has attachments: yes (${attCount} file(s) per message metadata)`
        : 'Has attachments: no (0 files per message metadata)'
    /** Short body keeps Auto-Sort fast; subject + sender carry most triage signal. */
    const userPrompt = `Classify this email:
From: ${from}
Subject: ${row.subject || '(No subject)'}
${attachmentLine}
Body (first 500 chars): ${(row.body_text ?? '').slice(0, 500)}`
```

**Session stamp (R1):** `last_autosort_session_id` is set **before** the Ollama call when `sessionId` is provided:

```3035:3042:apps/electron-vite-project/electron/main/email/ipc.ts
    // Stamp session membership immediately — even if classify fails, this message is part of the session
    if (sessionId) {
      try {
        db.prepare('UPDATE inbox_messages SET last_autosort_session_id = ? WHERE id = ?').run(sessionId, messageId)
      } catch (e) {
        console.error('[AutoSort] Failed to stamp session on message:', messageId, e)
      }
    }
```

### 3.3 `WRExpert.default.md` on disk (repo)

The shipped default is at `apps/electron-vite-project/electron/WRExpert.default.md`. It explicitly defines attachment handling (minimum `pending_review` for attachments, etc.). **`DEFAULT_WREXPERT_CONTENT` in `ipc.ts` duplicates this** for first-run copy when the file cannot be read.

---

## STEP 4: The Summary Prompt — Why Did It Say “27”?

**Handler:** `autosort:generateSummary` in the same `ipc.ts` file.

### 4.1 Full handler (exact)

```1298:1386:apps/electron-vite-project/electron/main/email/ipc.ts
  ipcMain.handle('autosort:generateSummary', async (_e, sessionId: string) => {
    const db = await resolveDb()
    if (!db) return null
    const messages = db
      .prepare(
        'SELECT id, from_name, from_address, subject, sort_category, urgency_score, needs_reply, sort_reason FROM inbox_messages WHERE last_autosort_session_id = ? ORDER BY urgency_score DESC',
      )
      .all(sessionId) as Array<{
      id: string
      from_name?: string | null
      from_address?: string | null
      subject?: string | null
      sort_category?: string | null
      urgency_score?: number | null
      needs_reply?: number | null
      sort_reason?: string | null
    }>

    if (!messages.length) return null

    const lines = messages.map((m, i) =>
      `${i + 1}. [${m.sort_category}|urgency:${m.urgency_score}|reply:${m.needs_reply ? 'Y' : 'N'}] ${m.from_name || m.from_address}: ${m.subject}${m.sort_reason ? ' — ' + m.sort_reason : ''}`,
    ).join('\n')

    const systemPrompt = `You are a concise email triage assistant. Analyze the AutoSort results and produce a JSON summary for a dashboard.

RESPOND ONLY WITH VALID JSON. No markdown, no explanation, no fences.

Schema:
{
  "headline": "<one sentence: what happened, e.g. '27 emails sorted — 3 need urgent attention'>",
  "urgent_highlights": [
    { "idx": <message number>, "from": "<sender>", "subject": "<subject>", "reason": "<why urgent, 1 sentence>", "action": "<recommended action, 1 sentence>" }
  ],
  ...
}

Rules:
- urgent_highlights: max 5, only urgency >= 7 or category = urgent
- review_highlights: max 5, only pending_review or needs_reply = Y
...
`

    const userPrompt = `AutoSort batch — ${messages.length} messages:\n\n${lines}`

    try {
      ...
      db.prepare('UPDATE autosort_sessions SET ai_summary_json = ? WHERE id = ?').run(JSON.stringify(parsed), sessionId)

      return parsed
    } catch (err) {
      console.error('[AutoSort] Summary generation failed:', err)
      return null
    }
  })
```

### 4.2 Answers (from code)

| Question | Answer |
|----------|--------|
| What is `messages.length`? | Number of rows with `last_autosort_session_id = sessionId` at summary time — should match stamped messages for that session. |
| Does the user prompt include the correct count? | **Yes:** `AutoSort batch — ${messages.length} messages:` |
| Why might the headline still say “27”? | **Strong hypothesis:** The **system prompt schema example** hard-codes **`'27 emails sorted — 3 need urgent attention'`**. LLMs often echo example numbers. **Secondary:** free-form `headline` ignores `messages.length` validation. **Tertiary:** if the UI showed an old session, you’d see a stale `ai_summary_json`. |
| Stale session? | Compare `autosort_sessions.id` / `started_at` for the row you’re viewing vs `last_autosort_session_id` on the four messages (Step 1 queries). |

### 4.3 Suggested temporary logging (for your next run)

Add before/after the Ollama call in `autosort:generateSummary`:

- `console.log('[AutoSort Summary] sessionId:', sessionId, 'messages.length:', messages.length)`
- `console.log('[AutoSort Summary] Raw LLM output:', rawStr)` (already have `rawStr`)

---

## STEP 5: The Stats Computation — Where Do the Chip Numbers Come From?

**File:** `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx`

After `runAiCategorizeForIds` completes, **`getSessionMessages(sessionId)`** loads rows from the DB, then **`stats`** is computed and **`finalize(sessionId, stats)`** runs, then **`generateSummary(sessionId)`**.

```3023:3046:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
      if (sessionId && sessionApi?.getSessionMessages && sessionApi.finalize && sessionApi.generateSummary) {
        const sessionMessages = await sessionApi.getSessionMessages(sessionId)
        const stats = {
          total: sessionMessages.length,
          urgent: sessionMessages.filter(
            (m: { sort_category?: string; urgency_score?: number | null }) =>
              m.sort_category === 'urgent' || (m.urgency_score != null && m.urgency_score >= 7)
          ).length,
          pendingReview: sessionMessages.filter((m: { pending_review_at?: string | null }) => !!m.pending_review_at)
            .length,
          pendingDelete: sessionMessages.filter((m: { pending_delete?: number | null }) => !!m.pending_delete).length,
          archived: sessionMessages.filter((m: { archived?: number | null }) => !!m.archived).length,
          errors: Math.max(0, targetIds.length - sessionMessages.length),
          durationMs: Date.now() - startTime,
        }
        await sessionApi.finalize(sessionId, stats)
        ...
        await sessionApi.generateSummary(sessionId)
```

**Notes:**

- **`stats.total`** = count returned by `autosort:getSessionMessages` (messages stamped with that `sessionId`).
- **`stats.urgent`**: `sort_category === 'urgent'` **or** `urgency_score >= 7`.
- **`errors`**: `targetIds.length - sessionMessages.length` — can be **> 0** if some targets were never stamped (e.g. classify failed before stamp — but stamp happens before classify; if a message ID wasn’t processed, mismatch possible — verify against your run).
- **`pendingReview`** uses **`pending_review_at` only**, not `sort_category === 'pending_review'` alone. Aligns with DB updates in `classifySingleMessage` for review paths.

---

## STEP 6: The Review Panel — What Data Does It Actually Render?

**File:** `apps/electron-vite-project/src/components/AutoSortSessionReview.tsx`

### 6.1 Stat chips

When `session.total_messages` is a number, chips use **`session.urgent_count`**, **`pending_review_count`**, etc. **from the DB row** (written by `finalize`). Otherwise they **recompute from the `messages` array**.

```211:231:apps/electron-vite-project/src/components/AutoSortSessionReview.tsx
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
      ...
    }
  }, [session, messages])
```

### 6.2 “Urgent — Action Required” section (highlight cards)

Rendered from **`aiSummary.urgent_highlights`** only (AI JSON), **not** from `messageGroups.urgent`.

```299:375:apps/electron-vite-project/src/components/AutoSortSessionReview.tsx
  const urgentHighlights = aiSummary?.urgent_highlights?.length ? aiSummary.urgent_highlights : []
  ...
            {urgentHighlights.length > 0 ? (
              <section className="session-review-section session-review-section--urgent">
                <h3 className="section-heading">Urgent — Action Required</h3>
                <ul className="highlight-list">
                  {urgentHighlights.map((h, i) => (
```

### 6.3 “⚡ Urgent Messages (N)” list

Rendered from **`messageGroups.urgent`**, derived from **`messages`** (DB): `sort_category === 'urgent'` or `urgency_score >= 7`.

### 6.4 Can “0 URGENT” chip and “1 urgent card” disagree?

**Yes — by design, two sources:**

| UI element | Source |
|------------|--------|
| **Urgent chip** | `autosort_sessions.urgent_count` (from `finalize` stats = DB-derived counts) |
| **Urgent highlight cards** | `ai_summary_json.urgent_highlights` (second LLM call; may not match strict DB filters) |

The summary system prompt **asks** the model to restrict highlights to `urgency >= 7` or `urgent` category, but **nothing in code enforces** that against DB rows before display.

---

## STEP 7: Console Output

**Not captured in this static analysis.** To collect on your machine:

1. Run from devtools / terminal with Electron main logging enabled (see `electron/main.ts` file logging).
2. Add the temporary logs suggested in Steps 3–4.
3. Grep for `[AutoSort]`, `[SORT]`, `[AI-CATEGORIZE]`, and Ollama timings if exposed by `ollamaManager.chat`.

---

## Symptom → Cause Map (evidence-based)

| Symptom | Most likely causes (from code) |
|---------|----------------------------------|
| Header “4 messages” vs headline “27 emails sorted” | **`headline` is LLM-generated**; system prompt **example uses “27 emails”**; user prompt does pass correct `messages.length` — mismatch is **not** from wrong `messages.length` unless wrong `sessionId` or unstamped rows. |
| “0 URGENT” chip vs 1 urgent highlight card | Chips = **`urgent_count` from finalize**; cards = **`urgent_highlights`** — **independent**; model may emit highlights even when no row has `urgency_score >= 7` / `sort_category === 'urgent'`. |
| “4 ARCHIVED” but user expects no archive for attachments | Classify **does** send attachment metadata; if **`has_attachments` / `attachment_count` wrong in DB**, model sees “no attachments”. **reconcileInboxClassification** may also adjust category/urgency from subject/body. |
| Charts look “off” at small N | Charts use **`messages` from `getSessionMessages`** — consistent with stamped set; proportions can look extreme with N=4. |

---

## Code Paths Likely Needing Surgical Fixes

1. **Summary headline hallucination / wrong number:** Remove or generalize the **“27 emails”** example in `autosort:generateSummary` system prompt; optionally **overwrite `headline` in code** from `messages.length` after parse, or reject/regenerate if headline count disagrees.
2. **Chip vs AI highlight inconsistency:** After parsing summary JSON, **filter `urgent_highlights`** to rows that match DB rules (`urgency_score >= 7` or `sort_category === 'urgent'`), or **derive highlights from DB** and use LLM only for copy.
3. **Attachment / archive mismatch:** Verify **ingestion** sets `has_attachments` / `attachment_count` correctly; add **post-classify guard**: if DB says attachments and category is `archive`, bump to `pending_review` (product decision).
4. **Session truth:** Run Step 1 queries on **unlocked** DB to confirm **stamp coverage**, **finalize stats**, and **`ai_summary_json`** for one session ID end-to-end.

---

## Appendix: `ipc.ts` — `autosort:finalizeSession` column mapping

Stats from the renderer map to: `total_messages`, `urgent_count`, `pending_review_count`, `pending_delete_count`, `archived_count`, `error_count`, `duration_ms`.

---

*Generated from repository analysis. Replace “(live output)” sections with your SQLite/SQLCipher query results when debugging a specific session.*
