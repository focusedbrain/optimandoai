# ANALYSIS: PDF attachments lost during email ingestion + date not shown in card

## DO NOT make changes. Analyze only.

This document traces the Electron email pipeline and inbox UI as implemented in the repository at analysis time. Line references point at `apps/electron-vite-project/` unless noted.

---

## Problem 1: Attachments missing

Two test emails with PDF attachments were pulled; messages appear but PDFs are not shown (no attachment rows, no document reader).

## Problem 2: Date not visible in message card

Received date was only obvious in full detail; list cards showed relative time only. Sender **email** was not shown next to the display name on the bulk card.

---

## PART A: Trace attachment handling from Pull to UI

### Step 1: Provider fetch (`syncOrchestrator.ts` → `emailGateway`)

**Central sync loop** (`syncOrchestrator.ts`): For each listed message id, the orchestrator:

1. Calls `emailGateway.getMessage(accountId, msg.id)` → `provider.fetchMessage` → `sanitizeMessageDetail` (`gateway.ts` ~557–564).
2. **Only if** `detail.hasAttachments && detail.attachmentCount` → calls `listAttachments` + `fetchAttachmentBuffer` per attachment (~413–432).

```413:432:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
          const attachments: Array<{ id: string; filename: string; mimeType: string; size: number; contentId?: string; content?: Buffer }> = []
          if (detail.hasAttachments && detail.attachmentCount) {
            const attList = await emailGateway.listAttachments(accountId, msg.id)
            for (const att of attList) {
              let content: Buffer | undefined
              try {
                const buf = await emailGateway.fetchAttachmentBuffer(accountId, msg.id, att.id)
                if (buf) content = buf
              } catch {
                // Non-fatal: attachment without content still gets registered
              }
              attachments.push({
                id: att.id,
                filename: att.filename,
                mimeType: att.mimeType,
                size: att.size,
                contentId: att.contentId,
                content,
              })
            }
          }
```

**Per provider (fetch APIs):**

| Provider | `fetchMessage` includes attachment **bytes** in body? | Separate list + fetch? |
|----------|--------------------------------------------------------|-------------------------|
| **Outlook (Graph)** | No — body only; `hasAttachments` on Graph JSON is not mapped into `RawEmailMessage` (`outlook.ts` `parseOutlookMessage` ~1076–1127 returns no attachment flags). | **Yes** — `listAttachments` → `GET /me/messages/{id}/attachments` (~427–441); `fetchAttachment` → `GET .../attachments/{id}` with `contentBytes` base64 (~444–459). |
| **Gmail** | No — `parseGmailMessage` returns body text/html only (~813–847); attachments discovered via MIME walk in `extractAttachments` used by **`listAttachments`**, not embedded in `fetchMessage` return. | **Yes** — `listAttachments` refetches full message and `extractAttachments(msg.payload)` (~328–335); `fetchAttachment` uses Gmail attachment API (~337–355). |
| **IMAP** | Full RFC822 parsed with `mailparser` / `simpleParser` in `fetchMessageFromFolder` (~995–1045) — **attachment parts are not extracted** into a list here. | **`listAttachments` / `fetchAttachment` are stubs** — return `[]` and `null` (`imap.ts` ~1140–1147). |

So for **Gmail/Outlook**, attachment bytes are intended to be loaded in the orchestrator via **list + fetch**, not via `fetchMessage` alone. For **IMAP**, the design never wires MIME attachments into the same path the orchestrator uses.

---

### Step 2: Data passed to `detectAndRouteMessage`

`mapToRawEmailMessage` (`syncOrchestrator.ts` ~202–254) builds `RawEmailMessage.attachments` from the array populated in step 1:

```227:234:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      content: a.content,
    })),
```

- **Structure:** `{ id, filename, contentType, size, contentId?, content?: Buffer }`.
- **Content:** Buffer when `fetchAttachmentBuffer` returned a non-empty buffer; otherwise `content` may be **undefined** (fetch failed or skipped).

---

### Step 3: `messageRouter.ts` — `detectAndRouteMessage` / storage loop

Entry: `detectAndRouteMessage` (~168+). Attachments: `const attachments = rawMsg.attachments ?? []` (~187).

**Insert into `inbox_messages`:** `has_attachments` / `attachment_count` reflect **`attachments.length`**, not whether files persisted (~276–308).

**Per-attachment loop** (~352–431): For **each** entry in `attachments`:

- If `att.content && att.content.length > 0` → `writeEncryptedAttachmentFile` → `storage_path` + encryption metadata (~359–366).
- On write failure → `console.warn` only (~367–368).
- **`insertAtt.run` always runs** for every attachment row in the array (~371–379), even when `storagePath` is **null** (no content). Rows can exist with **no file on disk** when content was missing.

