# Empty States Audit — BEAP Messaging UI

**Task:** Verify every view has a helpful empty state. No blank screens.

---

## 1. Inbox (no messages)

### Extension: BeapInboxSidebar (`apps/extension-chromium/src/beap-messages/components/BeapInboxSidebar.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No BEAP messages yet" | "No messages yet" | ⚠️ Minor |
| "Import a BEAP™ capsule from email, messenger, or file to get started." | "Import a .beap file or connect your email to get started." | ⚠️ Fix |
| "+ Import Capsule" button | [Import File] button \| [Connect Email] link | ⚠️ Add Connect Email |
| `onImport` only | Need `onConnectEmail` or link to settings | ⚠️ |

**Fix:**
- **Component:** `BeapInboxSidebar.tsx` (EmptyState, filter `all`)
- **Exact text:**
  - Title: `No messages yet`
  - Body: `Import a .beap file or connect your email to get started.`
  - CTA: Keep `+ Import` button; add `Connect Email` link/button if parent provides `onConnectEmail`

### Electron: BeapInboxDashboard (`apps/electron-vite-project/src/components/BeapInboxDashboard.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No BEAP messages yet." / "Import a .beap file or wait for incoming messages." | "No messages yet" / "Import a .beap file or connect your email to get started." | ⚠️ Fix |
| No [Import File] or [Connect Email] in empty state | Add CTAs | ⚠️ |
| Center panel shows EmailProvidersSection + "Import a .beap file to get started" | Good; right column has BeapMessageImportZone | ✓ |

**Fix:**
- **Component:** `BeapInboxDashboard.tsx` (left column empty state, lines 228–240)
- **Exact text:**
  - Line 1: `No messages yet`
  - Line 2: `Import a .beap file or connect your email to get started.`
- **Note:** Right column already has Import zone; center has EmailProvidersSection with Connect Email. Ensure the empty state text matches.

---

## 2. Inbox (no messages matching filter)

### BeapInboxSidebar EmptyState

| Filter | Current | Expected | Status |
|--------|---------|----------|--------|
| handshake | "No handshake messages" / "Messages from senders with an established handshake will appear here." | Same intent | ✓ Good |
| handshake body | — | "Messages from contacts you've established a handshake with will appear here." | ⚠️ Slight polish |
| urgent | "No urgent messages" / "Messages classified as urgent by AI or marked manually appear here." | "No urgent messages — you're all caught up." | ⚠️ Fix |
| email | "No email messages" / "Depackaged emails received without a handshake will appear here." | OK | ✓ |

**Fix:**
- **Component:** `BeapInboxSidebar.tsx` (EmptyState, `filterEmptyMessages`)
- **Exact text:**
  - `handshake.body`: `Messages from contacts you've established a handshake with will appear here.`
  - `urgent.title`: `No urgent messages`
  - `urgent.body`: `You're all caught up.`

---

## 3. Handshake detail — Messages section (no messages for this handshake)

### HandshakeWorkspace (`apps/electron-vite-project/src/components/HandshakeWorkspace.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No messages in this relationship yet." | "No messages with this contact yet" / "Send a message or wait for one to arrive." | ❌ Fix |

**Fix:**
- **Component:** `HandshakeWorkspace.tsx` (lines 1105–1108)
- **Exact text:**
  - Title: `No messages with this contact yet`
  - Body: `Send a message or wait for one to arrive.`

---

## 4. Bulk inbox (no messages)

### BeapBulkInbox (`apps/extension-chromium/src/beap-messages/components/BeapBulkInbox.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No messages to process" | Same | ✓ |
| "Import BEAP™ packages to start batch processing" | "Import a .beap file or connect your email to get started." (adapted) | ⚠️ Minor |
| No [Import File] or [Connect Email] | Add CTAs if available | ⚠️ |

**Fix:**
- **Component:** `BeapBulkInbox.tsx` (lines 1382–1383)
- **Exact text:**
  - Title: `No messages to process`
  - Subtitle: `Import .beap files or connect your email to get started.`
- **Note:** Bulk inbox may not have direct Import/Connect actions; ensure parent provides them or link to main inbox.

---

## 5. AI output panel (no AI responses yet)

### BeapMessageDetailPanel — AiOutputPanel (`apps/extension-chromium/src/beap-messages/components/BeapMessageDetailPanel.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "AI analysis will appear here" / "Ask a question in the search bar above to analyze this message" | "Ask a question about this message using the search bar above." | ✓ Good (minor wording) |
| Ghost icon ✨ with muted text | Not blank | ✓ |

