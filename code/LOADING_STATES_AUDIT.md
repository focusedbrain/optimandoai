# Loading States Audit — BEAP Messaging UI

**Task:** Verify every async operation shows a loading indicator. No silent waits.

---

## 1. .beap File Import

### Electron: BeapMessageImportZone (`apps/electron-vite-project/src/components/BeapMessageImportZone.tsx`)

| Check | Status | Notes |
|-------|--------|-------|
| Drop/select → what user sees | ⚠️ Partial | Shows "Importing..." in a status box (lines 183–192) |
| Spinner | ❌ **MISSING** | No spinner; only text "Importing..." |
| "Verifying message..." phase | ❌ **MISSING** | IPC returns immediately after insert; verification runs async in `usePendingP2PBeapIngestion`. User sees "✓ Message imported" before message is in inbox (0–5s delay). No visible verification phase. |
| Success feedback | ✓ | "✓ Message imported" |
| Failure feedback | ✓ | Error message shown |

**Add:**
- Spinner next to "Importing..." (e.g. `⟳` or CSS spinner)
- Optionally: after IPC success, show "Verifying message…" with spinner until message appears in inbox (requires polling `useBeapInboxStore` or similar)

### Extension: ImportFileModal (`apps/extension-chromium/src/ingress/components/ImportFileModal.tsx`)

| Check | Status | Notes |
|-------|--------|-------|
| Verifying indicator | ✓ | "🔐 Verifying package…" / "⏳ Decrypting and validating…" (lines 229–232) |
| Slow timeout (>10s) | ⚠️ Partial | `verifyingSlow` at 2s, not 10s. Task expects "Taking longer than expected..." at >10s |
| Spinner | ❌ **MISSING** | No spinner during verifying |
| Importing phase | ✓ | Button shows "Importing…" / "Verifying…" |

**Add:**
- Spinner during verifying phase
- Optional: add 10s timeout for "Taking longer than expected..." (in addition to existing 2s "Decrypting and validating…")

---

## 2. Email Sync

### beapSync (Electron main: `apps/electron-vite-project/electron/main/email/beapSync.ts`)

| Check | Status | Notes |
|-------|--------|-------|
| Visible indicator | ❌ **MISSING** | Runs in main process; no UI. Inbox has no "Checking for messages..." or sync icon |

### usePendingP2PBeapIngestion / usePendingPlainEmailIngestion (Extension)

| Check | Status | Notes |
|-------|--------|-------|
| Visible indicator | ❌ **MISSING** | Poll every 5s; process pending items. No UI when `globalProcessing === true` |

**Add:**
- In **BeapInboxSidebar** or inbox header: subtle "Checking for messages…" or sync icon when P2P/plain email ingestion is processing
- Requires: expose `isProcessing` from `usePendingP2PBeapIngestion` and `usePendingPlainEmailIngestion` (or a combined hook)

---

## 3. Send (All Modes)

### BeapReplyComposer (`apps/extension-chromium/src/beap-messages/components/BeapReplyComposer.tsx`)

| Check | Status | Notes |
|-------|--------|-------|
| Button → "Sending..." | ✓ | Lines 546–551: `state.isSending` → spinner + "Sending…" |
| Disabled during send | ✓ | `disabled={!canSend}`; canSend factors isSending |
| Success feedback | ✓ | "✓ BEAP™ capsule sent" / "✓ Email sent" |
| Failure feedback | ✓ | Error banner with Retry |

### Sidepanel BEAP Send (`apps/extension-chromium/src/sidepanel.tsx`)

| Check | Status | Notes |
|-------|--------|-------|
| Button → "Processing..." | ✓ | Line 586: `getBeapSendButtonLabel()` returns "⏳ Processing..." when `isSendingBeap` |
| Download mode: "Preparing..." | ⚠️ Minor | Uses "Processing..." for all modes. Task suggests "Preparing..." for download |
| Success toast | ✓ | "BEAP capsule downloaded" / "BEAP™ Message sent via P2P!" / "BEAP™ Message sent!" |

### BeapBulkInbox Send All (`apps/extension-chromium/src/beap-messages/components/BeapBulkInbox.tsx`)

