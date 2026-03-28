# Message Display Analysis

**Scope:** Read-only inventory of how BEAP-related messages are rendered in inbox detail (center panel), covering **Electron Normal Inbox** (`EmailMessageDetail`) and the **extension BEAP store inbox** (`BeapMessageDetailPanel` → `MessageContentPanel`). Native BEAP display requirements from the prompt are compared to current behavior.

---

## Detail Component

### Electron — Normal Inbox (SQLite `inbox_messages`)

| Item | Detail |
|------|--------|
| **File** | `apps/electron-vite-project/src/components/EmailMessageDetail.tsx` |
| **Component** | default export `EmailMessageDetail` **lines 85–424** |
| **Parent** | `EmailInboxView` renders `<EmailMessageDetail message={selectedMessage} … />` inside `.inbox-detail-message` (**~1940–1945** in `EmailInboxView.tsx`). |
| **Body rendering** | If `message.body_html`: **`dangerouslySetInnerHTML`** with **`sanitizeHtml`** (strip scripts, unsafe attrs) **lines 325–346**. Else: **plain text** via `<pre>` + **`extractLinkParts`** so URLs become safe **button** opens (not raw HTML) **lines 349–373**. |
| **BEAP-specific block** | If `depackaged_json` present: collapsible **“BEAP content”** toggle **lines 376–391** renders **`JSON.stringify(parsed, null, 2)`** in a `<pre>`-style block (`renderDepackagedJson`) — **not** a structured public/encrypted split. |
| **From / To** | **lines 136–139, 300–303**: `fromDisplay` = `from_name` + `<from_address>` or `from_address` or `—`; `toDisplay` = `to_addresses` or `—`. **Data:** `InboxMessage` fields from store (**`useEmailInboxStore.ts`** **lines 49–51**). |

### Extension — BEAP inbox store (`BeapMessage`)

| Item | Detail |
|------|--------|
| **File** | `apps/extension-chromium/src/beap-messages/components/BeapMessageDetailPanel.tsx` |
| **Component** | `MessageContentPanel` **lines 199–515** (scrollable body + footer `BeapReplyComposer`) |
| **Body rendering** | **Single block** of **`whiteSpace: 'pre-wrap'`** text: **`message.canonicalContent || message.messageBody`** **lines 356–371** — plain text only (no HTML, no markdown). Comment in `beapInboxTypes.ts` **206–218**: `messageBody` = transport plaintext; `canonicalContent` = decrypted authoritative body. |
| **Header identity** | Sender row **lines 246–308**: `senderDisplayName || senderEmail`, optional second line with email **lines 280–284**; trust badge **288–303**; “Reply via BEAP” vs “Reply via Email” from **`handshakeId !== null`** **lines 224–325**. |
| **From/To** | **No separate To:** line in this panel — receiver is implied by local inbox; not the same metadata row as Electron `to_addresses`. |

---

## BEAP Message Model

### `InboxMessage` (Electron DB row)

| Item | Detail |
|------|--------|
| **Type** | `InboxMessage` in **`useEmailInboxStore.ts`** **lines 43–84** |
| **Table** | **`inbox_messages`** — **`db.ts`** **lines 593–625** (`source_type`, `handshake_id`, `from_*`, `to_addresses`, `body_text`, `body_html`, `beap_package_json`, `depackaged_json`, attachment counts, …) |
| **Public vs encrypted body** | **No distinct columns.** Single **`body_text` / `body_html`** for display. Depackaged structure may live in **`depackaged_json`** (string) but the main body is not split into “pBEAP transport” vs “qBEAP confidential” fields at the row level. |
| **Attachments** | **`inbox_attachments`** table (**db.ts** **635+**); hydrated on **`InboxMessage.attachments`** (**`InboxAttachment[]`**) **useEmailInboxStore** **lines 79**. |

### `BeapMessage` (extension store)

