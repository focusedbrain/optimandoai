# BEAP Messaging UI — User-Visible Error Strings Audit

**Scope:** BeapInboxView, BeapInboxSidebar, BeapMessageDetailPanel, BeapBulkInbox, BeapReplyComposer, useReplyComposer, useBulkSend, BeapPackageBuilder, importPipeline, useBulkClassification, beapClassificationEngine, BeapMessageImportZone, ImportFileModal, RecipientHandshakeSelect, RejectedMessagePreview, useViewOriginalArtefact.

---

## Table of Error Strings

| # | Current Text | When User Sees It | Rewrite | File:Line |
|---|--------------|-------------------|---------|-----------|
| 1 | `Package verification failed` | Import rejected; message in Rejected list; import from file fails | **Message verification failed.** The file may be corrupted or from an untrusted source. | `importPipeline.ts` (532, 551, 580, 588, 651, 659); `depackagingPipeline.ts` (382); `beapDecrypt.ts` (multiple); `sandbox.ts` (183, 207) |
| 2 | `Package not found in ingress store.` | Rejected message detail (humanSummary) | **This message could not be found.** It may have been removed before verification. | `importPipeline.ts` (524) |
| 3 | `Raw package data not found in ingress store.` | Rejected message detail (humanSummary) | **Message data is missing.** The file may have been moved or deleted. | `importPipeline.ts` (543) |
| 4 | `Not for this recipient` | Import fails (Gate 1/2 — identity not verified) | **This message was not intended for you.** It may be addressed to someone else or from an unknown sender. | `depackagingPipeline.ts` (381) |
| 5 | `Package decryption failed` | Import fails (Gate 4 — decryption error) | **This message couldn't be decrypted.** The sender may need to resend it, or you may need to establish a handshake first. | `beapDecrypt.ts` (728, 737, 747, 768, 846, 870, 879, 891, 903, 991, 1019, 1088, 1106, 1172, 1394, 1416) |
| 6 | `Package decoding failed` | Import fails (decode/parse error) | **This message has an invalid format.** The file may be corrupted or from an older version. | `beapDecrypt.ts` (870, 879, 891, 903, 991, 1106, 1172) |
| 7 | `Verification failed` | Import from file fallback when nonDisclosingError is null | **Message verification failed.** Please try again or use a different file. | `importPipeline.ts` (472) |
| 8 | `Failed to read file` | Import from file catch (generic) | **Could not read the file.** Check that the file exists and you have permission to open it. | `importPipeline.ts` (477) |
| 9 | `BEAP™ qBEAP package sent to ${recipientLabel}` | Toast after email send success | **Message sent to** [recipient name or email] | `BeapPackageBuilder.ts` (1935) |
| 10 | `BEAP™ pBEAP package sent to ${recipientLabel}` | Toast after email send success | **Message sent to** [recipient name or email] | `BeapPackageBuilder.ts` (1935) |
| 11 | `BEAP™ ${encoding} package downloaded ${label}` | Toast after download | **Message saved as** [filename].beap | `BeapPackageBuilder.ts` (2035) |
| 12 | `BEAP™ package sent via P2P` | Toast after P2P send success | **Message sent** | `BeapPackageBuilder.ts` (2077) |
| 13 | `P2P delivery requires a handshake recipient` | P2P send fails (no recipient) | **Select a recipient** to send this message. | `BeapPackageBuilder.ts` (2060) |
| 14 | `Recipient has no P2P endpoint` | P2P send fails (no endpoint) | **The recipient cannot receive messages** over this channel. Try email or download instead. | `BeapPackageBuilder.ts` (2067) |
| 15 | `result?.error ?? 'P2P delivery failed'` | P2P send fails (generic) | **Message could not be sent.** Please try again or use a different delivery method. | `BeapPackageBuilder.ts` (2085) |
| 16 | `Email not available (${sendResult.error}) — downloading instead` | Email send fails, fallback to download | **Email is not set up.** Message saved as file instead. | `BeapPackageBuilder.ts` (1945) |
| 17 | `Email not available — downloading instead` | Email send fails (no error detail), fallback to download | **Email is not set up.** Message saved as file instead. | `BeapPackageBuilder.ts` (1946) |
| 18 | `Failed to copy to clipboard` | Messenger action fails | **Could not copy to clipboard.** Check that another app is not blocking access. | `BeapPackageBuilder.ts` (2005) |
| 19 | `buildResult.error \|\| 'Failed to build package'` | Package build fails in executeDeliveryAction | **Could not prepare message.** Check your recipient and try again. | `BeapPackageBuilder.ts` (2111) |
| 20 | `Unknown delivery method: ${config.deliveryMethod}` | Invalid delivery method | **Delivery method not supported.** Please choose Email, Download, or P2P. | `BeapPackageBuilder.ts` (2128) |
| 21 | `Invalid handshake — missing cryptographic key material.` | Build fails (handshake has no keys) | **This contact cannot receive private messages yet.** Complete the handshake or use Public mode. | `BeapPackageBuilder.ts` (942) |
| 22 | `Handshake missing ML-KEM-768 public key; cannot build qBEAP per canon...` | Build fails (handshake missing PQ key) | **This contact needs to update their WR Desk app** to receive private messages. | `BeapPackageBuilder.ts` (1057) |
| 23 | `CANON VIOLATION: qBEAP requires post-quantum cryptography...` | Build fails (PQ library not available) | **Encrypted messaging requires the WR Desk app to be running.** Switch to Public mode or start the app. | `BeapPackageBuilder.ts` (1066) |
| 24 | `SECURITY: encryptedMessage leaked into transport plaintext` | Build fails (internal security check) | **Something went wrong.** Please try again. | `BeapPackageBuilder.ts` (1010) |
| 25 | `Recipient mode must be selected (PRIVATE or PUBLIC)` | validatePackageConfig | **Choose Private or Public** before sending. | `BeapPackageBuilder.ts` (646) |
| 26 | `PRIVATE mode requires a verified handshake recipient` | validatePackageConfig | **Select a contact** to send a private message. | `BeapPackageBuilder.ts` (651) |
| 27 | `Sender fingerprint is required` | validatePackageConfig | **Your identity is not set up.** Complete setup in Settings. | `BeapPackageBuilder.ts` (656) |
| 28 | `BEAP package build failed.` | useReplyComposer send fails | **Could not prepare message.** Please try again. | `useReplyComposer.ts` (381) |
| 29 | `Email package build failed.` | useReplyComposer send fails | **Could not prepare email.** Please try again. | `useReplyComposer.ts` (414) |
| 30 | `Email send failed.` | useReplyComposer send fails | **Could not send email.** Check your connection and try again. | `useReplyComposer.ts` (419) |
| 31 | `No AI provider configured. Enable an AI provider to use this feature.` | User clicks "Draft with AI" without provider | **AI features are being set up.** Try again in a moment or enable an AI provider in Settings. | `useReplyComposer.ts` (447) |
| 32 | `BEAP build failed.` | useBulkSend single item fails | **Could not prepare message.** Please try again. | `useBulkSend.ts` (144) |
| 33 | `Email build failed.` | useBulkSend single item fails | **Could not prepare email.** Please try again. | `useBulkSend.ts` (164) |
| 34 | `Email delivery failed.` | useBulkSend single item fails | **Could not send email.** Check your connection and try again. | `useBulkSend.ts` (169) |
| 35 | `Send failed` | BeapBulkInbox badge on message | **Could not send** | `BeapBulkInbox.tsx` (714) |
| 36 | `Retry Failed` | BeapBulkInbox button | **Retry failed** | `BeapBulkInbox.tsx` (471) |
| 37 | `No messages to process` | BeapBulkInbox empty state | **No messages to process.** Import BEAP packages to start. | `BeapBulkInbox.tsx` (1382) |
| 38 | `Import BEAP™ packages to start batch processing` | BeapBulkInbox empty subtitle | **Import .beap files** or drag them here to get started. | `BeapBulkInbox.tsx` (1386) |
| 39 | `Gate error for message from ${message.senderEmail}.` | Classification gate throws (summary) | **This message could not be processed.** It was blocked for security reasons. | `beapClassificationEngine.ts` (569) |
| 40 | `Message from ${message.senderEmail} — processing blocked by gate.` | Classification gate BLOCKED (summary) | **This message was blocked.** It does not meet your processing policy. | `beapClassificationEngine.ts` (585) |
| 41 | `Provider error: ${err}; using heuristic fallback.` | Classification AI provider fails (reasoning — may surface to UI) | Internal; do not show. Use: **Classified using basic rules.** | `beapClassificationEngine.ts` (662) |
| 42 | `Only .beap and .json files are accepted.` | BeapMessageImportZone wrong file type | **Please use a .beap or .json file.** | `BeapMessageImportZone.tsx` (50) |
| 43 | `File too large (${size}KB). Maximum is 512KB.` | BeapMessageImportZone file too big | **File is too large.** Maximum size is 512 KB. | `BeapMessageImportZone.tsx` (56) |
| 44 | `File does not contain valid JSON.` | BeapMessageImportZone invalid JSON | **This file is not a valid message.** It may be corrupted. | `BeapMessageImportZone.tsx` (65) |
| 45 | `BEAP import is not available. Please ensure the app is fully loaded.` | BeapMessageImportZone no import fn | **Import is not ready.** Wait for the app to finish loading, then try again. | `BeapMessageImportZone.tsx` (75) |
| 46 | `✗ Import failed: ${result?.error ?? 'Unknown error'}` | BeapMessageImportZone import fails | **Import failed.** [If technical: "Please try again."] | `BeapMessageImportZone.tsx` (86) |
| 47 | `✗ Import failed: ${err?.message ?? 'Unknown error'}` | BeapMessageImportZone catch | **Import failed.** [Sanitize technical errors.] | `BeapMessageImportZone.tsx` (90) |
| 48 | `✓ Message imported` | BeapMessageImportZone success | **Message added to inbox** | `BeapMessageImportZone.tsx` (82) |
| 49 | `File imported and verified. Message is in your inbox.` | ImportFileModal success | **Message added to your inbox** | `ImportFileModal.tsx` (226) |
| 50 | `Initiate a handshake with a recipient to send private BEAP messages.` | RecipientHandshakeSelect empty | **Start a handshake** with a contact to send private messages. | `RecipientHandshakeSelect.tsx` (121) |
| 51 | `Message data not available.` | useViewOriginalArtefact — no package | **This message is no longer available.** | `useViewOriginalArtefact.ts` (53) |
| 52 | `Original file not available (pBEAP packages may not include encrypted originals).` | useViewOriginalArtefact — no artefact | **The original file is not included** in this message. | `useViewOriginalArtefact.ts` (58) |
| 53 | `Original file data not available.` | useViewOriginalArtefact — no base64 | **The file could not be retrieved.** | `useViewOriginalArtefact.ts` (62) |
| 54 | `Download failed.` | useViewOriginalArtefact catch | **Could not download the file.** Please try again. | `useViewOriginalArtefact.ts` (74) |
| 55 | `Envelope Missing` | RejectedMessagePreview label | **Message format invalid** | `RejectedMessagePreview.tsx` (24) |
| 56 | `Hash Missing` | RejectedMessagePreview label | **Verification data missing** | `RejectedMessagePreview.tsx` (25) |
| 57 | `Hash Invalid` | RejectedMessagePreview label | **Verification failed** | `RejectedMessagePreview.tsx` (26) |
| 58 | `Signature Invalid` | RejectedMessagePreview label | **Sender not verified** | `RejectedMessagePreview.tsx` (28) |
| 59 | `Signature Missing` | RejectedMessagePreview label | **Signature missing** | `RejectedMessagePreview.tsx` (29) |
| 60 | `Ingress Missing` | RejectedMessagePreview label | **Source not declared** | `RejectedMessagePreview.tsx` (30) |
| 61 | `Egress Missing` | RejectedMessagePreview label | **Destination not declared** | `RejectedMessagePreview.tsx` (31) |
| 62 | `Provider Not Configured` | RejectedMessagePreview label | **Email not connected** | `RejectedMessagePreview.tsx` (31) |
| 63 | `Egress Not Allowed` | RejectedMessagePreview label | **Destination not allowed** | `RejectedMessagePreview.tsx` (32) |
| 64 | `Ingress Not Allowed` | RejectedMessagePreview label | **Source not allowed** | `RejectedMessagePreview.tsx` (33) |
| 65 | `Envelope Expired` | RejectedMessagePreview label | **Message expired** | `RejectedMessagePreview.tsx` (34) |
| 66 | `Handshake Not Found` | RejectedMessagePreview label | **Contact not found** | `RejectedMessagePreview.tsx` (35) |
| 67 | `Evaluation Error` | RejectedMessagePreview label | **Verification error** | `RejectedMessagePreview.tsx` (36) |
| 68 | `Envelope Verification` | RejectedMessagePreview failed step | **Step 1: Format check** | `RejectedMessagePreview.tsx` (47) |
| 69 | `Boundary Check` | RejectedMessagePreview failed step | **Step 2: Security check** | `RejectedMessagePreview.tsx` (48) |
| 70 | `WRGuard Intersection` | RejectedMessagePreview failed step | **Step 3: Policy check** | `RejectedMessagePreview.tsx` (49) |
| 71 | `Unknown Step` | RejectedMessagePreview fallback | **Unknown** | `RejectedMessagePreview.tsx` (50) |
| 72 | `No reason provided` | RejectedMessagePreview fallback | **No details available** | `RejectedMessagePreview.tsx` (192) |

---

## Notes

1. **nonDisclosingError vs internal error:** The depackaging pipeline intentionally uses generic `nonDisclosingError` values ("Not for this recipient", "Package verification failed", "Package decryption failed", "Package decoding failed") for user display. Internal errors (e.g. `GATE4: senderX25519PublicKey required...`) must never reach the UI — they are for logs only.

2. **STRUCTURAL_INTEGRITY_FAILURE:** Comes from `packages/ingestion-core/validator.ts`. If it ever surfaces to the BEAP UI, map to: **"This message has an invalid format and was rejected."**

3. **Toast/notification consistency:** Prefer simple, outcome-focused messages: "Message sent to oscar@example.com" over "BEAP™ qBEAP package sent to...".

4. **Import success:** "Message added to your inbox" is clearer than "File imported and verified. Message is in your inbox." — both are acceptable; the shorter one is friendlier.

5. **Technical error sanitization:** Any raw `err.message`, stack trace, or JSON must be logged only. Show: "Something went wrong. Please try again." (or context-specific variant).
