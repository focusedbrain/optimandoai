# BEAP Ingestion Path Trace — MVP Entry Points

**Date:** 2025-03-15  
**Goal:** Trace every ingestion path, mark ✅/⚠️/❌, list exact files and functions.

---

## PATH A — .beap File Import (Drag-and-Drop / File Picker)

### 1. Where is the file drop zone?

| Location | File | Component |
|----------|------|-----------|
| **Electron app** | `apps/electron-vite-project/src/components/BeapMessageImportZone.tsx` | `BeapMessageImportZone` — dashed border, "Drop .beap message here", or browse |
| **Extension** | `apps/extension-chromium/src/ui/components/CommandChatView.tsx` | File input via `handleBeapFileChange` |
| **Extension** | `apps/extension-chromium/src/ingress/components/ImportFileModal.tsx` | `ImportFileModal` — file picker |

### 2. What happens when a .beap file is dropped?

#### Path A1 — Electron (BeapMessageImportZone)

| Step | Function | File |
|------|----------|------|
| 1 | User drops/selects file | `BeapMessageImportZone.tsx` |
| 2 | `processFile(file)` → `file.text()` | `BeapMessageImportZone.tsx:60` |
| 3 | `window.handshakeView.importBeapMessage(text)` | `BeapMessageImportZone.tsx:79` |
| 4 | IPC `handshake:importBeapMessage` | `main.ts:2337` |
| 5 | `insertPendingP2PBeap(db, '__file_import__', packageJson)` | `main.ts:2344`, `db.ts` |
| 6 | Row inserted into `p2p_pending_beap` | SQLite |
| 7 | `usePendingP2PBeapIngestion` polls (5s) | `usePendingP2PBeapIngestion.ts` |
| 8 | `getPendingP2PBeapMessages()` → shim → IPC | `shims/handshakeRpc.ts:108`, `preload.ts:230` |
| 9 | `importBeapMessage(item.package_json, 'p2p')` | `importPipeline.ts:197` |
| 10 | `verifyImportedMessage(messageId, { handshakeId })` | `importPipeline.ts:477` |
| 11 | `sandboxDepackage(payload.rawData, options)` | `sandbox.ts` via `importPipeline.ts:532` |
| 12 | On success: `useBeapInboxStore.addMessage(pkg, handshakeId)` | `importPipeline.ts:570` |
| 13 | `ackPendingP2PBeap(item.id)` | `usePendingP2PBeapIngestion.ts:37` |

**Does verifyImportedMessage call the sandbox?** Yes — `sandboxDepackage()` at `importPipeline.ts:532`.

**Does addMessage get called?** Yes — when `pkg.allGatesPassed && pkg.authorizedProcessing?.decision === 'AUTHORIZED'`.

**Does the message appear in the inbox UI?** Yes — `useBeapInboxStore.getInboxMessages()` is used by `BeapInboxDashboard`.

#### Path A2 — Extension (CommandChatView / ImportFileModal)

| Step | Function | File |
|------|----------|------|
| 1 | User selects file | `CommandChatView.tsx:141` or `ImportFileModal.tsx:98` |
| 2 | `importFromFile(file)` | `importPipeline.ts:431` |
| 3 | `file.text()` → `importBeapMessage(rawData, 'download')` | `importPipeline.ts:435-437` |
| 4 | Message stored in ingress + BeapMessagesStore | `importPipeline.ts:224-292` |
| 5 | **No automatic verify** — user must trigger `verifyImportedMessage` | `useVerifyMessage.ts` or manual |

**Gap:** Extension file import does NOT auto-verify. Message appears as "pending verification" until user verifies.

### 3. TEST: Trace .beap file from drop → read → sandbox → depackage → store → UI render

**Electron path (A1):** ✅ End-to-end wired.
- Drop → `BeapMessageImportZone` → IPC → `p2p_pending_beap` → `usePendingP2PBeapIngestion` → `importBeapMessage` → `verifyImportedMessage` → `sandboxDepackage` → `addMessage` → inbox UI.

**Extension path (A2):** ⚠️ Partial — import works, verification is manual.

### 4. IDENTIFY: Every point where the chain breaks

| Path | Break Point | Severity |
|------|-------------|----------|
| A1 (Electron) | None identified — chain is complete | — |
| A2 (Extension) | No auto-verify after `importFromFile`; message stays "pending verification" | ⚠️ UX gap |

