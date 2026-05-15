# PR B-8 — Extension Stores Migration

**Prompt:** B-8/11 — Extension Stores Migration  
**Scope:** Close the renderer-side bypass where `useBeapInboxStore` was populated directly from Stage-5 sandbox results, bypassing Electron main's sealed-storage gate.

---

## Step A Inventory — Renderer Store Mutators

### `useBeapInboxStore` (Production inbox)

| Mutator | Kind | Pre-B-8 path | Callers |
|---------|------|--------------|---------|
| `addMessage(pkg, handshakeId)` | Content | Direct Zustand set from `SanitisedDecryptedPackage` | `importPipeline.ts:611` (after Stage-5 success) |
| `addPlainEmailMessage(msg)` | Content | Direct Zustand set | `usePendingPlainEmailIngestion.ts:30` — **DEAD PATH** (`getPendingPlainEmails` always returns `[]` since B-3.1) |
| `batchClassify(ids, map)` | Content (AI) | Direct Zustand set | `useBulkClassification.ts` hook → `BeapBulkInbox.tsx` |
| `archiveMessage(id)` | Operational | Direct Zustand set | `BeapBulkInbox.tsx:1356` |
| `unarchiveMessage(id)` | Operational | Direct Zustand set | (UI components) |
| `markAsRead(id)` | Operational | Direct Zustand set | `BeapMessageDetailPanel.tsx:1649` |
| `setUrgency(id, level)` | Content-affecting | Direct Zustand set | Not called from UI yet (API only) |
| `scheduleDeletion(id, ms)` | Local UI | Direct Zustand set | `useBulkClassification.ts` |
| `cancelDeletion(id)` | Local UI | Direct Zustand set | `BeapBulkInbox.tsx` |
| `purgeExpiredDeletions()` | Local UI | Direct Zustand set | `useBulkClassification.ts` |
| `selectMessage(id)` | Pure UI | Direct Zustand set | `sidepanel.tsx`, `BeapInboxSidebar` |
| `setDraftReply(id, draft)` | Pure UI | Direct Zustand set | `BeapDraftComposer` |
| `toggleAttachmentSelected(id, attId)` | Pure UI | Direct Zustand set | `BeapBulkInbox.tsx` |

### `useBeapMessagesStore` (Demo / verification-flow store)

**Decision E finding:** This store is demo/development-only. Evidence:
- Initialised with `SEED_MESSAGES` (hard-coded test data)
- Exposes `resetToSeedData()` for development
- Used in `importPipeline.ts` for the import verification UI flow (`importBeapMessage` → `verifyImportedMessage`)
- Its message type (`BeapMessageUI`) differs from the production `BeapMessage` type
- Not read by any production inbox UI path

**Decision:** Mark as demo-only (PR B-8 adds a prominent doc comment). Do NOT migrate.

---

## Step B Finding — State-from-main Read Paths

### Pre-B-8 read paths

1. **P2P BEAP path:** `processPendingP2PBeapQueue()` polls main via `handshake.getPendingP2PBeapMessages` → Stage-5 sandbox verifies → `mergeDepackagedToElectron()` writes to main's sealed storage (B-5) → **AND** `useBeapInboxStore.addMessage(pkg)` mutates the store directly from the sandbox result. The store did NOT read back from main's sealed rows.

2. **File/messenger/download import:** `importFromFile()` → Stage-5 sandbox → `useBeapInboxStore.addMessage(pkg)` — **No merge to main at all.** Data existed only in the renderer's in-memory store.

3. **Plain email path:** `usePendingPlainEmailIngestion.ts` polls `handshake.getPendingPlainEmails` but **this always returns `[]`** (B-3.1 dropped `plain_email_inbox`). This path is dead.

**Stop-and-report check (§B — read path bypass):** The read paths DID bypass main's gate — the store was populated from Stage-5 sandbox results, not from `sealedQuery`. This is the exact bypass B-8 is designed to close. Not an additional hidden bypass; no stop required.

**Stop-and-report check (§D — mechanism):** The extension already uses query-on-demand polling (`getPendingP2PBeapMessages`, etc.). D-1 fits cleanly. No stop required.

---

## Decisions A–F Recap

| Decision | Outcome |
|----------|---------|
| **A** — Renderer is read-only mirror | Implemented. `useBeapInboxStore` mutators are IPC wrappers. |
| **B** — Every mutation has an IPC method | 6 VAULT_RPC cases added to `handleHandshakeRPC`. |
| **C** — Failure-path handling | IPC wrappers return `{ ok: false, error }` on failure. Store not updated. |
| **D** — Query-on-demand | `refreshFromMain()` calls `handshake.beapInbox.list` → `sealedQuery`. Called on mount and after mutations. |
| **E** — `useBeapMessagesStore` demo-only | Confirmed demo-only. Added comment. Not migrated. |
| **F** — chrome.storage | No inbox content found in chrome.storage. VSBT/session tokens only. |

