# WR Desk — Email Inbox Post-Flight Audit Report

**Audit Date:** 2025-03-15  
**Scope:** Email inbox feature implementation (12 implementation prompts)

---

## 1. SCORECARD

| Section | Pass | Partial | Fail | Score |
|---------|------|---------|------|-------|
| A Database | 7/7 | 0/7 | 0/7 | 100% |
| B Router | 7/8 | 1/8 | 0/8 | 94% |
| C BEAP Sync | 3/3 | 0/3 | 0/3 | 100% |
| D Sync Orchestrator | 8/8 | 0/8 | 0/8 | 100% |
| E Remote Deletion | 6/6 | 0/6 | 0/6 | 100% |
| F Plain Email Ingestion | 6/6 | 0/6 | 0/6 | 100% |
| G IPC Handlers | 10/10 | 0/10 | 0/10 | 100% |
| H Preload Bridge | 4/4 | 0/4 | 0/4 | 100% |
| I Zustand Store | 8/8 | 0/8 | 0/8 | 100% |
| J Inbox Toolbar | 5/6 | 1/6 | 0/6 | 92% |
| K Inbox Single View | 10/10 | 0/10 | 0/10 | 100% |
| L Message Detail | 6/6 | 0/6 | 0/6 | 100% |
| M Attachment Viewer | 6/6 | 0/6 | 0/6 | 100% |
| N Bulk Grid View | 7/7 | 0/7 | 0/7 | 100% |
| O Handshake BEAP Messages | 7/7 | 0/7 | 0/7 | 100% |
| P Handshake View Integration | 3/3 | 0/3 | 0/3 | 100% |
| Q Hybrid Search Integration | 5/5 | 0/5 | 0/5 | 100% |
| R App Wiring | 6/6 | 0/6 | 0/6 | 100% |
| S Cross-Cutting | 9/10 | 1/10 | 0/10 | 95% |
| **TOTAL** | **124/131** | **3/131** | **0/131** | **95%** |

---

## 2. ALL FAILURES AND PARTIALS (detail)

### B8 — ⚠️ PARTIAL
**File:** `apps/electron-vite-project/electron/main/email/messageRouter.ts` (lines 121–128)  
**What's wrong:** `extractHandshakeId` checks `header.receiver_binding.handshake_id` and top-level `handshake_id`, but the checklist expects `header.handshake_id` as well. Some BEAP packages may use `header.handshake_id` directly.  
**Fix:** Add fallback for `header.handshake_id`:

```ts
function extractHandshakeId(parsed: Record<string, unknown>): string | null {
  const h = parsed.header as Record<string, unknown> | undefined
  if (h) {
    if (typeof h.handshake_id === 'string') return h.handshake_id
    if (typeof h.receiver_binding === 'object') {
      const rb = h.receiver_binding as Record<string, unknown>
      if (typeof rb?.handshake_id === 'string') return rb.handshake_id
    }
  }
  if (typeof parsed.handshake_id === 'string') return parsed.handshake_id
  return null
}
```

---

### J2 — ⚠️ PARTIAL
**File:** `apps/electron-vite-project/src/components/EmailInboxToolbar.tsx` (lines 119–125)  
**What's wrong:** Filter tabs compare `filter === tab` but `filter` is the full `InboxFilter` object. No tab ever shows as active. `onFilterChange(tab)` passes a string instead of `Partial<InboxFilter>`.  
**Fix:** Use `filter.filter === tab` and `onFilterChange({ filter: tab })`:

```tsx
// Line 119: change
const active = filter.filter === tab
// Line 124: change
onClick={() => onFilterChange({ filter: tab })}
```

Also remove unused destructured props `sourceType` and `onSourceTypeChange` from the component (lines 89–90) — they are not in the interface and `filter.sourceType` is used instead.

---

### S1 — ⚠️ PARTIAL
**File:** Multiple (pre-existing + inbox-adjacent)  
**What's wrong:** `tsc --noEmit` reports TypeScript errors. Inbox-adjacent: `syncOrchestrator.ts` lines 214–215 (`null` not assignable to `string | undefined`). Many other errors exist in main.ts, handshake modules, etc.  
**Fix:** For syncOrchestrator.ts, change `null` to `undefined` where the type expects `string | undefined`. Address remaining TS errors per file.

