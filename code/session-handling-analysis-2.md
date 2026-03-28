# Session Handling Analysis

**Scope:** Read-only inventory of how “sessions” (and related automation concepts) appear across the codebase. The word **session** refers to several different things; this report separates them.

---

## Data Model

| Name | Location | Purpose |
|------|----------|---------|
| **`Session` (orchestrator DB)** | `apps/electron-vite-project/electron/main/orchestrator-db/types.ts` **lines 28–35** | Stored workflow/automation configuration: `id`, `name`, `config: Record<string, any>`, `created_at`, `updated_at`, optional `tags`. |
| **`OrchestratorSession`** | Same file **lines 10–14** | Runtime unlock state (`dek`, `lastActivity`, `connected`) — **not** a workflow artifact. |
| **`CapsuleSessionRef`** | `apps/extension-chromium/src/beap-builder/canonical-types.ts` **lines 216–228** | Builder model: `sessionId`, `sessionName`, `requiredCapability`, `envelopeSupports`. |
| **`BeapCapsule`** | Same file **lines 238–262** | Canonical capsule: includes `sessionRefs: CapsuleSessionRef[]` **line 252**, plus `text`, `attachments`, `dataRequest`, etc. |
| **`DecryptedCapsulePayload`** | `apps/extension-chromium/src/beap-messages/services/beapDecrypt.ts` **lines 96–140** | Decrypted receiver view: `subject`, `body`, `attachments[]`, optional `automation?: { tags, tagSource, receiverHasFinalAuthority }` **lines 122–126** — **no** `sessionRefs` or execution graph on this interface. |
| **`AutomationSessionRestrictions`** | `apps/extension-chromium/src/policy/schema/domains/session-restrictions.ts` **lines 21–67** | Zod schema for what is allowed **during** automation (ingress/egress, concurrent sessions, duration). |
| **Chat “sessions” (WR Chat / draft)** | `sidepanel.tsx` type `SessionOption` **~line 84**; keys `session_*` in `chrome.storage.local` | Lightweight tab/session history for the **Session (optional)** dropdown — **not** the canonical BEAP workflow session artifact type. |

**Searches that did not yield a single “workflow session artifact” type:** `WorkflowSession`, `AutomationSession`, `SessionArtifact` — no dedicated types under those exact names beyond the items above.

---

## Storage

| Backend | What | Schema / shape |
|---------|------|----------------|
| **SQLite (Electron orchestrator)** | Named `sessions` | `apps/electron-vite-project/electron/main/orchestrator-db/db.ts` **lines 261–270**: `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, tags TEXT)`. CRUD in `orchestrator-db/service.ts` (e.g. list **~246**, upsert **~298**). |
| **`chrome.storage.local` (extension)** | Keys `session_*` | Used to populate BEAP draft “Session (optional)” options in `sidepanel.tsx` **lines 443–479** (`loadAvailableSessions`). |
| **SQLite (inbox — different meaning)** | `autosort_sessions` | `electron/main/handshake/db.ts` / `email/ipc.ts` — **Auto-Sort** run metadata (`started_at`, counts, `ai_summary_json`), **not** BEAP-attached workflow sessions. |

There is **no** `session_artifacts` table or dedicated “pending imported session” store found in the surveyed paths.

---

## Sender Side (Capsule Builder)

| Question | Finding |
|----------|---------|
| **Session UI in full builder** | `CapsuleSection.tsx` — block **“Sessions / Automation”** **lines 409–494**: lists `availableSessions` as `CapsuleSessionRef[]`; click toggles selection via `onSelectSession` / `onDeselectSession`; empty state **“No sessions available”** **lines 415–418**. |
| **WR Chat / sidepanel dropdown** | `sidepanel.tsx` **lines 422–429, 443–492, 5248–5272** (and similar blocks **6765**, **8053**): `<label>Session (optional)</label>` + `<select>`; options from `availableSessions` loaded via `loadAvailableSessions()` from `chrome.storage.local` keys `session_*`. **`popup-chat.tsx` **lines 1359–1361** same pattern. |
| **How sender selects** | Builder: click rows in `CapsuleSection`. Chat draft: select `<option>` value = storage key; state `beapDraftSessionId` **line 426**. |
| **Serialization into wire package** | **`BeapPackageConfig`** (`BeapPackageBuilder.ts` **lines 299–392**) has **no** `sessions`, `sessionRefs`, or `selectedSessionIds` field. **`buildQBeapPackage`** builds `capsulePayloadJson` with `subject`, `body`, `transport_plaintext`, `attachments`, `automation` (**automation metadata from `buildAutomationMetadata`**, **lines 1048–1049, 1188–1212**) — **does not** include `sessionRefs` from `BeapCapsule`. |
| **Canonical vs implementation gap** | `BeapCapsule.sessionRefs` exists in **canonical-types.ts** but the **qBEAP capsule JSON** in `BeapPackageBuilder` does not serialize `sessionRefs`. Session-related capability in the builder is expressed via envelope **`session_control`** and ingress presets (see `useEnvelopeGenerator.ts` **395–405**), not as a separate capsule field in the builder path reviewed. |
| **Envelope field** | Capsule plaintext uses **`automation`** (tags/metadata), not a separate top-level “session graph” field, in the current `buildQBeapPackage` payload. |

---

## Receiver Side (Ingestion)

| Stage | Location | Session handling |
|-------|----------|------------------|
| **P2P / pending** | `coordinationWs.ts` `processCapsuleInternal` | Routes message packages to `p2p_pending_beap`; no session-specific branch in the excerpt reviewed. |
| **Main-process email / inbox preview** | `beapEmailIngestion.ts` `beapPackageToMainProcessDepackaged` **lines 164–192** | For **pBEAP**, parses `capsule.attachments` only. **No** extraction of `sessionRefs`, session blobs, or workflow graphs. |
| **Decrypted payload shape** | `beapDecrypt.ts` `DecryptedCapsulePayload` | **Automation** is tag-based (`automation?.tags`), not structured session import. |