**Optional polish:**
- **Component:** `BeapMessageDetailPanel.tsx` (AiOutputPanel, lines 818–830)
- **Exact text:** `Ask a question about this message using the search bar above.` (single line, or keep two-line)

### BeapBulkInbox — MessagePairCell AI empty state

| Current | Expected | Status |
|---------|----------|--------|
| "AI analysis will appear here" | Same intent | ✓ |

---

## 6. Attachment section (message has no attachments)

### BeapMessageDetailPanel — MessageContentPanel (`apps/extension-chromium/src/beap-messages/components/BeapMessageDetailPanel.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| `{message.attachments.length > 0 && (...)}` — section not rendered when empty | Don't show section at all | ✓ Correct |

**Result:** ✓ No change needed. Attachment section is hidden when empty.

### BeapBulkInbox MessagePairCell

| Current | Expected | Status |
|---------|----------|--------|
| `{message.attachments.length > 0 && (...)}` | Same | ✓ |

---

## 7. No email account connected (in inbox)

### EmailProvidersSection (`apps/extension-chromium/src/wrguard/components/EmailProvidersSection.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No email accounts connected" | Same | ✓ |
| "Connect your email account to use WRGuard email features" | "Connect your email to receive messages automatically." | ⚠️ Fix |
| [Connect Email] button in header | ✓ | ✓ |

**Fix:**
- **Component:** `EmailProvidersSection.tsx` (lines 103–105)
- **Exact text (inbox context):**
  - Title: `No email accounts connected`
  - Body: `Connect your email to receive messages automatically.`
- **Note:** WRGuard phrasing may be intentional elsewhere; consider a prop for context (inbox vs settings).

---

## 8. No handshakes established (RecipientHandshakeSelect)

### RecipientHandshakeSelect (`apps/extension-chromium/src/beap-messages/components/RecipientHandshakeSelect.tsx`)

| Current | Expected | Status |
|---------|----------|--------|
| "No Active Handshakes" | "No handshakes yet" | ⚠️ Minor |
| "Initiate a handshake with a recipient to send private BEAP messages." | "Establish a handshake to send encrypted messages." + [How to establish a handshake] link | ⚠️ Fix |

**Fix:**
- **Component:** `RecipientHandshakeSelect.tsx` (lines 97–124)
- **Exact text:**
  - Title: `No handshakes yet`
  - Body: `Establish a handshake to send encrypted messages.`
  - Add: Link or button "How to establish a handshake" (to docs or Handshakes tab)

---

## Summary: Empty States to Add/Fix

| # | Component | Current | Rewrite | Location |
|---|-----------|---------|---------|----------|
| 1 | BeapInboxSidebar | "No BEAP messages yet" / "Import a BEAP™ capsule..." | "No messages yet" / "Import a .beap file or connect your email to get started." | EmptyState, filter `all` |
| 2 | BeapInboxSidebar | handshake body | "Messages from contacts you've established a handshake with will appear here." | EmptyState, filter `handshake` |
| 3 | BeapInboxSidebar | urgent body | "You're all caught up." | EmptyState, filter `urgent` |
| 4 | BeapInboxDashboard | "No BEAP messages yet." / "Import a .beap file or wait..." | "No messages yet" / "Import a .beap file or connect your email to get started." | Left column empty state |
| 5 | HandshakeWorkspace | "No messages in this relationship yet." | "No messages with this contact yet" / "Send a message or wait for one to arrive." | BEAP Messages section |
| 6 | BeapBulkInbox | "Import BEAP™ packages to start batch processing" | "Import .beap files or connect your email to get started." | Empty state subtitle |
| 7 | EmailProvidersSection | "Connect your email account to use WRGuard email features" | "Connect your email to receive messages automatically." | Empty state body (inbox context) |
| 8 | RecipientHandshakeSelect | "No Active Handshakes" / "Initiate a handshake..." | "No handshakes yet" / "Establish a handshake to send encrypted messages." + [How to establish a handshake] | Empty state |

---

## Additional: Connect Email in Inbox Empty State

- **BeapInboxSidebar:** Add `onConnectEmail` prop and a "Connect Email" link/button next to Import when filter is `all`.
- **BeapInboxDashboard:** Center panel already has EmailProvidersSection with Connect Email; left empty state can mention it in text. No structural change if layout is clear.