**PDF handling:** If PDF and content present, PDF text extraction runs (~395–417). No explicit **size cap** or **PDF MIME filter** skipping storage in this loop — empty/missing content is the main gate.

**Conditions where loop does nothing:** `attachments` is **empty** → no `inbox_attachments` rows.

---

### Step 4: `inbox_attachments` / SQL check

IPC hydrates attachments for list/detail when `has_attachments === 1` (`ipc.ts` ~2194–2198, ~2236–2237).

Suggested diagnostic query:

```sql
SELECT m.id, m.subject, 
  (SELECT COUNT(*) FROM inbox_attachments WHERE message_id = m.id) as att_count
FROM inbox_messages m 
ORDER BY created_at DESC LIMIT 5;
```

Also inspect whether rows have `storage_path IS NULL` (metadata without file).

---

### Step 5: UI — where attachments render

- **`EmailMessageDetail.tsx`:** Renders **ATTACHMENTS** when `message.has_attachments === 1` **and** `attachments.length > 0` (~395–418). Data comes from store/message object (`message.attachments`), loaded from DB via IPC when listing messages with `has_attachments`.
- **`InboxAttachmentRow.tsx`:** Single attachment row + document reader hooks.

If orchestrator never fetched attachments, `has_attachments` is **0** and **no** attachment rows → UI shows nothing.

---

### Step 6: Provider-specific notes

#### Outlook (Microsoft Graph)

- List: `GET /me/messages/{messageId}/attachments` (`outlook.ts` ~427–431).
- Fetch: `GET /me/messages/{messageId}/attachments/{attachmentId}` — expects `contentBytes` for file attachments (~444–453).
- `parseOutlookMessage` **does not** set attachment counts on `RawEmailMessage`; Graph **does** return `hasAttachments` on list/detail queries (~388, ~417), but that flag is **dropped** before sanitization.

#### Gmail

- `listAttachments` uses full message + `extractAttachments` walking payload parts with `body.attachmentId` (~869–888).
- `fetchAttachment` decodes `data` from `users/me/messages/.../attachments/...` (~337–347).

#### IMAP

- Bodies parsed to text/html; **no** attachment extraction in `fetchMessageFromFolder` (~995–1045).
- `listAttachments` / `fetchAttachment` **unimplemented** (~1140–1147).

---

### Step 7: Test emails (PDF, inline vs attachment)

Not observable from code alone. In code:

- **Gmail** `extractAttachments` marks `isInline` when `Content-Disposition` contains `inline` (~878–881). Sync still lists those parts if they have `attachmentId`.
- **Outlook** list returns `isInline` on items (~434–440); orchestrator does not filter inline vs attachment today — if the block ran, both would be attempted.

---

## PART B: Where attachments can be LOST — assessment

| # | Failure point | Verdict |
|---|----------------|--------|
| 1 | Provider returns metadata only | **Possible** if fetch fails; orchestrator still pushes entries with `content` undefined → DB row may exist without file. |
| 2 | **`syncOrchestrator` skips `listAttachments`** | **Very likely (Gmail/Outlook)** — gate `detail.hasAttachments && detail.attachmentCount` is **never satisfied** because `sanitizeMessage` hardcodes `hasAttachments: false` and `attachmentCount: 0` (`gateway.ts` ~1399–1400), and `sanitizeMessageDetail` does not override from raw. **Result: attachment array stays empty → nothing stored.** |
| 3 | `messageRouter` receives empty `attachments` | **Direct consequence of #2** for OAuth providers. |
| 4 | `storeAttachment` fails silently | **Possible** — warns only; row may still insert with null path if content was present but encrypt/write failed (logic mixes “no content” and “failed write”). |
| 5 | DB rows exist but UI hidden | **Unlikely** if `has_attachments` and joined rows are consistent; IPC loads rows when `has_attachments === 1`. |
| 6 | Size limit | **Not seen** in `messageRouter` attachment loop. |
| 7 | Content-type filter skipping PDF | **Not seen** for storage; PDFs get text extraction when content exists. |
| 8 | Inline-only disposition | **Possible edge case** for some clients; would need provider-specific filtering — not the primary issue vs #2. |
| **IMAP-specific** | Stubs return no attachments | **Certain** for IMAP until `listAttachments`/`fetchAttachment` parse MIME or raw message attachments are folded into sync. |

---

## PART C: Message card — date and sender email

### Component

