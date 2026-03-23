# Chat No-Selection Retrieval Fix — Diagnosis & Implementation

## 1. Most Likely Root Cause

**When nothing is selected, `filter.handshake_id` stays empty.** The frontend sends `scope: 'context-graph'` or `scope: 'all'` (not a handshake id). The backend only sets `filter.handshake_id` when `scope.startsWith('hs-')`. So retrieval runs with an empty filter.

Retrieval does run (hybridSearch, semantic search). The problem is that with an empty filter:
- Semantic search queries all `capsule_blocks` / `context_blocks`
- If the index is sparse, dimension-mismatched, or visibility-filtered, results can be empty
- The LLM then receives empty/irrelevant context and responds with "The provided context does not contain this information."

**Secondary cause:** With no handshake scope, attachment-specific logic (e.g. auto-bind for "What is this attachment about?") never runs because it requires `filter.handshake_id`.

## 2. Current No-Selection Execution Path

1. User submits query with no handshake selected
2. `effectiveScope = selectedHandshakeId ?? scope` → `scope` (e.g. `'context-graph'`)
3. `chatWithContextRag({ scope: 'context-graph', ... })` sent to main
4. `filter = {}`; `scope.startsWith('hs-')` is false → `filter.handshake_id` stays unset
5. Structured path runs with empty filter
6. hybridSearch runs with empty filter
7. Semantic search: `WHERE 1=1` (no handshake filter) → searches all blocks
8. If blocks are empty or low-relevance → LLM gets weak/empty context → "context does not contain"

## 3. Where Retrieval Is Skipped

Retrieval is not skipped. The issue is that with an empty filter:
- Search is broad (all handshakes) and can return nothing useful
- Attachment-specific paths require `filter.handshake_id` and are skipped

## 4. Correct Fallback-Scope Behavior

When no handshake is selected and scope is `'context-graph'` or `'all'`:
1. Resolve a fallback handshake: most recent ACCEPTED/ACTIVE handshake that has context blocks
2. Set `filter.handshake_id = that handshake_id`
3. Run retrieval in that scope
4. If no such handshake exists, keep filter empty (search all)

## 5. Files/Functions Involved

| File | Function / Area | Change |
|------|-----------------|--------|
| `electron/main.ts` | Lines 2707–2726 | Fallback handshake resolution when filter empty |

## 6. Concrete Code Fix

After building the initial filter, add:

```ts
// Fallback scope: when no handshake selected, use most recent handshake with context
if (!filter.handshake_id && !filter.relationship_id && (scope === 'context-graph' || scope === 'all')) {
  try {
    const row = db.prepare(
      `SELECT c.handshake_id FROM context_blocks c
       INNER JOIN handshakes h ON h.handshake_id = c.handshake_id
       WHERE h.state IN ('ACCEPTED','ACTIVE')
       ORDER BY h.created_at DESC
       LIMIT 1`
    ).get() as { handshake_id: string } | undefined
    if (row?.handshake_id) {
      filter.handshake_id = row.handshake_id
      console.log('[Chat] No selection: using fallback handshake', row.handshake_id)
    }
  } catch (e) {
    /* ignore — proceed with empty filter */
  }
}
```

## 7. Patch by File

### electron/main.ts

```diff
         if (scope.startsWith('hs-')) filter.handshake_id = scope
         else if (scope.startsWith('rel-')) filter.relationship_id = scope
       }

+      // Fallback scope: when no handshake selected, use most recent handshake with context
+      if (!filter.handshake_id && !filter.relationship_id && (scope === 'context-graph' || scope === 'all')) {
+        try {
+          const row = db.prepare(
+            `SELECT c.handshake_id FROM context_blocks c
+             INNER JOIN handshakes h ON h.handshake_id = c.handshake_id
+             WHERE h.state IN ('ACCEPTED','ACTIVE')
+             ORDER BY h.created_at DESC
+             LIMIT 1`
+          ).get() as { handshake_id: string } | undefined
+          if (row?.handshake_id) {
+            filter.handshake_id = row.handshake_id
+            console.log('[Chat] No selection: using fallback handshake', row.handshake_id)
+          }
+        } catch (e) {
+          /* ignore — proceed with empty filter */
+        }
+      }
+
       // Structured path (no embedding needed): try first when embedding unavailable
```

## 8. Manual Verification Steps

1. **No explicit selection**
   - Open Handshakes view, do not select a handshake
   - Ask: "where do i find the annex"
   - Expected: retrieval runs in fallback handshake scope; answer or grounded "not found" (no immediate empty-context fallback)

2. **Handshake selected**
   - Select a handshake
   - Ask: "where do i find the annex"
   - Expected: search in that handshake’s context

3. **One attachment**
   - With fallback or selected handshake that has one document
   - Ask: "What is this attachment about?"
   - Expected: auto-bind and answer from that document

4. **Multiple attachments**
   - Handshake with multiple documents
   - Ask: "Summarize the attachment"
   - Expected: prompt to select which attachment

5. **Structured query**
   - No selection
   - Ask: "What are the opening hours?"
   - Expected: structured lookup in fallback scope if available

## 9. Remaining Limitations

- Fallback uses the most recent handshake by `created_at`; it may not match the user’s mental model
- When vault is locked, fallback can pick a handshake with only private blocks → empty results
- No UI indication that a fallback handshake is in use
- With zero handshakes, filter stays empty; behavior unchanged