**Temporary storage before user consent (for attached workflow sessions):** **Not identified** in ingestion code — no “pending_session_import” queue found in this search.

---

## Consent Flow

| Flow | Status in codebase |
|------|---------------------|
| **Manual consent: “Import session” on a message** | **Not found** as a dedicated UI + IPC for BEAP-received session artifacts. |
| **Processing / AI / automation consent** | **Stage 6.1 gate** — `runStage61Gate` in `apps/extension-chromium/src/beap-messages/services/processingEventGate.ts` (referenced from `beapDecrypt.ts` **lines 174–178**, `useReplyComposer.ts` **469–479**). Evaluates **processing events** and capability policy — **not** a separate “import this session ID” action. |
| **Policy: `sessionRestrictions`** | `AutomationSessionRestrictionsSchema` + `sessionRestrictions` on handshake overrides (`handshake-overrides.ts` **line 42**) — constraints **during** automation, not auto-import of an attached session artifact. |
| **Auto-import trigger** | **Not found** as explicit “policy consent auto-imports session from capsule.” |

---

## Orchestrator Integration

| Aspect | Finding |
|--------|---------|
| **Entry point** | `OrchestratorService` (`orchestrator-db/service.ts`): `connect`, generic `get`/`set`, `listSessions`, `upsertSession`, export/import. HTTP routes in `electron/main.ts` **~6911–7051** (`/api/orchestrator/*`). |
| **Session → “Optimando orchestrator” execution** | No `orchestrator.ts` / `workflowRunner.ts` / `sessionExecutor.ts` located in this repo with that naming. Execution graphs and PoAE for **packages** are handled in BEAP layers (`BeapPackageBuilder` **PoAE** **lines 1558–1585** when `isProcessingPermitted(..., 'actuating')` — ties to **processing events**, not orchestrator DB sessions). |
| **Capability enforcement** | Receiver: `authorizedProcessing` / processing gate on decrypted packages (`beapDecrypt.ts`). Builder/sender: envelope capabilities + `processingEvents`. Policy: `AutomationSessionRestrictions` + Stage 6.1. |
| **PoAE generation** | `generatePoAERecord` in `BeapPackageBuilder.ts` **lines 1566–1574** (qBEAP) and **~1731+** (pBEAP path). Comment **lines 1561–1563**: PoAE when package carries **actuating** processing — error message mentions **“session configuration”** **line 1579** (configuration/PoAE failure string, not proof that orchestrator sessions are wired). |

---

## Current Inbox Session UI

| Feature | Normal / BEAP inbox (Electron) |
|---------|-------------------------------|
| **See attached workflow sessions on received messages** | **Missing** as a first-class list (ingestion does not surface `sessionRefs`; `BeapMessage` in extension inbox centers attachments + tags, not imported orchestrator sessions). |
| **“Import Session” / automation trigger from message** | **Missing** in `EmailInboxView` / `BeapMessageDetailPanel` analysis scope. |
| **“Session” in Bulk Inbox** | **Auto-Sort** uses `autosort_sessions` and “Review Session” UI — **different product concept** from BEAP workflow session attachments (`EmailInboxBulkView.tsx` grep: session review/history). |

**What would need to be built (gap summary):** End-to-end alignment: (1) serialize `sessionRefs` (or equivalent) in `BeapPackageBuilder` if canon requires it, (2) parse and persist pending session payloads on receive, (3) consent UI + IPC, (4) map imported artifact into `orchestrator-db` `sessions` or a dedicated table, (5) a real runner that consumes `config_json` under capability constraints.

---

## Output Template (filled)

```markdown
## Data Model
- Type: `Session` at orchestrator-db/types.ts:28; `CapsuleSessionRef` at canonical-types.ts:216; `DecryptedCapsulePayload` at beapDecrypt.ts:96
- Key fields: see tables above

## Storage
- Backend: SQLite (orchestrator `sessions`); chrome.storage (`session_*`); autosort_sessions separate
- Table/collection: `sessions` (orchestrator)
- Schema: id, name, config_json, created_at, updated_at, tags

## Sender Side (Capsule Builder)
- Session dropdown component: sidepanel.tsx ~5248–5272; CapsuleSection.tsx ~409–494; popup-chat.tsx ~1359
- Session serialization: BeapPackageBuilder buildQBeapPackage ~1188–1212 — automation metadata only; sessionRefs not in JSON
- Envelope field: capabilities include session_control (useEnvelopeGenerator); capsule field automation (tags)

## Receiver Side (Ingestion)
- Session detection: [MISSING as explicit step] — beapEmailIngestion attachments only ~181–192
- Session extraction: [MISSING]
- Temporary storage: [NOT FOUND]

## Consent Flow
- Manual consent UI: [MISSING]
- Manual consent handler: [MISSING]
- Policy consent evaluator: processingEventGate / runStage61Gate (processing events)
- Auto-import trigger: [MISSING]

## Orchestrator Integration
- Session → orchestrator path: orchestrator-db/service.ts list/upsertSession; HTTP /api/orchestrator/* — not wired from BEAP capsule sessionRefs in current build
- Capability enforcement: processing gate + policy sessionRestrictions + envelope capabilities
- PoAE generation: BeapPackageBuilder.ts ~1558–1585 (actuating processing)

## Current Inbox Session UI
- Session visibility: missing (workflow session)
- Import trigger: missing
- Automation status: Auto-Sort session review only (different feature)
```

---

*Analysis Prompt 2 of 4 — Session handling in the orchestrator and related surfaces.*