| Check | Status | Notes |
|-------|--------|-------|
| Progress indicator | ✓ | "Sending X/Y…" when `isSending` (lines 464–466) |
| Failed count | ✓ | "· N failed" shown |

**Optional:** For download mode in sidepanel, change "Processing..." to "Preparing..." when `handshakeDelivery === 'download'`.

---

## 4. AI Classification (Batch)

### BeapBulkInbox + useBulkClassification

| Check | Status | Notes |
|-------|--------|-------|
| "Analyzing messages..." | ❌ **MISSING** | `useBulkClassification` returns `isClassifying`, `classifiedCount`, `totalCount` but **BeapBulkInbox does not use them** |
| Per-message progress | ⚠️ Partial | Urgency badges appear as each message is classified (via `batchClassify`), but no toolbar text |
| "Analysis complete" | ❌ **MISSING** | No completion message |

**Add:**
- In **BatchToolbar**: when `isClassifying`, show "Analyzing messages…" or "Analyzing X/Y…" with spinner
- Wire `isClassifying`, `classifiedCount`, `totalCount` from `useBulkClassification` into `BeapBulkInbox` and pass to `BatchToolbar`
- Optional: brief "Analysis complete" when `isClassifying` flips from true to false (or rely on sorted grid as feedback)

---

## 5. Draft with AI

### BeapReplyComposer

| Check | Status | Notes |
|-------|--------|-------|
| "Generating draft..." | ✓ | Overlay: "Drafting with AI…" with spinner (lines 288–307) |
| Placeholder | ✓ | "AI is drafting your reply…" (line 266) |
| Button state | ✓ | "Drafting…" when `isGeneratingDraft` (line 479) |
| Failure message | ✓ | `state.error` shown (e.g. "No AI provider configured") |

**Optional:** Map AI draft failure to "Couldn't generate a draft. Try writing manually." (see Part A audit).

---

## 6. Sandbox Depackaging (Verification)

### During verification of imported message

| Check | Status | Notes |
|-------|--------|-------|
| ImportFileModal | ✓ | Shows "Verifying package…" / "Decrypting and validating…" |
| Electron BeapMessageImportZone | ❌ **MISSING** | Verification is async (usePendingP2PBeapIngestion); user sees "✓ Message imported" before verification completes. No progress during verification |
| Message list | N/A | Verifying messages live in ingress/BeapMessagesStore; inbox shows only accepted messages |
| >10s "Taking longer than expected..." | ⚠️ Partial | ImportFileModal has 2s "Decrypting and validating…", not 10s |

**Add:**
- **ImportFileModal**: Add 10s timeout for "Taking longer than expected..." (in addition to 2s)
- **BeapMessageImportZone (Electron)**: No straightforward fix without changing IPC to wait for verification or adding a verification-status callback

---

## Summary: Missing Loading States

| # | Component | What to Add |
|---|-----------|-------------|
| 1 | **BeapMessageImportZone** (Electron) | Spinner next to "Importing...". Optionally: "Verifying message…" with spinner after IPC success until message appears. |
| 2 | **ImportFileModal** (Extension) | Spinner during verifying phase. Add 10s timeout for "Taking longer than expected..." |
| 3 | **BeapInboxSidebar** or inbox header | Subtle "Checking for messages…" or sync icon when `usePendingP2PBeapIngestion` or `usePendingPlainEmailIngestion` is processing. Requires exposing `isProcessing` from hooks. |
| 4 | **BeapBulkInbox** / **BatchToolbar** | When `isClassifying`, show "Analyzing messages…" or "Analyzing X/Y…" with spinner. Wire `isClassifying`, `classifiedCount`, `totalCount` from `useBulkClassification`. |
| 5 | **Sidepanel** (optional) | For download mode, use "Preparing..." instead of "Processing..." |

---

## Already Correct

- BeapReplyComposer: Send → "Sending…" with spinner
- BeapReplyComposer: Draft with AI → "Drafting with AI…" overlay
- Sidepanel BEAP send: "⏳ Processing..."
- BeapBulkInbox send: "Sending X/Y…"
- ImportFileModal: Verifying phase with progress text
