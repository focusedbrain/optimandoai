# WR Desk™ Inbox — Implementation Guide (Filled File Paths)

**Date:** March 19, 2026  
**Purpose:** Composer 1.5 prompt sequence with actual file paths from codebase exploration.

---

## Codebase Map (Quick Reference)

| Component | Electron App | Extension (Chromium) |
|-----------|--------------|----------------------|
| **Batch Toolbar** | `EmailInboxBulkView.tsx` (lines 1796–1932) | `BeapBulkInbox.tsx` (BatchToolbar 305–400) |
| **Message Cards** | `EmailInboxBulkView.tsx` (bulk-view-row, renderActionCard) | `BeapBulkInbox.tsx` (MessagePairCell) |
| **AI Panel (Normal Inbox)** | `EmailInboxView.tsx` (InboxDetailAiPanel 40–500) | N/A |
| **Draft Reply** | `EmailInboxView.tsx` + `useDraftRefineStore.ts` | Extension stores |
| **Chat Bar** | `HybridSearch.tsx` | CommandChatView, DockedCommandChat |
| **Auto-Sort / Urgency** | `EmailInboxBulkView.tsx`, `ipc.ts` | `beapClassificationEngine.ts`, `useBulkClassification.ts` |
| **BEAP Capsule** | `capsuleBuilder.ts` (handshake), `BeapMessageImportZone` | `BeapPackageBuilder.ts`, `parserService.ts` |

**Primary target:** Electron app (`apps/electron-vite-project/`) — WR Desk main app.

---

## PROMPT 1: Header Toolbar Cleanup

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (lines 1796–1932: `bulk-view-toolbar`, `bulk-view-selection-group`, `bulk-view-action-group`)
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` (bulkBatchSize, setBulkBatchSize — add "All" option support)

**Current structure (lines 1797–1818):**
```tsx
<div className="bulk-view-selection-group">
  <label><input type="checkbox" ... />Select all</label>
  <span className="bulk-view-selection-group-label">Batch</span>
  <select value={bulkBatchSize} ...>
    {[10, 12, 24, 48].map((n) => <option ...>{n}</option>)}
  </select>
  ...
</div>
```

**Action buttons (lines 1885–1912):** Delete, Archive, Review — remove when `selectedCount === 0` (or remove entirely; show contextually when selected).

**Store:** `bulkBatchSize` options are `[10, 12, 24, 48]`. Add `"All"` as first option. When "All" selected, `handleSelectAll`-equivalent behavior: select all messages in current view.

---

## PROMPT 2: Move Deleted Badge to Bottom Bar (Bulk Inbox)

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (lines 2225–2296: badge row inside `bulk-view-message-inner`)

**Current location:** Badges (Deleted, Pending Delete, Source) are in a flex row at lines 2225–2296, inside the message body area (`bulk-view-message-inner`).

**Target:** The "bottom bar" in the Bulk Inbox is the **right-side AI card** (`bulk-action-card-buttons` at lines 604–636). The layout is:
- **Left:** Message card (sender, subject, body, badges)
- **Right:** AI action card with `bulk-action-card-buttons` (Summarize, Draft, Delete)

**Options:**
1. Add a shared bottom bar to the **row** (spanning both message + AI card) for status badges.
2. Move Deleted badge into the **right-side** `bulk-action-card-buttons` area (alongside Summarize, Draft, Delete).

The doc says "bottom bar of the message card" — the message card (left) doesn't have a separate bottom bar. The AI card (right) does. **Recommendation:** Add a `bulk-view-message-bottom-bar` div at the bottom of the left message card, move all badges (Deleted, Pending Delete, Source, attachments, needsReply) there. This creates a clear "bottom bar" for the message card.

---

## PROMPT 3: Fix Analysis Section Collapse (Normal Inbox)

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (InboxDetailAiPanel: `panelCollapsed`, `onCollapsedChange`, `analysisExpanded`)
- `apps/electron-vite-project/src/App.css` (lines 832–876: `.inbox-detail-ai`, `[data-collapsed="true"]`)

**Root cause:** `panelCollapsed = !analysisExpanded && !draft` (line 181). When analysis is collapsed and no draft, `onCollapsedChange(true)` is called. The parent applies `data-collapsed="true"` to `.inbox-detail-ai`, and CSS shrinks the **entire panel** to 72px:
```css
.inbox-detail-ai[data-collapsed="true"] {
  min-width: 72px;
  width: 72px;
}
```

**Fix:** Decouple "analysis collapsed" from "panel collapsed". The ANALYSIS toggle should only hide `.ai-analysis-body` content. The panel width must stay fixed (e.g. 360px). Remove or repurpose `panelCollapsed` for the analysis section — it should NOT affect panel width. Use `analysisExpanded` only to toggle `.ai-analysis-body` visibility.

---

## PROMPT 4: Urgent Messages Stay Unsorted + Urgency Badges

**FILES TO MODIFY:**
- `apps/electron-vite-project/electron/main/email/ipc.ts` (AI categorization, urgency scoring — lines 1242, 1274, 1289, 1459, 1522, 1543, 1565, 1581)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (runAiCategorizeForIds, handleAiAutoSort, message row rendering with CATEGORY_BORDER, CATEGORY_BG)
- `apps/electron-vite-project/src/types/inboxAi.ts` (urgencyScore, urgency_score in BulkClassification)
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` (if urgency needs to persist on message model)