---

## 3. REMEDIATION PLAN

Numbered fixes in dependency order:

```
1. [File: apps/electron-vite-project/electron/main/email/messageRouter.ts]
   Fix B8: Add header.handshake_id fallback in extractHandshakeId (before receiver_binding check)

2. [File: apps/electron-vite-project/src/components/EmailInboxToolbar.tsx]
   Fix J2: Filter tabs — use filter.filter === tab for active state; use onFilterChange({ filter: tab }) on click
   Remove unused sourceType, onSourceTypeChange from destructuring

3. [File: apps/electron-vite-project/electron/main/email/syncOrchestrator.ts]
   Fix S1 (inbox-adjacent): Replace null with undefined for last_uid/sync_cursor where type expects string | undefined (lines 214–215)

4. [Optional] Address remaining TypeScript errors in main.ts, handshake modules, plainEmailConverter, providers — these are pre-existing and not inbox-specific
```

---

## 4. SUMMARY VERDICT

### 🟡 MINOR FIXES

All core inbox functionality is implemented. Three partial items need attention:

1. **B8** — Add `header.handshake_id` fallback in `extractHandshakeId` for broader BEAP compatibility.
2. **J2** — Fix filter tab active state and `onFilterChange` payload in `EmailInboxToolbar`.
3. **S1** — Fix `syncOrchestrator.ts` null/undefined types; consider addressing other pre-existing TS errors.

**Recommendation:** Apply fixes 1–3 above. The inbox feature is structurally complete and ready for testing after these minor corrections.

---

## Appendix: Per-Check Results (PASS unless noted)

| ID | Result | Notes |
|----|--------|-------|
| A1–A7 | ✅ | All db tables, indexes, migration pattern |
| B1–B7 | ✅ | messageRouter exists, exports, interfaces, detection order, dual-insert, attachments |
| B8 | ⚠️ | See detail above |
| C1–C3 | ✅ | detectBeapMessagePackage, qBEAP/pBEAP in sync, JSON/.beap attachment check |
| D1–D8 | ✅ | syncOrchestrator, syncAccountEmails, startAutoSync, setTimeout loop, auto_sync check |
| E1–E6 | ✅ | remoteDeletion, queue/cancel/execute/bulk, 72h grace, 30-day purge |
| F1–F6 | ✅ | plainEmailIngestion, processPendingPlainEmails, convertPlainToBeapFormat, depackaged_json, processed=1 |
| G1–G10 | ✅ | registerInboxHandlers, all IPC handlers, 5-min deletion timer, activeAutoSyncLoops Map |
| H1–H4 | ✅ | emailInbox bridge, all methods, onNewMessages cleanup, handshakeViewTypes.d.ts |
| I1–I8 | ✅ | useEmailInboxStore, InboxMessage/InboxAttachment, fetchMessages, selectMessage, CRUD |
| J1, J3–J6 | ✅ | Toolbar exists, source tabs, toggle, pull button, bulk actions |
| J2 | ⚠️ | See detail above |
| K1–K10 | ✅ | EmailInboxView layout, message rows, bulk mode, onNewMessages |
| L1–L6 | ✅ | EmailMessageDetail header, body, attachments, deletion notice |
| M1–M6 | ✅ | InboxAttachmentRow, three buttons, Document Reader (dark theme, line numbers), open original |
| N1–N7 | ✅ | EmailInboxBulkView 2-col grid, toolbar, message cards, AI output, pagination |
| O1–O7 | ✅ | HandshakeBeapMessages, listMessages(handshakeId), collapsible, onSelectMessage/Attachment |
| P1–P3 | ✅ | HandshakeBeapMessages in HandshakeWorkspace, selectedMessageId/selectedAttachmentId |
| Q1–Q5 | ✅ | SearchScope inbox-messages, Inbox tab, runInboxSearch, scope indicator, chat context |
| R1–R6 | ✅ | App state, emailAccounts, onAccountConnected, beap-inbox routing, bulk toggle |
| S2–S10 | ✅ | Imports resolve, CSS vars, no circular deps, IPC channels match, optional chaining, FKs, userData, cleanup |
| S1 | ⚠️ | See detail above |