| Item | Detail |
|------|--------|
| **Type** | **`beapInboxTypes.ts`** **`BeapMessage`** **lines 160–297** |
| **Public body field** | **`messageBody`** — transport / outer plaintext (**lines 206–211**). |
| **“Encrypted” / authoritative body** | **`canonicalContent`** — decrypted capsule-bound body (**lines 213–218**). Not named `encryptedBody`; semantics: for qBEAP, inner decrypted content; for pBEAP, same as transport. |
| **Attachments** | **`attachments: BeapAttachment[]`** on the object (**lines 221–222**); **`BeapAttachment`** **lines 53–81** (`attachmentId`, `filename`, `semanticContent`, **`selected`** for bulk UI). |

---

## Attachment UI

### Electron — `InboxAttachmentRow`

| Item | Detail |
|------|--------|
| **File** | `apps/electron-vite-project/src/components/InboxAttachmentRow.tsx` |
| **Selectable pattern** | **Yes.** **`isSelected = selectedAttachmentId === attachment.id`** **line 58**. Toggle via **`onSelectAttachment(isSelected ? null : attachment.id)`** **lines 117, 199**. |
| **Visual** | Purple border/background when selected **lines 100–104, 184–188**; checkmark **lines 108, 192**; buttons **“Select for chat” / “Selected for chat”** **lines 115–131, 197–213**. |
| **Integration** | `EmailMessageDetail` passes **`selectedAttachmentIdProp ?? storeSelectedAttachmentId`** and **`onSelectAttachment ?? selectAttachment(message.id, id)`** **lines 414–415**. Store: **`useEmailInboxStore`** `selectAttachment`. |

### Extension — `AttachmentRow` (inside `BeapMessageDetailPanel.tsx`)

| Item | Detail |
|------|--------|
| **Lines** | **~536–674** (attachment list in `MessageContentPanel`) |
| **Selectable** | **Yes** — click row toggles **`onSelectAttachment`**; **`isSelected`** drives border/background and **“active”** badge **lines 578–657**. |
| **Purpose** | Scope for attachment text reader / summarize / view original — **not** labeled “chat” but same selection id flows to **`onAttachmentSelect`** parent (**BeapMessageDetailPanel** **lines 1145–1152**). |

### Hybrid Search / “pointing finger”

- **Electron:** `EmailInboxView` accepts **`selectedAttachmentId` / `onSelectAttachment`** props **lines 1060–1061** and syncs to store **lines 1334–1353**, **1943** — parent (e.g. App) can drive selection for Hybrid Search. Attachment rows explicitly say **“Select for chat”**.
- **Extension:** `BeapInboxDashboard` passes **`onAttachmentSelect`** into **`BeapMessageDetailPanel`** (**BeapInboxDashboard.tsx** props **65–66**, **503**) to update search context.

---

## Source Identification

| Mechanism | Detail |
|-----------|--------|
| **Electron `InboxMessage`** | **`source_type`**: `'direct_beap' \| 'email_beap' \| 'email_plain'` (**schema CHECK** **db.ts** **595**). **`isBeap`** in UI: `email_beap \|\| direct_beap` (**EmailMessageDetail** **line 101**). |
| **Derived “Native BEAP” / handshake kind** | **`deriveInboxMessageKind`** **`inboxMessageKind.ts`** **lines 28–32**: **`handshake`** if `source_type === 'direct_beap'` **or** non-empty **`handshake_id`**; else **`depackaged`**. Product comment **lines 6–7**: handshake slice = **“Native BEAP”** in UI copy. |
| **Extension `BeapMessage`** | **`handshakeId`**, **`trustLevel`**, **`encoding`** (`qBEAP` / `pBEAP` / …) **`beapInboxTypes.ts`** **188–194**. No `source_type` string — store is BEAP-only. |
| **Set during ingestion** | Electron values are written when rows are inserted/updated in main-process inbox sync / BEAP ingestion (not re-traced line-by-line here); **`source_type`** + **`handshake_id`** are the stable columns for UI branching. |
| **Reliability** | **`deriveInboxMessageKind`** is the intended filter for “native vs depackaged”; raw **`source_type`** still distinguishes email-carried BEAP vs direct BEAP vs plain email. |