**Current behavior:** `sort_category` includes `urgent` (see CATEGORY_BORDER). Urgent messages are currently sorted like others. Need to exclude high-urgency from sort; keep them in "all" view with color coding and urgency badge in bottom bar.

---

## PROMPT 5: Add Undo Button to Sorted Messages

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (BulkActionCardStructured `bulk-action-card-buttons` at 604–636; add Undo for sorted views)
- `apps/electron-vite-project/electron/main/email/ipc.ts` or equivalent (undo: move message back to unsorted — clear `pending_delete`, `pending_review`, `archived` flags)

**Note:** `handleUndoPendingDelete` already exists (lines 2250–2266). Need equivalent for Pending Review and Archived. Add "Undo" to bottom bar when `filter.filter` is `pending_delete` | `pending_review` | `archived`.

---

## PROMPT 6: Show Analysis for Sorted Messages

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` (`clearBulkAiOutputsForIds` — called when moving messages; consider NOT clearing, or persisting analysis to DB)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (renderActionCard, bulk-action-card--guidance "Not yet analyzed" at 1578–1602)
- `apps/electron-vite-project/electron/main/email/ipc.ts` (when moving messages, preserve analysis in DB or pass through)

**Root cause (from WR_DESK_AUTO_SORT_RUNAWAY_ANALYSIS.md):** `processExpiredPendingDeletes` calls `clearBulkAiOutputsForIds(idsToMove)` when moving. Sorted messages therefore have empty `bulkAiOutputs`. Fix: either (a) persist analysis to DB and load it for sorted messages, or (b) stop clearing `bulkAiOutputs` when moving (keep in memory keyed by message id).

---

## PROMPT 7: Draft Reply Refinement Workflow

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (InboxDetailAiPanel: draft section, handleDraftTextareaFocus, 👉 emoji at line 457)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (BulkActionCardStructured: "👉 DRAFT REPLY" at line 483, draft textarea)
- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts` (connect, disconnect, updateDraftText, refined callback)
- `apps/electron-vite-project/src/components/HybridSearch.tsx` (chat bar, draft refine mode)

**Current:** Draft shows "👉 DRAFT REPLY" when generated. `handleDraftTextareaFocus` connects to refine store. Remove 👉 on initial generation; add small accept icon for refined draft.

---

## PROMPT 8: Add Attachment Support to Draft Replies

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (InboxDetailAiPanel draft section, handleSend)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (BulkActionCardStructured draft, handleSendDraft)
- `apps/electron-vite-project/electron/main/email/` (compose/send API — attach files to outgoing email)

**New:** Attachment button (📎), file picker, attachment chips, include in send.

---

## PROMPT 9: BEAP Capsule Builder for BEAP Draft Replies

**FILES TO MODIFY:**
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (InboxDetailAiPanel: branch on `message?.source_type === 'email_beap'` or similar)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` (BulkActionCardStructured: same branch for BEAP)
- Extension: `apps/extension-chromium/src/beap-builder/` (CapsuleBuilder components, parserService.ts for PDF)
- `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts`
- `apps/electron-vite-project/electron/main.ts` (PDF extract API 7623–7802)
- `apps/electron-vite-project/electron/main/email/pdf-extractor.ts`

**Note:** No `BeapCapsuleBuilder` component found in Electron app. Capsule builder logic lives in extension and `capsuleBuilder.ts` (handshake). May need to port or wrap extension components for Electron, or create a minimal capsule editor for BEAP draft replies.

---

## Execution Order (from Document)

```
Phase 1 — Quick Wins: Prompts 1, 2, 5
Phase 2 — Panel Fixes: Prompt 3
Phase 3 — Data/State: Prompts 4, 6
Phase 4 — Complex: Prompt 7
Phase 5 — Features: Prompts 8, 9
```

---

## Additional Notes from Codebase

1. **Two inbox implementations:** Electron (`EmailInboxBulkView`) and Extension (`BeapBulkInbox`). Document targets Electron; Extension has different BatchToolbar.
2. **Auto-sort guard:** Add `filter.filter` check per WR_DESK_AUTO_SORT_RUNAWAY_ANALYSIS.md before implementing Prompt 4.
3. **Batch size "All":** Store uses `bulkBatchSize` with `[10,12,24,48]`. "All" would need special handling (select all in current filter, not paginate).
4. **Build:** After Electron changes, run `npm run build` from `apps/electron-vite-project` (see `.cursor/rules/electron-build.mdc`).