---

## PATH B — Email Fetch → Depackage (Connected Email Account)

### 1. Where is the email polling / fetch logic?

| File | Function |
|------|----------|
| `apps/electron-vite-project/electron/main/email/beapSync.ts` | `runBeapSyncCycle`, `startBeapEmailSync` |
| Poll interval | `DEFAULT_POLL_INTERVAL_MS = 30_000` (30s) |

### 2. How are emails with .beap attachments detected?

| Function | File | Logic |
|----------|------|------|
| `detectBeapInSubject(subject)` | `beapSync.ts:106` | `subject.includes('BEAP Handshake:')` |
| `isBeapAttachment(att)` | `beapSync.ts:113` | `att.filename?.toLowerCase().endsWith('.beap')` or `att.mimeType === 'application/vnd.beap+json'` |
| `detectBeapInBody(bodyText)` | `beapSync.ts:77` | JSON with `schema_version` + `capsule_type` in `['initiate','accept','refresh','revoke']` |

### 3. Is there automatic extraction of .beap from email attachments?

Yes — `processEmailForBeap` (Strategy 2) iterates attachments, calls `_emailExtractAttachmentTextFn`, then `detectBeapInBody(extracted.text)`.

**Gap:** `detectBeapInBody` only matches **handshake capsules** (`capsule_type` in initiate/accept/refresh/revoke). It does NOT match **qBEAP/pBEAP message packages** (which have `header` + `metadata` + `envelope`, no `capsule_type`).

### 4. Does extracted .beap go through the same pipeline as Path A?

For handshake capsules: Yes — `handleIngestionRPC('ingestion.ingest', {...})` → `processIncomingInput` → ingestion-core.

For .beap attachments that are **message packages** (qBEAP/pBEAP): **No** — `detectBeapInBody` returns `{ detected: false }` because they lack `capsule_type`. They are skipped.

### 5. Plain email to BEAP (Canon §6 — "Handling of Unstamped Emails")

| Question | Answer |
|----------|--------|
| Is there `plainEmailToBeapConverter` or equivalent? | ❌ **Not found** |
| Canon §6 local capsule-conversion for unstamped emails | ❌ Not implemented |
| "Depackaged / no-handshake" messages with ✉️ icon | ⚠️ May exist in UI types (`depackaged` trust level) but no converter creates them from plain email |

### 6. CURRENT STATE

| Item | Status |
|------|--------|
| OAuth email connection | ✅ Works (Outlook connected) |
| Email fetch → depackage for **handshake capsules** | ✅ Works |
| Email fetch → depackage for **qBEAP/pBEAP message packages** | ❌ **Broken** — `detectBeapInBody` does not detect them |
| Plain email → BEAP conversion | ❌ Not implemented |

---

## PATH C — P2P Delivery (Direct Orchestrator-to-Orchestrator)

### 1. p2pServer.ts — Does it accept incoming BEAP capsules?

Yes. `POST /beap/ingest` handler in `apps/electron-vite-project/electron/main/p2p/p2pServer.ts`.

### 2. When a capsule arrives via P2P, does it enter the ingestion pipeline?

| Capsule Type | Path |
|--------------|------|
| **Handshake** (has `capsule_type`) | `processIncomingInput(rawInput, 'p2p', ...)` → ingestion-core → handshake pipeline |
| **BEAP message package** (has `header` + `metadata`, no `capsule_type`) | `isBeapMessagePackage(parsed)` → `insertPendingP2PBeap(db, handshakeId, body)` → `p2p_pending_beap` |

### 3. Is there a p2p_pending_beap table or equivalent staging area?

Yes — `p2p_pending_beap` table. Functions: `insertPendingP2PBeap`, `getPendingP2PBeapMessages`, `markP2PPendingBeapProcessed` (ack).

### 4. Does P2P ingestion flow through the same validator as .beap import?

| Path | Validator |
|------|-----------|
| Handshake capsules | `processIncomingInput` → `ingestInput` + `validateCapsule` (ingestion-core) |
| BEAP message packages | Bypass ingestion-core; go to `p2p_pending_beap` → `usePendingP2PBeapIngestion` → `importBeapMessage` + `verifyImportedMessage` → sandbox depackaging |