Bulk list cards: **`EmailInboxBulkView.tsx`** (~4906–5037): left column header row shows `RemoteSyncStatusDot`, sender line, relative time, **View full**, **Delete**.

Normal inbox list rows: **`EmailInboxView.tsx`** → **`InboxMessageRow`** (~675+) — shows `formatRelativeDate(message.received_at)` and sender name only on first line (~757–778).

### Issue 1: Date

- **DB field:** `inbox_messages.received_at` (ISO string) — see `InboxMessage` (`useEmailInboxStore.ts` ~52).
- **Bulk card (current code):** Displays **`formatRelativeDate(msg.received_at)`** with **`title`** tooltip using **`formatDate(msg.received_at)`** (full calendar-style string) — see `EmailInboxBulkView.tsx` ~5000–5010. **Literal date is in the tooltip, not always in the main label.**
- **Full detail:** `EmailMessageDetail.tsx` ~300–303 prints **`formatDate(message.received_at)`** in the meta block.

To show **both** “Mar 20, 2026 14:23” and “3m” on the card itself, UI would need to change (not done in this analysis doc).

### Issue 2: Sender email

- **Fields:** `from_address`, `from_name` (`useEmailInboxStore.ts` ~41–42).
- **Bulk card:** Renders `msg.from_name || msg.from_address` only (~4972–4978) — **no** `"Name <email>"` line.
- **Full detail:** `fromDisplay` uses name + angle-bracket email when name exists (`EmailMessageDetail.tsx` ~136–138).

---

## Output format (summary)

### 1. Attachment flow trace (Steps 1–7)

- **Pull** lists messages → **getMessage** → **sanitizeMessageDetail** clears attachment flags.
- **Gate fails** → **no listAttachments/fetch** → **`attachments = []`** → **`detectAndRouteMessage`** inserts message with `attachment_count = 0`, **no** `inbox_attachments` rows.
- **UI** reads attachments from DB when `has_attachments === 1`; remains empty.

**Likely loss point:** `gateway.ts` + `syncOrchestrator.ts` gate (see Part B #2).

### 2. Root cause for missing PDFs (most likely)

**Primary:** `EmailGateway.sanitizeMessage` forces `hasAttachments: false` and `attachmentCount: 0` (`gateway.ts` ~1399–1400), so **`syncOrchestrator.ts` never enters the attachment fetch block** (~414). Gmail/Outlook attachment APIs exist but are not invoked during ingest.

**Secondary (IMAP):** Attachment APIs are **TODO** (`imap.ts` ~1140–1147); even a fixed gate would not load IMAP attachments until implemented or MIME attachments are extracted in `fetchMessage`.

### 3. `inbox_attachments` check

Run the SQL in Part 4. Expect **`att_count = 0`** for affected messages if the gate never ran. If rows exist with `storage_path` null, investigate fetch failures or write failures.

### 4. Message card improvements (what to change — informational)

| Item | Field | Location |
|------|--------|----------|
| Date (visible absolute + relative) | `received_at` | `EmailInboxBulkView.tsx` header row (~4960–5011); optionally mirror in `InboxMessageRow` |
| Sender email visible | `from_address`, `from_name` | Same bulk span (~4972–4978); align with `EmailMessageDetail` `fromDisplay` (~136–138) |

### 5. Fix recommendations (ordered — do not apply in this doc)

1. **`gateway.ts` ~1368–1430:** Populate `hasAttachments` and `attachmentCount` on `SanitizedMessage` / detail from provider raw data (extend `RawEmailMessage` or derive from `fetchMessage` / Graph `hasAttachments` + count, or **always** attempt `listAttachments` in orchestrator when not IMAP).
2. **`outlook.ts` `parseOutlookMessage` ~1076+:** Map Graph `hasAttachments` (and optionally count from `attachments@odata.nextLink` or a separate count) into raw/sanitized shape so the gate can pass.
3. **`syncOrchestrator.ts` ~414:** Consider relaxing or replacing the gate (e.g. always call `listAttachments` for Gmail/Outlook) to avoid stale flags.
4. **`imap.ts` ~1140–1147:** Implement `listAttachments` / `fetchAttachment` using parsed `mailparser` attachments from the same buffer already fetched in `fetchMessageFromFolder`, or parse `struct` + fetch BODY parts.
5. **`messageRouter.ts` ~352+:** Optionally skip inserting `inbox_attachments` rows when `storagePath` is null and content missing, to avoid empty shells (product decision).
6. **Bulk card UI (`EmailInboxBulkView.tsx`):** Show `from_name` + `from_address` (same pattern as `EmailMessageDetail`); show absolute date string alongside or instead of only relative, per product spec.

---

*End of analysis.*
