# Post-Depackaging AI Inbox Trace

**Date:** 2025-03-15  
**Context:** What happens AFTER a message lands in useBeapInboxStore — the flow that feeds the AI inbox.

---

## STEP 1 — Message Arrives in Store

### addMessage(sanitisedPackage, handshakeId) called?

**Yes.** From `importPipeline.ts` → `verifyImportedMessage` → on success:
```ts
useBeapInboxStore.getState().addMessage(pkg, handshakeId)
```
Called when `pkg.allGatesPassed && pkg.authorizedProcessing?.decision === 'AUTHORIZED'`.

### BeapMessage created with all fields?

**Yes.** `sanitisedPackageToBeapMessage(pkg, handshakeId)` produces:
- `messageId`, `senderFingerprint`, `senderEmail`, `handshakeId`, `encoding`, `trustLevel`
- `messageBody`, `canonicalContent`, `attachments`, `automationTags`, `processingEvents`
- `timestamp`, `receivedAt`, `isRead: false`, `urgency: 'normal'`, `archived: false`

### Message appears in getInboxMessages()?

**Yes.** `getInboxMessages()` filters `!m.archived` and returns `sortByTimestampDesc(msgs)`.

### Message appears in getHandshakeMessages(handshakeId)?

**Yes.** When `handshakeId` is present, `getHandshakeMessages(handshakeId)` filters `m.handshakeId === handshakeId && !m.archived`.

### Status: ✅

---

## STEP 2 — AI Classification (Batch)

### useBulkClassification — does startClassification() work?

**Yes.** `startClassification(messages)` calls `classifyBatch(messages, engineConfig)` with progress callback. Each result calls `batchClassify([messageId], classificationMap)`.

### Does it call runStage61Gate per message before AI processing?

**Yes.** `beapClassificationEngine.ts` → `classifySingleMessage` → `gateMessage` → `runStage61Gate(capsule, [], message.processingEvents, policy, gateContext)`. If gate returns BLOCKED → `source: 'gate-blocked'`, no content sent to AI.

### Does it respect processingEventDeclarations boundaries (NONE/LOCAL/REMOTE)?

**Yes.** `projectContent(message, scope)` uses `resolveAuthorizedScope(gateResult)`:
- MINIMAL → tags + subject only
- SELECTED → declared artefact refs only
- FULL → canonicalContent

### After classification: does batchClassify() update urgency on messages?

**Yes.** `batchClassify` sets `urgency: classification.urgency` on each message.

### Does the grid reorder by urgency?

**Yes.** `BeapBulkInbox` sortedMessages:
```ts
const ORDER = { urgent: 0, 'action-required': 1, normal: 2, irrelevant: 3 }
return [...messages].sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency] || b.timestamp - a.timestamp)
```

### useBulkClassification hoisting fix?

**Yes.** `handleToggleAi` and `handleBatchAiToggle` use `startClassification` — they are defined **after** `useBulkClassification` (line 1212). No hoisting issue.

### Status: ✅

**Caveat:** Classification requires `policy: { allowSemanticProcessing: true }` and messages with `processingEvents`. pBEAP/depackaged messages often have `processingEvents: null` → `source: 'no-declaration'`, urgency stays `'normal'`.

---

## STEP 3 — Auto-Draft Generation

### When AI classifies a message, can it also generate a draft reply?

**No.** Classification and draft generation are separate. Classification updates urgency; draft generation is triggered by user clicking "Draft with AI" in the composer.

### useReplyComposer.generateAiDraft() — does it work?

**Yes.** Flow:
1. Gate check: `runStage61Gate(capsule, [], message.processingEvents, policy, gateCtx)`
2. If `AUTHORIZED`: `projectContent(message, scope)` → `config.aiProvider.classify(...)` with drafting instruction
3. Response `suggestedAction` or `summary` → `setDraftTextState(generated.trim())`

### Does it gate through Stage 6.1 before calling AI?

**Yes.** `generateAiDraft` calls `runStage61Gate` first; if `decision !== 'AUTHORIZED'`.

### Does it respect response mode (BEAP reply vs email reply)?

**Yes.** `mode` is derived from `message.handshakeId`; drafting instruction differs:
- `mode === 'email'`: "Draft a concise, professional email reply..."
- `mode === 'beap'`: "Draft a concise, professional reply to this BEAP message..."

### For email replies: does it append EMAIL_SIGNATURE?

**Yes.** In `sendReply`, email path: `const fullBody = content + EMAIL_SIGNATURE` (line 396).

### Status: ⚠️

**Caveat:** Requires `config.aiProvider` in `replyComposerConfig`. Neither extension nor Electron passes it:
- **Extension:** `BeapInboxView` receives `replyComposerConfig={{ senderFingerprint, senderFingerprintShort }}` — no aiProvider.
- **Electron:** `BeapInboxDashboard` does not pass `replyComposerConfig` at all.
- Result: "Draft with AI" shows "No AI provider configured." in both apps.

---

## STEP 4 — Auto-Tidy (Grace Period Deletion)

### Messages classified as 'irrelevant' with confidence > 0.8 → scheduleDeletion?

**Yes.** `useBulkClassification` → `classifyBatch` completion → `selectMessagesForAutoDeletion(messages, results, irrelevanceConfidenceThreshold)` → `scheduleDeletion(id, irrelevanceGracePeriodMs)` for each.