Message packages use the **extension depackaging pipeline** (sandbox), not ingestion-core. Ingestion-core expects `capsule_type`; message packages use `header`/`metadata`/`envelope`.

### 5. KNOWN STATE

| Item | Status |
|------|--------|
| `isBeapMessagePackage` | ✅ Implemented (`p2pServer.ts:67`) |
| `insertPendingP2PBeap` | ✅ Implemented |
| `usePendingP2PBeapIngestion` | ✅ Implemented |
| `executeP2PAction` | ✅ Implemented (`BeapPackageBuilder.ts`, `handshakeRpc.ts`) |
| `sendBeapViaP2P` | ✅ Implemented (`handshakeRpc.ts:257`) |

---

## PATH D — Relay Ingestion (Server-Mode Pod Forwards Validated Capsules)

### 1. Is there a relay endpoint that accepts pre-validated capsules?

| Mechanism | File | Endpoint |
|-----------|------|----------|
| **Coordination WebSocket** | `coordinationWs.ts` | `wss://relay.wrdesk.com/beap/ws` — push from relay |
| **Relay Pull** | `relayPull.ts` | `GET relay_pull_url` (e.g. `.../pull`) — host fetches capsules |

### 2. How would a hosted VM relay deliver capsules to the local orchestrator?

- **Push:** Coordination WebSocket — relay pushes capsules to connected client.
- **Pull:** `pullFromRelay` — client periodically fetches from `relay_pull_url` with Bearer auth.

### 3. Is this just P2P with the relay as sender, or a separate path?

Separate path. Relay uses:
- `processIncomingInput(rawInput, 'coordination_ws' | 'relay_pull', ...)`
- Same ingestion-core pipeline: `ingestInput` → `validateCapsule` → `routeValidatedCapsule`

### 4. EXPECTED: relay → ingestor validates → forwards → local decrypts → inbox

| Stage | Implementation |
|-------|----------------|
| Relay validates structure | Relay server (external) — not in this repo |
| Forwards to local | WebSocket push or HTTP pull |
| Local `processIncomingInput` | ✅ `coordinationWs.ts`, `relayPull.ts` |
| Local decrypts | ⚠️ **Only for handshake capsules** — `validateCapsule` requires `capsule_type` |
| Message in inbox | ❌ **qBEAP/pBEAP rejected** — ingestion-core `validateCapsule` fails on `MISSING_REQUIRED_FIELD: capsule_type` |

**Gap:** Relay path only accepts **handshake capsules**. BEAP message packages (qBEAP/pBEAP) would be rejected by `validateCapsule` in ingestion-core.

---

## Summary: ✅ / ⚠️ / ❌ by Path

| Path | Status | Notes |
|------|--------|-------|
| **A1 — Electron .beap file** | ✅ | Full chain: drop → p2p_pending_beap → poll → import → verify → sandbox → inbox |
| **A2 — Extension .beap file** | ⚠️ | Import works; no auto-verify — user must verify manually |
| **B — Email handshake capsules** | ✅ | detectBeapInBody + handleIngestionRPC → ingestion pipeline |
| **B — Email qBEAP/pBEAP** | ❌ | detectBeapInBody does not match header/metadata/envelope |
| **B — Plain email → BEAP** | ❌ | plainEmailToBeapConverter not implemented |
| **C — P2P handshake** | ✅ | processIncomingInput → handshake pipeline |
| **C — P2P message packages** | ✅ | isBeapMessagePackage → p2p_pending_beap → usePendingP2PBeapIngestion |
| **D — Relay handshake** | ✅ | coordinationWs / relayPull → processIncomingInput |
| **D — Relay message packages** | ❌ | validateCapsule rejects (no capsule_type) |

---

## MVP: At Least 3 Working Entry Points

| # | Path | Status |
|---|------|--------|
| 1 | **A1 — Electron .beap file** | ✅ |
| 2 | **B — Email handshake capsules** | ✅ |
| 3 | **C — P2P (handshake + message packages)** | ✅ |

**Conclusion:** MVP has 3+ working entry points. Gaps to address for full coverage:
- Extend `detectBeapInBody` (or add parallel detector) for qBEAP/pBEAP in email.
- Add auto-verify for extension file import, or document manual verify flow.
- Relay: either extend ingestion-core for message packages or document P2P-only for messages.