---

## Identity Resolution

| Topic | Detail |
|-------|--------|
| **Handshake link (Electron)** | **`InboxMessage.handshake_id`** **nullable** (**useEmailInboxStore** **line 46**). |
| **Navigation** | **`InboxHandshakeNavIconButton`** **`InboxHandshakeNavIcon.tsx`** — uses **`showHandshakeNavIcon(message)`** from **`inboxMessageKind.ts`** **44–47** (needs non-empty **`handshake_id`** and handshake kind). |
| **Lookup** | **No** inline fetch of handshake record inside **`EmailMessageDetail`** — display uses **`from_name` / `from_address`** on the message row only. Enriching with fingerprint/name from Handshakes DB would require **additional IPC** (not present in this component). |
| **Extension panel** | **`senderFingerprint`**, **`senderEmail`**, **`senderDisplayName`** on **`BeapMessage`**; **“View Handshake →”** when **`handshakeId`** set (**BeapMessageDetailPanel** **333–348**). |

---

## Gap vs Native BEAP Display (prompt checklist)

| Requirement | Current state |
|-------------|----------------|
| Separate **public** vs **confidential** bodies | **Electron:** one **`body_*`** + optional raw **`depackaged_json`**. **Extension store:** **`messageBody`** vs **`canonicalContent`** — closer, but Normal Inbox does not use `BeapMessage`. |
| **To:** receiver identity | **Electron:** **`to_addresses`** string only; often empty for P2P/direct BEAP paths. |
| **Attachments** selectable | **Implemented** (`InboxAttachmentRow` / extension `AttachmentRow`). |
| **Session + Import & Run** | **Not** in these detail components (see session analysis doc). |
| **Automation trigger / consent** | **Not** in message detail view. |

---

## Output Template (filled)

```markdown
## Detail Component
- File: EmailMessageDetail.tsx (Electron); BeapMessageDetailPanel.tsx (extension MessageContentPanel)
- Component: EmailMessageDetail; MessageContentPanel
- Body rendering: HTML+sanitize OR pre+links (Electron); pre-wrap canonicalContent||messageBody (extension)
- From/To source: InboxMessage.from_name/from_address/to_addresses; BeapMessage sender fields (no To row in extension panel)

## BEAP Message Model
- Type: InboxMessage at useEmailInboxStore.ts:43; BeapMessage at beapInboxTypes.ts:160
- Public body field: messageBody (BeapMessage); body_text (InboxMessage) — no pbeapContent column
- Encrypted body field: canonicalContent (BeapMessage); [MISSING as column] on InboxMessage — use depackaged_json / sync pipeline for structured data
- Attachments: inbox_attachments + InboxAttachment[]; BeapAttachment[] on BeapMessage

## Attachment UI
- Component: InboxAttachmentRow at InboxAttachmentRow.tsx; AttachmentRow in BeapMessageDetailPanel.tsx
- Selectable pattern: exists
- Selection state: selectedAttachmentId (prop/store); selectedAttachmentId local state in BeapMessageDetailPanel
- Visual indicator: purple border, ✓, "Selected for chat" / "active" badge

## Source Identification
- Field: source_type + handshake_id on InboxMessage; handshakeId + encoding on BeapMessage
- Set during: inbox row insert/update (main process)
- Values: direct_beap, email_beap, email_plain (Electron); deriveInboxMessageKind → handshake | depackaged

## Identity Resolution
- Handshake link: handshake_id (InboxMessage); handshakeId (BeapMessage)
- Lookup function: showHandshakeNavIcon at inboxMessageKind.ts:44
- Display format: email/name from row; fingerprint on BeapMessage; handshake nav opens Handshakes tab
```

---

*Analysis Prompt 3 of 4 — Native BEAP message rendering.*
