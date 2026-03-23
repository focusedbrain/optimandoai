# BEAP Inbox/Builder — Linux Diagnostic Audit

**Date:** 2025-03-15  
**Purpose:** Diagnose Linux rendering failure for BEAP Inbox and Builder views.

---

## Part A — Error Boundaries (Implemented)

### 1. InboxErrorBoundary Component (Enhanced)

**Location:** `apps/extension-chromium/src/beap-messages/components/InboxErrorBoundary.tsx`

**Features:**
- Catches render errors and displays fallback UI: "Something went wrong loading this view"
- **Show Error Details** button — expands to show component name, error message, stack trace
- **Retry** button — resets error state and re-renders children
- Logs to console: `[BEAP Error Boundary] {componentName}:` with full error, component stack, and stack trace
- Does not crash the entire sidepanel — other tabs remain functional

### 2. Wrapped Components

| Component | Location | componentName |
|-----------|----------|---------------|
| BeapInboxView | sidepanel.tsx (3 view modes) | `BeapInboxView` |
| BeapBuilder (Draft) | sidepanel.tsx (App + Admin views) | `BeapBuilder` |
| HandshakeDetailsPanel Messages (expanded) | HandshakeDetailsPanel.tsx | `HandshakeDetailsPanel-Messages` |
| HandshakeDetailsPanel Messages tab | HandshakeDetailsPanel.tsx | `HandshakeDetailsPanel-MessagesTab` |

### 3. Startup Logging

| Component | Log |
|-----------|-----|
| BeapInboxView | `[BEAP Inbox] Mounted, subView: {subView}` on mount |
| BeapInboxView | `[BEAP Inbox] subView changed: {subView}` when switching Messages/Bulk |
| BeapBulkInbox | `[BEAP Bulk] Mounted` on mount |
| InboxErrorBoundary | `[BEAP Error Boundary] {name}:` on componentDidCatch |

---

## Part B — Import Audit

### BeapInboxView

**Imports:** React, BeapInboxSidebar, BeapMessageDetailPanel, BeapBulkInbox, useBeapInboxStore, useInboxKeyboardNav, useMediaQuery

**Result:** ✅ No Node.js APIs. No `require('electron')`, `require('fs')`, `require('path')`, `require('crypto')`. All imports are React, Zustand, or local modules. Uses `window.matchMedia` (browser API).

### BeapInboxSidebar

**Imports:** React, beapInboxTypes, useBeapInboxStore

**Result:** ✅ No Node/Electron imports.

### BeapBulkInbox

**Imports:** React, beapInboxTypes, useBulkSend, useBulkClassification, useReplyComposer, BeapReplyComposer, AiEntryContent, BeapAttachmentReader, useMediaQuery, useBeapInboxStore, useViewOriginalArtefact

**Result:** ✅ No Node/Electron imports. `useViewOriginalArtefact` uses `atob`, `Uint8Array`, `Blob`, `URL.createObjectURL` — all Web APIs.

### BeapMessageDetailPanel

**Imports:** React, beapInboxTypes, useBeapInboxStore, useBeapMessageAi, useReplyComposer, BeapReplyComposer, AiEntryContent, BeapAttachmentReader, useViewOriginalArtefact

**Result:** ✅ No Node/Electron imports.

---

## Part B — Electron Orchestrator Dependencies

### BEAP Inbox/Builder Tree

**Finding:** The BEAP Inbox components (BeapInboxView, BeapInboxSidebar, BeapBulkInbox, BeapMessageDetailPanel) do **not** import or call the Electron Orchestrator directly.

**Orchestrator usage elsewhere:**
- `parserService.ts` — calls `http://127.0.0.1:51248/api/parser/pdf/extract` when browser PDF parsing returns empty. Used by **BEAP Builder (Draft)** for attachment parsing, not by Inbox.
- `background.ts`, `getActiveAdapter.ts`, `OrchestratorSQLiteAdapter.ts` — storage/orchestrator status. Not imported by BEAP inbox components.
- `electronRpc` — used by sidepanel for `llm.status`, but not by BEAP inbox components.

**Conclusion:** BEAP Inbox does not depend on the Electron Orchestrator at init or render time. If the orchestrator is unavailable, the Inbox should still load. The Builder (Draft) uses `processAttachmentForParsing` which fetches the orchestrator only when parsing a PDF — that is async and should not block mount.

**Potential issue:** If `processAttachmentForParsing` or `processAttachmentForRasterization` is called at component init (e.g. in a useEffect that runs immediately), a fetch to `127.0.0.1:51248` could fail. On Linux, `fetch` to localhost typically does not throw — it returns a failed response. The parser service handles that. No blocking init-time fetch was found in the BEAP inbox tree.

---

## Part B — CSS/Layout

### useMediaQuery

Uses `window.matchMedia(query)`. Standard browser API. No known Linux GTK issues.

### Layout

- Flexbox, inline styles. No `height: 0` or `display: none` that would hide content conditionally on platform.
- `minHeight: 0` is used for flex overflow — standard pattern.

**Conclusion:** No obvious CSS/layout issues that would cause Linux-specific blank screens.

---

## Part B — Conditional Rendering (sidepanel.tsx)

### When `dockedWorkspace === 'beap-messages'` and `beapSubmode === 'inbox'`

Renders:
```jsx
<InboxErrorBoundary componentName="BeapInboxView" theme={...}>
  <BeapInboxView ref={inboxViewRef} ... />
</InboxErrorBoundary>
```

### Loading State

BeapInboxView uses `isLoading` state, set to `false` after 600ms timeout. No async operation that could hang. Store data comes from Zustand — synchronous.

### Async at Mount

- BeapInboxView: 600ms timer only.
- BeapBulkInbox: `useBulkClassification`, `useViewOriginalArtefact` — no blocking fetches at init.

**Conclusion:** No mount-time async that would fail silently on Linux.

---

## Summary of Linux-Specific Hypotheses

1. **Import/runtime error** — Most likely. A missing or incompatible module could throw during import. The new error boundary will surface it.
2. **Electron Orchestrator** — Unlikely for Inbox. Builder uses it only when parsing PDFs (async).
3. **CSS/layout** — Unlikely. No platform-specific CSS found.
4. **Conditional rendering** — No loading state that never resolves.

**Recommendation:** With error boundaries and startup logging in place, reproduce on Linux and check:
- Browser console for `[BEAP Inbox] Mounted` — if absent, failure is before/during BeapInboxView mount.
- `[BEAP Error Boundary]` — will show the exact error and stack.
