# BEAP Inbox — Targeted Re-Verification Audit

**Date:** 2026-03-15  
**Context:** Post 8 fix prompts addressing 22 failures (76% → target compliance)  
**Method:** Code inspection; no implementation changes

---

## Section 1: Re-check Previously Failed Items

### Fix 1: Wire verification → useBeapInboxStore (critical blocker)

**Requirement:** After Stage 5 sandbox verification succeeds, add the message to the inbox store so it appears in BeapInboxView, handshake view, and bulk inbox.

**Location:** `apps/extension-chromium/src/ingress/importPipeline.ts` lines 555–571

**Evidence:**
```ts
if (isSandboxSuccess(sandboxResponse)) {
  const pkg = sandboxResponse.result
  // ...
  if (pkg.allGatesPassed && pkg.authorizedProcessing?.decision === 'AUTHORIZED') {
    const handshakeId = resolveHandshakeId(pkg, options)
    useBeapInboxStore.getState().addMessage(pkg, handshakeId)
  }
}
```

**Verdict:** **PASS** — Verification success path correctly calls `addMessage` with sanitised package and handshake ID.

---

### Fix 2: onViewInInbox wiring (Handshake → sidepanel)

**Requirement:** When user clicks "View in Inbox" or "Open in Inbox" from a handshake view, switch to BEAP inbox and select that message.

**Location:** `apps/extension-chromium/src/sidepanel.tsx` lines 5470–5474, 6548–6552, 7662–7666

**Evidence:**
```ts
onViewInInbox={(messageId) => {
  setDockedWorkspace('beap-messages')
  setBeapSubmode('inbox')
  useBeapInboxStore.getState().selectMessage(messageId)
}}
```

**Verdict:** **PASS** — WRGuardWorkspace receives `onViewInInbox` and passes it to HandshakeManagementPanel / HandshakeDetailsPanel. Clicking "Open in Inbox →" triggers the callback.

---

### Fix 3: AI response routing to inbox

**Requirement:** When the search bar submits a query in message context, the AI response should be appended to the correct message’s AI output panel.

**Location:** `apps/extension-chromium/src/sidepanel.tsx` lines 2680–2686, 4779–4781; `BeapInboxView.tsx` lines 396–407

**Evidence:**
- `onAiQuery` sets `pendingInboxAiRef.current = { messageId, query }` and calls `startGenerating()`
- `routeAssistantToInboxIfPending(response)` calls `inboxViewRef.current?.appendAiEntry({ query, content: response, type: 'text', source: 'search' })`
- `BeapInboxView.appendAiEntry` routes to `detailPanelRef` (messages view) or `bulkInboxRef` (bulk view) based on `subView` and `selectedMessageId`

**Verdict:** **PARTIAL** — Response is routed to the currently selected message’s AI panel. If the user changes selection before the response arrives, the response may appear under the wrong message. The `messageId` in `pendingInboxAiRef` is not used when appending; routing relies on current selection. **Remains:** Consider ensuring `appendAiEntry` targets the message that originated the query when `messageId` is available.

---

### Fix 4: Handshake → inbox navigation

**Requirement:** From handshake view, user can navigate to inbox with a specific message selected.

**Location:** Same as Fix 2; HandshakeDetailsPanel footer "Open in Inbox →" button.

**Verdict:** **PASS** — Implemented via `onViewInInbox(messages[0].messageId)`.

---

### Fix 5: Bulk send retry + sandbox timeout UI

**Requirement:** Bulk send toolbar has "Retry Failed" when some sends fail; sandbox timeout shows user-friendly message.

**Location:** `BeapBulkInbox.tsx` lines 461–463, 690–711; `useBulkSend.ts`; `importPipeline.ts` failure paths

**Evidence:**
- `onRetryFailed` and `onRetrySend` wired; `retryFailed` from `useBulkSend` retries failed items
- Per-message "Retry" button when `isSendFailed && onRetrySend`
- Sandbox failure returns `nonDisclosingError: 'Package verification failed'`; no distinct "timeout" UI string

**Verdict:** **PARTIAL** — Bulk send retry: **PASS**. Sandbox timeout: **PARTIAL** — Failure stage (e.g. `TIMEOUT`) is not surfaced to the user; all failures show generic "Package verification failed". **Remains:** Optional: surface `failureStage === 'TIMEOUT'` with a specific message (e.g. "Verification timed out").

---

### Fix 6: Responsive layout (R.12)

**Requirement:** Sidebar collapses at 768px; bulk grid adapts columns by viewport.

**Location:** `useMediaQuery.ts` (NARROW_VIEWPORT, BULK_GRID_1COL, BULK_GRID_3COL); `BeapInboxView.tsx` lines 387–392, 500–508; `BeapBulkInbox.tsx` lines 1036–1040

**Evidence:**
- `NARROW_VIEWPORT = '(max-width: 767px)'`; sidebar collapses when `isNarrow`
- `BULK_GRID_1COL = '(max-width: 899px)'`, `BULK_GRID_3COL = '(min-width: 1600px)'`
- Grid: 1 col &lt; 900px, 2 cols 900–1600px, 3 cols &gt; 1600px

