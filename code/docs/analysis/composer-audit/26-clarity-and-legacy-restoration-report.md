# Phase 26 — Clarity and legacy restoration (BEAP / Email composers)

## Summary

Targeted pass on the Electron inline **BEAP™ Composer** and **Email Composer**: high-contrast drafting surfaces, a solid readable AI context rail, correct **active handshake** listing for `RecipientHandshakeSelect`, visible **AI refinement** targets on field labels, a shared **premium attachment** control, and **package attachment** text preview via the legacy **`BeapDocumentReaderModal`** (same HTTP PDF extract path as AI context ingest).

## Changed files

| Area | File |
|------|------|
| Handshake IPC mapping | `apps/electron-vite-project/src/shims/handshakeRpc.ts` |
| Package text preview | `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts` (new) |
| Shared UI | `apps/electron-vite-project/src/components/ComposerAttachmentButton.tsx` (new) |
| Shared UI | `apps/electron-vite-project/src/components/DraftRefineLabel.tsx` (new) |
| AI context rail | `apps/electron-vite-project/src/components/AiDraftContextRail.tsx` |
| BEAP composer | `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` |
| Email composer | `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` |

## Handshake selector — root cause and fix

**Root cause:** `window.handshakeView.listHandshakes` returns **main-process ledger** handshake rows (`deserializeHandshakeRecord`): nested `initiator` / `acceptor`, and snake_case key material (`peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64`). **`RecipientHandshakeSelect`** (and `hasHandshakeKeyMaterial`) expect the **extension RPC** `HandshakeRecord`: flat `counterparty_email`, `peerX25519PublicKey`, `peerPQPublicKey`, `state === 'ACTIVE'`, etc. Unmapped rows therefore failed display, filtering, and key checks.

**Fix:** `listHandshakes` in `handshakeRpc.ts` now maps each IPC row through **`mapLedgerHandshakeToRpc`**, deriving counterparty email / user id from `local_role` and initiator/acceptor (with `receiver_email` fallback for initiator-before-accept), and mapping peer keys to camelCase. Rows that already look RPC-shaped (have `counterparty_email` and no `initiator`) pass through unchanged.

**Unchanged:** `replyToHandshakeId` preselection, `executeDeliveryAction` / `SelectedHandshakeRecipient` mapping, and send validation.

## Right rail — blur / overlay root cause and fix

**Root cause:** `AiDraftContextRail` and composer `<aside>` blocks used **semi-transparent** backgrounds (`rgba(15,23,42,0.35–0.45)`), low-contrast borders, and muted text on dark panels, which read as **washed out / disabled**.

**Fix:** Rail content uses **opaque** surfaces (`#f8fafc` aside, `#ffffff` cards / list rows where applicable), **solid** borders (`#e2e8f0` / `#cbd5e1`), and **dark** copy (`#0f172a` / `#475569` hints). Removed translucent purple/gray panel fills for the empty state and document list. No `backdrop-filter` was present; the issue was opacity and low contrast.

## What was restored from the legacy capsule builder

- Reused **`BeapDocumentReaderModal`** from `@ext/beap-builder/components/BeapDocumentReaderModal` for **read-only inspection** of extracted text (standard/light theme).
- **PDF / text** extraction for package attachments reuses the same **local HTTP** PDF route and text decoding approach as **`ingestAiContextFiles`** (`51248` `/api/parser/pdf/extract`), without changing the global parser service architecture.

## How parser / text-reader behavior works now (BEAP package attachments)

1. User picks files via the existing dialog (`showOpenDialogForAttachments`).
2. Each file is read with `readFileForAttachment` (base64 + mime).
3. **`extractTextForPackagePreview`** runs: PDF → POST to local parser; `.txt` / `.md` / `.csv` / `.json` / `text/*` → UTF-8 decode from base64; other types → explicit “no preview” message (not silent).
4. If any file yields text, **`BeapDocumentReaderModal`** opens automatically for the **first** successful extract; each row with preview text gets a **View text** button to reopen the modal.
5. Rows with only an error show an **amber** inline message so parsing is never silently dropped.

**Separation:** AI context documents remain in **`useAiDraftContextStore`** / `ingestAiContextFiles`. Package attachments remain only on the send path and this preview state — **not** merged into AI context.

## Deferred / out of scope for this pass

- Broad refactor of parser infrastructure, vision/OCR fallbacks, or non-PDF office formats in the inline composer.
- Email composer: **attachment text reader** modal (same UX could be added later with `File` + the same extract helper).
- Changing **RecipientHandshakeSelect** `theme` to `standard` (left column is still dark; handshake block remains `theme="dark"` for consistency with existing styling).

## Manual QA checklist

- [ ] **Right rail:** AI drafting context rail is sharp, readable, not greyed or “disabled”; hints text is legible on `#f8fafc`.
- [ ] **BEAP:** Subject, public message, encrypted message, session select, and delivery-related selects use **white** fields with dark text and visible focus.
- [ ] **Email:** To, subject, body, and account select match the same drafting-surface pattern.
- [ ] **Refine:** Connect refine for BEAP public / encrypted and email body — **sparkle** icon appears on the correct label; disconnect removes it.
- [ ] **Handshakes:** With at least one **ACTIVE** handshake with keys, the selector lists it with correct counterparty email; `replyToHandshakeId` preselects when applicable.
- [ ] **Attachments:** “Add attachments” buttons look premium and still add/remove files as before.
- [ ] **Reader:** Add a **PDF** (and a **.txt**) to BEAP package attachments — modal opens with text (parser up), or inline error if extract fails; **View text** works per row.
- [ ] **Send:** BEAP and email sends still succeed with prior validation rules (empty public message, missing handshake in private mode, etc.).