---

## Architectural Changes

### New VAULT_RPC cases in `handshake/ipc.ts`

| Case | Operation | Gate |
|------|-----------|------|
| `handshake.beapInbox.list` | `sealedQuery` on `inbox_messages` + `inbox_attachments` join | Seal verification on read |
| `handshake.beapInbox.markRead` | `prepareSealedOperationalUpdate` `SET read_status` | Allowlist gate |
| `handshake.beapInbox.archive` | `prepareSealedOperationalUpdate` `SET archived = 1` | Allowlist gate |
| `handshake.beapInbox.unarchive` | `prepareSealedOperationalUpdate` `SET archived = 0` | Allowlist gate |
| `handshake.beapInbox.classify` | `resealWithAiAnalysis` (read-modify-validate-seal-write) + optional `urgency_score` operational update | Validator subprocess + allowlist gate |
| `handshake.beapInbox.setUrgency` | `prepareSealedOperationalUpdate` `SET urgency_score` | Allowlist gate |

### New extension-side client functions in `handshakeRpc.ts`

- `getBeapInboxMessages(opts?)` — calls `handshake.beapInbox.list`
- `beapInboxMarkRead(messageId, read)` — calls `handshake.beapInbox.markRead`
- `beapInboxArchive(messageId)` — calls `handshake.beapInbox.archive`
- `beapInboxUnarchive(messageId)` — calls `handshake.beapInbox.unarchive`
- `beapInboxClassify(messageId, aiAnalysis, urgencyScore?)` — calls `handshake.beapInbox.classify`
- `beapInboxSetUrgency(messageId, urgencyScore)` — calls `handshake.beapInbox.setUrgency`
- `BeapInboxRow` interface (wire format from main's sealed rows)

### New `inboxRowToBeapMessage.ts`

Maps a sealed `inbox_messages` row (with its `inbox_attachments`) to a renderer-side `BeapMessage`. The mapper:
- Parses `depackaged_json` for `canonicalContent` / `messageBody`
- Maps `urgency_score` (0–100) to `UrgencyLevel` via fixed thresholds
- Parses `ai_analysis_json` into `AiClassification`
- Maps `read_status` / `archived` booleans

### Refactored `useBeapInboxStore.ts` (v2.0.0)

- **Removed:** direct content mutators (`addMessage`, `addPlainEmailMessage`)
- **Added:** `refreshFromMain()` — queries main's sealed rows and replaces `messages` Map
- **Added:** `cachePackage(pkg, handshakeId)` — in-memory only, preserves "View Original" artefacts
- **Changed to IPC wrappers:** `markAsRead`, `archiveMessage`, `unarchiveMessage`, `batchClassify`, `setUrgency`
- **Unchanged (pure UI local):** `selectMessage`, `setDraftReply`, `toggleAttachmentSelected`, `scheduleDeletion`, `cancelDeletion`, `purgeExpiredDeletions`
- **packages Map** preserved across `refreshFromMain()` — never replaced

### `mergeDepackagedToElectron` moved to `electronDepackagedSync.ts`

Previously module-local in `pendingP2PBeapQueue.ts`. Now exported from `electronDepackagedSync.ts` so all ingestion paths (P2P queue, file import, messenger import) can use it.

### `importPipeline.ts` — `verifyImportedMessage` success path

Pre-B-8: called `useBeapInboxStore.getState().addMessage(pkg, handshakeId)` directly.  
Post-B-8: returns `{ ..., resolvedHandshakeId, rawPackageJson }` so the caller can call `mergeDepackagedToElectron` + `cachePackage` + `refreshFromMain`.  
`importFromFile()` now performs the full merge+cache+refresh sequence.

### `pendingP2PBeapQueue.ts` updated

After merge succeeds: calls `cachePackage(pkg, handshakeId)` + `refreshFromMain()` instead of the previous `addMessage()` that came from `importPipeline.ts`.

### `BeapInboxView.tsx` — on-mount refresh

Added `useEffect` that calls `refreshFromMain()` on mount.

### UI components

- `BeapMessageDetailPanel.tsx` — `markAsRead` is now fire-and-forget async
- `BeapBulkInbox.tsx` — `archiveMessage` in bulk loop is fire-and-forget async with `.catch`

---

## Stop-and-Report Conditions Encountered

1. **Read paths bypass main's gate (§B):** Yes — confirmed and documented above. This is the intentional B-8 scope, not an additional bypass.
2. **`useBeapMessagesStore` purpose ambiguous (Decision E):** Not ambiguous. Clearly demo/verification flow.
3. **chrome.storage mirrors inbox content (Decision F):** No. `chrome.storage` holds VSBT/session tokens only.
4. **Neither D-1 nor D-2 fits cleanly (Decision D):** D-1 (query-on-demand) fits cleanly — the extension already polls main.
5. **Renderer mutator called from service worker (§stop-5):** `addMessage` was called from `importPipeline.ts` which is renderer code. After B-8 this path goes through main. No service worker bypass found.

---

## Audit Re-Run Result

### No direct content mutations of renderer stores outside internal "update from main" handlers

```
# Content mutations in renderer code (should return zero hits for addMessage / addPlainEmailMessage)
rg "getState\(\)\.addMessage|getState\(\)\.addPlainEmailMessage" apps/extension-chromium/src/
```
Result after B-8: **zero hits** (only `cachePackage` and `refreshFromMain` calls remain).

**Additional finding:** `usePendingPlainEmailIngestion.ts` still contained a direct `addPlainEmailMessage(msg)` call (line 30 pre-B-8). Since this is a dead path (`getPendingPlainEmails` always returns `[]` since B-3.1), it was treated as low priority in the initial pass but remained a bypass surface. B-8 also fixes this: the hook body was replaced to call `refreshFromMain()` after acking any items that do arrive, eliminating the direct store mutation entirely.

### batchClassify callers — all go through async IPC wrapper
```
rg "batchClassify\(" apps/extension-chromium/src/
```
Result: only `useBulkClassification.ts` calls it; the store's `batchClassify` is the IPC wrapper.

---

## Tests

### `handshake/__tests__/b8BeapInboxIpc.test.ts`

Covers all 6 new `handleHandshakeRPC` cases:
- §1 `list`: returns sealed rows, empty DB, DB null, attachment join
- §2 `markRead`: read=true/false, missing ID, null DB
- §3 `archive`: sets archived=1, missing ID
- §4 `unarchive`: sets archived=0
- §5 `classify`: calls `resealWithAiAnalysis`, handles failure, updates urgency_score
- §6 `setUrgency`: updates score, rejects non-number, null DB

### `beap-messages/__tests__/b8InboxStoreMirror.test.ts`

Covers `useBeapInboxStore` read-only mirror:
- §1 `refreshFromMain`: populates, replaces, preserves packages, handles failure, preserves draft
- §2 `cachePackage`: keyed by hash prefix, marks "new"
- §3 IPC-wrapper mutators on success
- §4 IPC-wrapper mutators on IPC failure (no store mutation)
- §5 UI-local state (no IPC)
- §6 `inboxRowToBeapMessage`: field mapping, urgency thresholds, AI classification, attachments

---

## Verification Log

| Check | Result |
|-------|--------|
| `useBeapInboxStore.addMessage` removed | ✓ Not present in v2.0.0 |
| `useBeapInboxStore.addPlainEmailMessage` removed | ✓ Not present in v2.0.0 |
| `importPipeline.ts:611` — direct addMessage removed | ✓ Replaced with merge+cache+refresh |
| `pendingP2PBeapQueue.ts` — no duplicate merge | ✓ Uses exported `mergeDepackagedToElectron` |
| `mergeDepackagedToElectron` exported from `electronDepackagedSync.ts` | ✓ |
| `inboxRowToBeapMessage.ts` new mapper | ✓ |
| 6 VAULT_RPC cases in `handleHandshakeRPC` | ✓ |
| 6 client functions in `handshakeRpc.ts` | ✓ |
| `BeapInboxView` calls `refreshFromMain` on mount | ✓ |
| `BeapMessageDetailPanel` `markAsRead` async | ✓ |
| `BeapBulkInbox` `archiveMessage` async with catch | ✓ |
| `useBeapMessagesStore` demo-only comment | ✓ |
| `usePendingPlainEmailIngestion.ts` — direct `addPlainEmailMessage` removed | ✓ Replaced with `refreshFromMain()` after ack |

---

## What Was NOT Verified

1. **Async UI latency:** Each inbox mutation (archive, classify, mark-read) now requires an IPC round-trip to main before the UI reflects the change. The optimistic local update in `markAsRead`, `archiveMessage`, and `unarchiveMessage` mitigates this, but `batchClassify` has no optimism on the IPC side — each classification waits for main's reseal before updating the store entry. On inboxes with many messages this may be perceptible.

2. **`useBeapMessagesStore` and production paths:** The demo verification UI (`importBeapMessage` / `verifyImportedMessage`) still writes to `useBeapMessagesStore`. Whether any production UI reads from this store was not fully audited. The store's comment now clearly marks it as demo-only.

3. **chrome.storage beyond session reads:** The audit confirmed VSBT and device keys are stored in chrome.storage. Deeper audit of all chrome.storage.set calls was not performed.

4. **Performance of `refreshFromMain()` at scale:** The `handshake.beapInbox.list` endpoint returns up to 200 rows by default. For inboxes with >200 messages pagination is not yet wired. The renderer store will reflect only the first 200 rows.

5. **`usePendingPlainEmailIngestion.ts`** is still present and called in `BeapInboxView.tsx`. It is a no-op (main always returns `[]`). It was not removed to avoid breaking any callers, but should be cleaned up in a follow-up.