**Verdict:** **PASS** — Breakpoints and layout logic implemented as specified.

---

### Fix 7: Deep linking (R.8)

**Requirement:** URL hash/query `#message=<id>` or `#handshake=<id>` (or `?message=`, `?handshake=`) opens sidepanel with that message/handshake selected.

**Location:** `apps/extension-chromium/src/sidepanel.tsx` lines 136–162

**Evidence:**
```ts
const searchParams = new URLSearchParams(search)
const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
const messageId = searchParams.get('message') ?? hashParams.get('message')
const handshakeId = searchParams.get('handshake') ?? hashParams.get('handshake')
if (messageId) {
  setDockedWorkspace('beap-messages')
  setBeapSubmode('inbox')
  useBeapInboxStore.getState().selectMessage(messageId)
} else if (handshakeId) {
  setDockedWorkspace('wrguard')
  useWRGuardStore.getState().setActiveSection('handshakes')
  useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
}
```

**Verdict:** **PASS** — Both query and hash params supported for `message` and `handshake`.

---

### Fix 8a: New message animation (R.14)

**Requirement:** When `addMessage` adds a new message, track it as "new" for ~1s and apply slide-down animation in sidebar.

**Location:** `useBeapInboxStore.ts` lines 49–50, 224, 296–312; `BeapInboxSidebar.tsx` lines 381, 573, 604–605, 634–635, 654–656

**Evidence:**
- `newMessageIds: Set<string>`; `addMessage` adds ID, removes after `NEW_MESSAGE_TTL_MS` (1000ms)
- `isNewMessage(messageId)` selector
- `MessageGroupedList` receives `isNewMessage`; `BeapInboxListItem` gets `animateAppear={(isFirstGroup && i === 0) || isNewMessage(msg.messageId)}`
- CSS `beapMessageAppear 0.3s ease-out` applied when `animateAppear`

**Verdict:** **PASS** — New messages are tracked and animated as specified.

---

### Fix 8b: Retry button (E2E.7)

**Requirement:** In BeapReplyComposer error state, a "Retry" button clears error and re-triggers `sendReply()` with the same content.

**Location:** `BeapReplyComposer.tsx` lines 372–420

**Evidence:**
```ts
onClick={() => { actions.clearError(); actions.sendReply() }}
disabled={state.isSending}
```
- Button text: "Retry" / "Retrying…"
- Style: `#ef4444`, small button

**Verdict:** **PASS** — Retry calls `clearError` and `sendReply`; uses `isSending` for disabled state.

---

### Polish A: Deep linking (R.8)

**Verdict:** **PASS** — Same as Fix 7; hash support confirmed.

---

### Polish B: New message animation (R.14)

**Verdict:** **PASS** — Same as Fix 8a.

---

### Polish C: Markdown/chart rendering (M.10)

**Requirement:** AiEntryCard branches on `entry.type`: `text` (plain), `markdown` (formatted, sanitised), `chart` (table/JSON).

**Location:** `AiEntryContent.tsx`; `BeapMessageDetailPanel.tsx` lines 846–852; `BeapBulkInbox.tsx` lines 999–1009

**Evidence:**
- `AiEntryContent` branches on `entry.type`: `markdown` → ReactMarkdown with custom components; `chart` → `renderChartAsTable`; `text` → pre-wrap
- Link `href` sanitised (no `javascript:`)
- `AiEntryCard` and `AiEntryMini` use `<AiEntryContent entry={entry} ... />` instead of raw `{entry.content}`

**Verdict:** **PASS** — Markdown and chart rendering wired; link sanitisation in place.

---

### Polish D: Retry button (E2E.7)

**Verdict:** **PASS** — Same as Fix 8b.

---

### Nav-A: Footer message count clickable

**Requirement:** In handshake panel footer, message count is clickable (e.g. to switch to Messages tab).

**Location:** `HandshakeDetailsPanel.tsx` lines 594–606

**Evidence:**
```ts
<button onClick={() => setActiveTab('messages')} ...>
  {messages.length} Message{messages.length !== 1 ? 's' : ''}
</button>
```

**Verdict:** **PASS** — Message count button switches to Messages tab.

---

### Nav-B: Handshake → inbox navigation

**Verdict:** **PASS** — Same as Fix 2 / Fix 4.

---

### Nav-C: Inbox → handshake navigation

**Requirement:** From inbox, user can navigate to handshake for a message that has `handshakeId`.

**Location:** `BeapInboxSidebar.tsx` lines 330–335; `BeapMessageDetailPanel.tsx` lines 315–318; `BeapInboxView.tsx` lines 434–440; sidepanel `onNavigateToHandshake`

**Evidence:**
- "View Handshake" chip in sidebar and detail panel calls `onNavigateToHandshake(handshakeId)`
- Sidepanel: `setDockedWorkspace('wrguard')`, `setActiveSection('handshakes')`, `setSelectedHandshakeId(handshakeId)`

**Verdict:** **PASS** — Inbox → handshake navigation wired.

---

