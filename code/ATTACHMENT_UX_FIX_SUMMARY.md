# Attachment UX Fix — Implementation Summary

## 1. Root Causes Found

### A. "Open original" visibility
- **Cause:** The "View original" button was gated by `vaultUnlocked && doc.id`. When the vault was locked, the button was not rendered at all.
- **Fix:** Always render "Open original" for documents with `doc.id`; when vault is locked, show it disabled with tooltip "Unlock vault to open original".

### B. No attachment selection mechanism
- **Cause:** `onDocumentSelect` was only called when opening the Document Reader. There was no way to select a document for chat without opening the reader.
- **Fix:** Added explicit "Select for chat" / "Selected for chat" button on each document card. Selection state is passed via `selectedDocumentId` and shown visually.

### C. Backend required selection but UI offered none
- **Cause:** Backend returned "Please select a document" when no `selectedDocumentId` was present, but the UI had no clear selection flow.
- **Fix:** Added visible selection UI and auto-bind when exactly one attachment exists.

### D. Generic no-selection message
- **Cause:** Same message for all cases: "Please open a document from the handshake context first."
- **Fix:** Context-aware messages: no attachment, one (auto-use), or multiple (ask to select).

---

## 2. Implementation Plan

1. Pass `selectedDocumentId` through App → HandshakeView → HandshakeWorkspace → StructuredHsContextPanel.
2. Add "Select for chat" button and selection state to document cards in StructuredHsContextPanel.
3. Always show "Open original" (disabled when vault locked).
4. In main.ts: before "please select" return, query attachments; auto-bind if exactly one; use context-aware messages.

---

## 3. Files Changed

| File | Changes |
|------|---------|
| `App.tsx` | Pass `selectedDocumentId` to HandshakeView |
| `HandshakeView.tsx` | Add `selectedDocumentId` prop; pass to HandshakeWorkspace |
| `HandshakeWorkspace.tsx` | Add `selectedDocumentId` prop; pass to StructuredHsContextPanel |
| `StructuredHsContextPanel.tsx` | Add `selectedDocumentId`, "Select for chat", selection state, always-visible "Open original" |
| `main.ts` | Auto-bind single attachment; context-aware no-selection messages |

---

## 4. Patch by File

### App.tsx
- Added `selectedDocumentId={selectedDocumentId}` to HandshakeView.

### HandshakeView.tsx
- Added `selectedDocumentId?: string | null` to props.
- Pass `selectedDocumentId` to HandshakeWorkspace.

### HandshakeWorkspace.tsx
- Added `selectedDocumentId?: string | null` to props.
- Pass `selectedDocumentId` to StructuredHsContextPanel.

### StructuredHsContextPanel.tsx
- Added `selectedDocumentId` prop.
- Document cards: "Select for chat" / "Selected for chat" button; selection highlight (border, checkmark).
- "Open original" always visible; disabled with tooltip when vault locked.
- `onOpenReader` still calls `onDocumentSelect(doc.id)` (selection on open).

### main.ts
- Before no-selection return: query `context_blocks` for documents with `extracted_text`.
- 0 docs → "I couldn't find an attachment in the current handshake context."
- 1 doc → auto-set `selectedDocId`, proceed to document path.
- 2+ docs → "Please select which attachment you want me to summarize."
- No handshake scope → "I couldn't find an attachment in the current handshake context."

---

## 5. Why Each Change Is Needed

| Change | Reason |
|--------|--------|
| Pass selectedDocumentId down | Selection state must reach the panel that renders documents. |
| "Select for chat" button | Users need an explicit way to choose which attachment the chat uses. |
| Selection visual state | Users must see which document is selected. |
| Always-visible "Open original" | Option exists even when vault is locked; disabled state explains why it can't be used. |
| Auto-bind single attachment | Avoid forcing selection when there is only one option. |
| Context-aware messages | Messages match the actual situation (none, one, many). |

---

## 6. Behavior After Fix

1. **One attachment, none selected:** "What is this attachment about?" → auto-uses the only attachment.
2. **Multiple attachments, none selected:** "What is this attachment about?" → "Please select which attachment you want me to summarize."
3. **Multiple attachments, one selected:** "Summarize the attachment briefly" → uses selected attachment.
4. **No attachment:** "What is this attachment about?" → "I couldn't find an attachment in the current handshake context."
5. **"Open original":** Shown on document cards; disabled with tooltip when vault is locked.
6. **Handshake change:** `selectedDocumentId` cleared in `onHandshakeScopeChange`.
7. **Broad question:** "What does the document say about refunds?" → normal RAG (no forced selection).

---

## 7. Manual Test Steps

1. **Single attachment auto-bind:** Handshake with one document, no selection → ask "What is this attachment about?" → expect summary.
2. **Multiple attachments:** Handshake with 2+ documents, none selected → ask "What is this attachment about?" → expect "Please select which attachment...".
3. **Selection:** Click "Select for chat" on a document → ask "Summarize the attachment briefly" → expect summary of that document.
4. **Open original:** Unlock vault → click "Open original" → expect download/open. Lock vault → button disabled with tooltip.
5. **No attachment:** Handshake with no documents → ask "What is this attachment about?" → expect "I couldn't find an attachment...".
6. **Handshake switch:** Select document, switch handshake → selection cleared.
7. **Broad question:** Ask "What does the document say about refunds?" (no selection) → expect RAG answer.

---

## 8. Remaining Limitations

- Documents must be in `context_blocks` with `extracted_text`; vault-only documents without sync are not supported.
- BlockCard (generic blocks) still shows "View original" only for `isOwnBlock`; StructuredHsContextPanel covers the main document flow.
- Auto-bind requires handshake scope; without it, the "no attachment" message is used.