### Does purgeExpiredDeletions run on interval?

**Yes.** `useBulkClassification` has `useEffect` with `setInterval(() => purgeExpiredDeletions(), 10_000)` (configurable). `BeapBulkInbox` also runs `purgeExpiredDeletions` every 2s.

### Does PendingDeleteOverlay show countdown?

**Yes.** `PendingDeleteOverlay` shows "Deleting in {formatMs(remaining)}" with 500ms interval.

### Can user click "Keep" to cancel?

**Yes.** `onKeep` → `cancelDeletion(messageId)`.

### Status: ✅

---

## STEP 5 — Search Bar AI Integration

### When a message is selected and user queries the search bar: does the AI response go to the message detail AI panel?

**Yes.** In `sidepanel.tsx` `handleSendMessage`:
- When `dockedWorkspace === 'beap-messages'` AND `beapSubmode === 'inbox'` AND message selected:
- Sets `pendingInboxAiRef.current = { messageId: selectedMessage.messageId, query: text }` **before** send.
- When AI responds, `routeAssistantToInboxIfPending(response)` sends to `inboxViewRef.current?.appendAiEntry(...)`.

### KNOWN ISSUE: search bar submit does NOT set pendingInboxAiRef?

**Current code:** It **does** set it when `dockedWorkspace === 'beap-messages'` and `beapSubmode === 'inbox'` and a message is selected. The condition is checked at send time. If the user is in a different workspace (e.g. `wr-chat`) or mode (e.g. `draft`), it does not route to inbox.

### BEAP_Builder_Fix_Sequence.md Fix 6?

**File not found.** No fix document to verify against.

### Status: ⚠️

- **Extension sidepanel:** Routing works when in BEAP inbox with message selected.
- **Electron app:** `BeapInboxDashboard` has no integrated search bar. The Electron layout is 3-column (list | detail | import zone) without the sidepanel chat search bar. So search bar → AI panel routing is **extension-only**.

---

## STEP 6 — Attachment Reader

### When a depackaged message has attachments: does BeapMessageDetailPanel show semantic content in a reader view?

**Yes.** When `selectedAttachmentId` is set and the attachment has `semanticContent?.trim()`:
- Renders "📄 Extracted Text" section with `BeapAttachmentReader`.
- `BeapAttachmentReader` displays `attachment.semanticContent`.

### AttachmentRow — warning dialog before original access?

**Yes.** `AttachmentRow` has `showWarning` state; `handleViewOriginalClick` sets it; `handleConfirmViewOriginal` calls `onViewOriginal`. User must confirm before viewing original.

### BEAP_Builder_Fix_Sequence.md Fix 3?

**File not found.** No fix document to verify against.

### Status: ✅

- Reader view: present when `semanticContent` exists.
- Warning dialog: present for "View Original".
- **Caveat:** `semanticContent` is populated at **build time** by the sender's parser. If sender did not include it (e.g. PDF not parsed), reader shows nothing.

---

## MVP Demo Checklist

| Requirement | Working? | Shortest path if not |
|-------------|----------|----------------------|
| **Import .beap → message appears in inbox with correct icon** | ✅ | — |
| **Click message → split view shows content + AI panel** | ✅ | — |
| **Toggle batch AI → messages sorted by urgency** | ⚠️ | pBEAP often has no processingEvents → stays 'normal'. Enable heuristic-only or add default processingEvents for depackaged. |
| **Click "Draft with AI" → draft appears in composer** | ⚠️ | Neither app passes aiProvider. Shortest path: add aiProvider to replyComposerConfig (extension: from processFlow/agent; Electron: from main via IPC). |
| **Reply sent (download mode at minimum)** | ✅ | BEAP mode: buildPackage → download. Email mode: executeEmailAction. |

---

## Summary: What's Needed for MVP Demo

| Item | Status | Notes |
|------|--------|------|
| Import .beap → inbox | ✅ | Path A1 (Electron) or A2 (extension) |
| Correct icon | ✅ | 🤝 for handshake, ✉️ for depackaged |
| Split view content + AI | ✅ | BeapMessageDetailPanel |
| Batch AI toggle | ⚠️ | Works; pBEAP often unclassified (no processingEvents) |
| Grid reorder by urgency | ✅ | After classification |
| Draft with AI | ⚠️ | Needs aiProvider — not passed in either app |
| Reply sent | ✅ | Download or email |

**Shortest path for full MVP:**

1. **aiProvider for Draft with AI:** Neither extension nor Electron passes `aiProvider` in `replyComposerConfig`. Add it:
   - Extension: wire `processFlow` / agent `classify` or equivalent into `replyComposerConfig.aiProvider`.
   - Electron: expose `getProvider` (or a classify-capable bridge) via preload/IPC; pass to `BeapInboxDashboard` → `BeapMessageDetailPanel`.
2. **pBEAP classification:** Add fallback or default `processingEvents` for depackaged messages so heuristic classification can run when declaration is absent.
3. **Electron search bar:** Electron `BeapInboxDashboard` has no integrated search bar. If needed, implement `pendingInboxAiRef`-style routing or add a chat input that routes to the detail panel.