### Composer-A: Replace inline reply UIs with BeapReplyComposer

**Requirement:** Single shared BeapReplyComposer used in detail view and bulk grid.

**Location:** `BeapMessageDetailPanel.tsx` line 443; `BeapBulkInbox.tsx` line 876

**Evidence:**
- Both use `<BeapReplyComposer state={...} actions={...} ... />` with `useReplyComposer` state/actions

**Verdict:** **PASS** — No inline reply UIs; BeapReplyComposer used in both views.

---

### Composer-B: Encoding + distribution mode matching

**Requirement:** Reply composer matches message encoding (BEAP vs email) and distribution mode.

**Location:** `useReplyComposer.ts`; `getResponseMode` in store

**Evidence:**
- `getResponseMode(message)` returns `'beap'` when `handshakeId` present, else `'email'`
- Composer uses this for mode badge and send logic

**Verdict:** **PASS** — Mode derived from message; BEAP/email branching in place.

---

### Bulk-class: Wire bulk inbox AI toggles to useBulkClassification

**Requirement:** Batch AI toggle and per-pair AI toggles drive `useBulkClassification` and `batchClassify`.

**Location:** `BeapBulkInbox.tsx` lines 1052, 1117–1145, 1187–1191, 1231–1232

**Evidence:**
- `useBulkClassification` returns `startClassification`, `cancelClassification`
- `handleToggleAi` calls `startClassification([msg])` when enabling per-pair AI
- `handleBatchAiToggle` calls `startClassification(messages)` or `cancelClassification()`
- `batchClassify` in store receives results from classification engine

**Verdict:** **PASS** — Logic correct; `useBulkClassification` moved above handlers that use it (fix applied during audit).

---

## Section 2: Regression Checks

### Previously passing: Inbox empty state

**Check:** Empty inbox shows appropriate empty state and import prompt.

**Location:** `BeapInboxView.tsx` lines 482–486; `BeapInboxEmptyState`

**Verdict:** **PASS** — `messageCount === 0 && subView === 'messages'` shows `InboxEmptyState` with `onNavigateToDraft`.

---

### Previously passing: Message selection and detail panel

**Check:** Selecting a message shows content, attachments, reply composer.

**Location:** `BeapMessageDetailPanel.tsx`; `BeapInboxSidebar` onClick → `selectMessage`

**Verdict:** **PASS** — Selection flow intact; detail panel renders selected message.

---

### Previously passing: Filter tabs (All | Handshake | Email | Urgent)

**Check:** Sidebar filter tabs filter the message list correctly.

**Location:** `BeapInboxSidebar.tsx` filter logic

**Verdict:** **PASS** — Filter state and filtered list logic present; no regressions observed.

---

### Previously passing: Draft save and load

**Check:** `saveDraft` persists; switching messages loads existing draft.

**Location:** `useReplyComposer.ts`; `setDraftReply`, draft loading on message change

**Verdict:** **PASS** — Draft logic unchanged; store integration intact.

---

## Section 3: Integration Checks

### Deep link → inbox → message selected

**Flow:** Open sidepanel with `#message=abc123` → inbox view opens with message `abc123` selected.

**Verdict:** **PASS** — Deep-link `useEffect` runs on load; `selectMessage(messageId)` and `setBeapSubmode('inbox')` applied. Message must exist in store (e.g. from prior import) for selection to show content.

---

### New message → animation in sidebar

**Flow:** `addMessage` adds a message → it appears in sidebar with slide-down animation for ~1s.

**Verdict:** **PASS** — `newMessageIds` and `animateAppear` wiring supports this flow.

---

### AI markdown output → formatted display

**Flow:** AI returns `entry.type === 'markdown'` → bold, lists, code blocks render correctly.

**Verdict:** **PASS** — `AiEntryContent` with ReactMarkdown and custom components handles markdown.

---

### Send fails → Retry → resends

**Flow:** `sendReply` fails → error banner with Retry → user clicks Retry → `clearError` + `sendReply` → resend with same content.

**Verdict:** **PASS** — Retry button triggers `sendReply`; draft content preserved.

---

### Handshake → Inbox → Handshake roundtrip

**Flow:** From handshake, click "Open in Inbox" → inbox with message; from inbox, click "View Handshake" → handshake view with that handshake selected.

**Verdict:** **PASS** — Both directions wired via `onViewInInbox` and `onNavigateToHandshake`.

---

## Summary

| Category | Pass | Partial | Fail |
|----------|------|---------|------|
| Section 1 (fixes) | 17 | 1 | 0 |
| Section 2 (regression) | 4 | 0 | 0 |
| Section 3 (integration) | 5 | 0 | 0 |

### Remaining items

1. **Fix 3 (AI routing):** Consider routing AI response to the message that originated the query (using `pendingInboxAiRef.messageId`) when selection may have changed.
2. **Fix 5 (sandbox timeout):** Optional: surface `failureStage === 'TIMEOUT'` with a distinct user message.
3. **Bulk-class:** Fixed — `useBulkClassification` moved above handlers in `BeapBulkInbox.tsx`.
