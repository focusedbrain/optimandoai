# Handshake Context Architecture Analysis

**Analysis-only document.** No implementation proposals or refactoring recommendations.  
**Goal:** Understand current behavior in enough detail for a tailored solution design.

---

## A. Executive Summary

Handshake context data flows through a multi-phase lifecycle: **initiate** (with optional message/context blocks), **accept** (with optional ad-hoc blocks and HS Context Profiles), **context_sync** (P2P exchange of full content), and **ingestion** into `context_blocks` / `context_store`. Storage is split between a **Ledger DB** (metadata, hashes, commitments—no plaintext context) and a **Vault DB** (full payloads, HS Context Profiles). The system uses `getHandshakeDb()` which returns Ledger first, then Vault fallback, so many operations can proceed without an unlocked vault when an SSO session exists. Vault unlock is enforced for **accept** (when vault exists and is locked) and for **context_sync** (deferred if locked), but **initiate** with context can succeed via Ledger when `db` is non-null. Policies (`effective_policy`, `policy_selections`) are handshake-level only; there is no per-context-item governance. HS Context exists as a vault record type (`handshake_context`) with tier-gating (Publisher+); profiles and documents live in `hs_context_profiles` and `hs_context_profile_documents` in the vault DB.

---

## B. Handshake Flow Analysis

### Initiator Path

1. **Entry points:** `handshake:initiate` (IPC) or `handshake.buildForDownload` (RPC). Both call `handleHandshakeRPC` in `electron/main/handshake/ipc.ts`.

2. **Context assembly:**
   - `buildContextBlocksFromParams(rawBlocks, rawMessage)` converts:
     - `context_blocks`: pre-built blocks with `block_id`, `block_hash`, `type`, `content` (validated via `computeBlockHash`)
     - `message`: plain string → single block `type: 'plaintext'`, `block_id: 'ctx-msg-pending'`
   - File: `electron/main/handshake/ipc.ts` lines 59–95.

3. **Capsule build:** `buildInitiateCapsuleWithContent()` produces the BEAP capsule with `context_blocks`, `context_commitment`, and optional P2P fields.

4. **Persistence:** `persistInitiatorHandshakeRecord()` inserts into `handshakes`, `context_store`, `seen_capsule_hashes`. Context blocks go into `context_store` with `status: 'pending_delivery'` for initiator’s own blocks.

5. **Vault/DB gate:**  
   - `db` comes from `getHandshakeDb()` (Ledger first, then Vault).  
   - If `db` is null and `!skipVaultContext`: returns `{ success: false, error: 'Vault must be unlocked for contextual handshakes' }` (line 376–377).  
   - If `db` is non-null (e.g. Ledger from SSO): initiate proceeds even when vault is locked.  
   - `skipVaultContext` is set by the client: `true` when no context is attached, `false` when context/message is present.

6. **Evidence:** `electron/main/handshake/ipc.ts` lines 307–387, `electron/main.ts` lines 2296–2310.

### Receiver Path

1. **Entry point:** `handshake:accept` IPC → `handleHandshakeRPC('handshake.accept', ...)`.

2. **Pre-check:** Before RPC, `main.ts` checks `vaultService.getStatus()`. If `status.exists && status.locked`, returns `{ success: false, reason: 'VAULT_LOCKED', action: 'UNLOCK_VAULT' }` (lines 2154–2165). This is the main accept-side vault enforcement.

3. **Context assembly:**
   - Initiator blocks: `queryContextBlocks(db, { handshake_id })` → blocks from initiate capsule (stored during receive/import).
   - Receiver blocks: `buildContextBlocksFromParams(receiverRawBlocks, undefined)` + `resolveProfileIdsToContextBlocks(receiverProfileIds, session, handshake_id)` (HS Context Profiles, Publisher+).
   - Merge: `acceptContextBlocks = [...initiatorBlocks, ...receiverBlocks]`, compute `context_commitment`.

4. **Storage:** `insertContextStoreEntry()` for:
   - Initiator blocks: `content: null`, `status: 'pending'` (content arrives via context_sync).
   - Receiver blocks: `content` set, `status: 'pending_delivery'`.

5. **Context sync:** `tryEnqueueContextSync()` builds and enqueues `context_sync` capsule. If vault locked → `context_sync_pending=1`, returns `VAULT_LOCKED`.

6. **Evidence:** `electron/main/handshake/ipc.ts` lines 492–672, `electron/main.ts` lines 2149–2178.

### Where Context Is Attached

| Step        | Initiator                         | Receiver                                      |
|-------------|-----------------------------------|-----------------------------------------------|
| Raw input   | `context_blocks`, `message`        | `context_blocks`, `profile_ids` (HS Profiles) |
| Transform   | `buildContextBlocksFromParams`     | Same + `resolveProfileIdsToContextBlocks`     |
| Persist     | `persistInitiatorHandshakeRecord` | `insertContextStoreEntry` in accept handler   |
| Vault use   | Only when `db` null + context      | Accept blocked if vault locked; sync deferred |

### Sensitive Data Touch Points

- **Initiator:** Message and context blocks are hashed, serialized into capsule, and written to `context_store` (in Ledger or Vault DB).
- **Receiver:** Ad-hoc blocks and HS Profile content (including `extracted_text`) are written to `context_store`; initiator content arrives later via `context_sync`.
- **Context sync:** Full block content in `context_sync` capsule; built from `getContextStoreByHandshake(..., 'pending_delivery')` in `contextSyncEnqueue.ts`.

---

## C. Vault / HS Context Analysis

### Where HS Context Is Defined

- **Record type:** `handshake_context` in `packages/shared/src/vault/vaultCapabilities.ts` (RECORD_TYPE_MIN_TIER: `publisher`).
- **DB schema:** `hs_context_profiles`, `hs_context_profile_documents` in vault DB. Migration in `electron/main/vault/db.ts` lines 479–537.

### HS Context Profile Schema

**hs_context_profiles:**
- `id`, `org_id`, `name`, `description`, `scope` (`non_confidential` | `confidential`), `tags` (JSON), `fields` (JSON), `custom_fields` (JSON), `created_at`, `updated_at`, `archived`.

**hs_context_profile_documents:**
- `id`, `profile_id`, `filename`, `mime_type`, `storage_key`, `scope`, `extraction_status`, `extracted_text`, `extracted_at`, `extractor_name`, `error_message`, `created_at`.

### Storage Format

- Profile metadata: plain JSON in vault SQLCipher DB (DB encrypted at rest).
- Document content: encrypted via `sealRecord` / `openRecord` envelope (same as Document Vault). `hsContextProfileService.ts` lines 16–18.

### Data Categories in HS Context

| Field            | Classification        | Storage                          |
|------------------|------------------------|----------------------------------|
| Profile name, fields | Metadata           | Plain JSON in vault DB           |
| extracted_text   | Potentially PII/sensitive | Encrypted envelope              |
| scope            | non_confidential / confidential | Profile row                 |

### How the Unlocked Vault Is Selected

- `VaultService` holds `currentVaultId` (default `'default'`). Only one vault is unlocked at a time.
- `getStatus()` returns `currentVaultId`, `availableVaults`, `isUnlocked` for the current vault.
- Handshake DB: `getHandshakeDb()` → `getLedgerDb()` first, then `vaultService.getDb()` fallback. Ledger is independent of vault unlock.

### Multiple Vaults and Single Unlock

- `availableVaults` lists all vaults; `currentVaultId` is the active one.
- Unlock targets a specific vault; only that vault’s DB is opened. No explicit “only one vault unlocked” check—the design assumes one active session.
- UI text: “Only one vault can be unlocked at a time” (`VaultStatusIndicator.tsx` lines 72, 105).

---

## D. Vault Unlock Enforcement

### Where Unlock Is Checked

| Location                    | Check                                      | Effect                                      |
|----------------------------|---------------------------------------------|---------------------------------------------|
| `main.ts` handshake:accept | `status.exists && status.locked`            | Returns `VAULT_LOCKED`, blocks accept       |
| `ipc.ts` handshake.initiate | `!db && !skipVaultContext`                 | Returns error; but `db` often non-null       |
| `contextSyncEnqueue.ts`    | `!status?.isUnlocked`                      | Sets `context_sync_pending`, defers sync     |
| `AcceptHandshakeModal`     | `!isVaultUnlocked` before calling accept   | Client-side block, sets `vaultWarning`      |
| `HandshakeInitiateModal`   | None                                       | Shows status only, no block                 |

### Enforcement Gaps

1. **Initiator with context:** `getHandshakeDb()` can return Ledger when SSO exists and vault is locked. Initiate with context then succeeds without vault unlock.
2. **Initiate UI:** `HandshakeInitiateModal` never sets `warningEscalated`; user can submit with context while vault is locked if Ledger is available.
3. **buildForDownload:** Uses `getHandshakeDb()`; if Ledger is open, export works without vault. Default `skipVaultContext: true` for buildForDownload (line 2322).
4. **Vault “required” messaging:** UI says vault is required for sensitive data, but backend does not consistently enforce it for initiate.

### UI vs Backend

- **Accept:** UI blocks when vault locked; backend also returns `VAULT_LOCKED`. Aligned.
- **Initiate:** UI shows vault status but does not block; backend only fails when `db` is null. Misaligned when Ledger is available.
- **Context sync:** Deferred when locked; `completePendingContextSyncs` runs on vault unlock. Correct.

---

## E. Data Classification and Storage Behavior

### Stored Data Types

| Data Type              | Location              | Schema / Notes                                      |
|------------------------|-----------------------|------------------------------------------------------|
| PII                    | context_blocks.payload, context_store.content | Via blocks; no explicit PII flag          |
| Signatures             | Capsule, handshake record | Not in context_blocks                            |
| Contract data          | Block content          | type `plaintext`, `vault_profile`, etc.             |
| API credentials        | Vault items           | Not in handshake context                            |
| Secrets                | Vault items           | Not in handshake context                            |
| Encrypted payloads      | HS Profile documents  | Envelope encryption                                 |
| Hashes                 | context_blocks.block_hash, commitment | Stored everywhere                      |
| Graph/metadata         | context_blocks, context_store | type, scope_id, data_classification         |
| Message content        | As plaintext block    | Same as other blocks                                |
| Third-party data       | In block content      | No special handling                                 |

### data_classification (context_blocks)

- Values: `public`, `business-confidential`, `personal-data`, `sensitive-personal-data` (CHECK constraint in `electron/main/handshake/db.ts` lines 65–66).
- Set during ingestion; not clearly propagated from HS Profiles or ad-hoc blocks.

### Hybrid Model

- **Ledger:** Handshake metadata, hashes, commitments. No plaintext context. Encrypted with session-derived key.
- **Vault/Ledger handshake tables:** `migrateHandshakeTables` applies to both. When vault is open, handshake tables can live in vault DB; otherwise in Ledger.
- **context_blocks / context_store:** Full payload in the active DB (Ledger or Vault). Ledger is intended for metadata only, but schema allows payload—implementation detail to confirm.

### Searchability

- No explicit “search without unlock” path found. `handshake:queryContextBlocks` uses `getHandshakeDb()`; if Ledger has the data, it would return it. Embeddings live in `context_embeddings`; embedding status is `pending` until processed.

---

## F. Context and Policy Model

### Policy Types

1. **effective_policy** (per handshake): `allowedScopes`, `allowsCloudEscalation`, `allowsExport`, `effectiveTier`, etc. Resolved at handshake creation via `resolveEffectivePolicyFn` in `electron/main/handshake/steps/policyResolution.ts`.

2. **policy_selections** (per handshake): `cloud_ai`, `internal_ai`. Stored in `handshakes.policy_selections` (JSON). Updated via `handshake:updatePolicies` IPC.

### Policy Scope

- **Global:** No global policy store found.
- **Handshake-level:** Both `effective_policy` and `policy_selections` apply to the whole handshake.
- **Context-level / item-level:** None. No per-block or per-profile policy.

### Where Policies Are Enforced

- `enforcement.ts` `authorizeAction()`: scope, cloud-escalation, export, sharing mode.
- `vaultGating.ts` `gateVaultAccess()`: tier, cloud-escalation, export, scope.
- `authorizeToolInvocation.ts`: tool allowlist, scope, purpose, parameters.

### Advanced Policies UI

- `PolicyCheckboxes` in `RelationshipDetail`, `HandshakeInitiateModal`, `AcceptHandshakeModal`.
- Wired to `handshake:updatePolicies` and `record.policy_selections`.
- No evidence that `policy_selections` is used in `authorizeAction` or `gateVaultAccess`; `effective_policy` drives enforcement. **Inference:** `policy_selections` may be stored for future use or separate checks.

### Message Content

- Treated as a normal `plaintext` block. No special policy or governance.

### Automation / AI

- `authorizeToolInvocation` uses `record.effective_policy` for scope and cloud-escalation.
- No explicit use of `policy_selections` for local vs cloud AI in the reviewed code.

---

## G. UI and Enforcement Analysis

### Components

| Component                 | Role                                      | Vault enforcement                          |
|---------------------------|-------------------------------------------|--------------------------------------------|
| `VaultStatusIndicator`    | 3-state display (unlocked, locked, warning) | Purely visual                             |
| `AcceptHandshakeModal`    | Accept flow                               | Blocks accept when `!isVaultUnlocked`     |
| `HandshakeInitiateModal`  | Initiate flow                             | Shows status only; no block                |
| `RelationshipDetail`     | Handshake detail                          | Shows `VaultStatusIndicator`, `HandshakeContextSection` |
| `HandshakeContextSection` | Context list + attach                     | Disables “Attach” when `!isVaultUnlocked`   |
| `PolicyCheckboxes`       | cloud_ai, internal_ai                    | No vault dependency                        |

### Vault Info Box

- Rendered by `VaultStatusIndicator` with `vaultName`, `isUnlocked`, `warningEscalated`.
- States: unlocked (green), locked informational (blue), locked warning (red when user tried to proceed).
- Text: “Sensitive handshake data…”, “Only one vault can be unlocked at a time.”

### Purely Visual vs Enforced

- **Visual only:** Vault status display, “Unlock your vault to continue.”
- **Enforced:** Accept blocked when vault locked; context sync deferred; “Attach Context Data” disabled when locked.
- **Not enforced:** Initiate with context when Ledger is available and vault is locked.

### Active Vault Display

- `vault:getStatus` returns `name` from `availableVaults` by `currentVaultId`. Shown as “Active Vault: {name} (Unlocked/Locked)”.

### Coarse UI

- Policies apply to the whole handshake; no per-context-item controls.
- “Attach Context Data” is a single action; no per-block policy or classification in the UI.

---

## H. Backend / API / Service Layer

### Handlers and Services

| Handler / Service              | File                               | Responsibility                                  |
|--------------------------------|------------------------------------|--------------------------------------------------|
| `handleHandshakeRPC`           | `handshake/ipc.ts`                 | initiate, accept, refresh, list, etc.            |
| `persistInitiatorHandshakeRecord` | `handshake/initiatorPersist.ts`  | Direct insert for initiator                      |
| `persistRecipientHandshakeRecord` | `handshake/recipientPersist.ts`  | Insert for acceptor (receive pipeline)          |
| `tryEnqueueContextSync`        | `handshake/contextSyncEnqueue.ts`  | Build and enqueue context_sync                   |
| `ingestContextBlocks`          | `handshake/contextIngestion.ts`   | Verify commitment, persist to context_blocks     |
| HS Context Profile CRUD       | `vault/hsContextProfileService.ts` | Profiles and documents                           |
| `queryContextBlocks`          | `handshake/contextBlocks.ts`       | Read blocks for handshake                        |
| `insertContextStoreEntry`     | `handshake/db.ts`                  | Write to context_store                           |

### Path: UI → Vault Record

1. User attaches context in AcceptHandshakeModal (ad-hoc or HS Profiles).
2. `acceptHandshake(id, sharingMode, fromAccountId, { context_blocks, profile_ids })`.
3. IPC `handshake:accept` → `handleHandshakeRPC('handshake.accept', ...)`.
4. `resolveProfileIdsToContextBlocks` loads profile content from vault.
5. `insertContextStoreEntry` writes to `context_store` (in Ledger or Vault DB).
6. `tryEnqueueContextSync` builds capsule from `context_store`, enqueues for P2P.

### Validations

- Block hash verification in `buildContextBlocksFromParams` and `ingestContextBlocks`.
- Commitment verification in `ingestContextBlocks`.
- Accept: vault locked check, handshake state, sharing_mode clamp.
- Missing: no validation that `policy_selections` is respected by downstream consumers; no per-block classification validation.

---

## I. Message Content and Automation

### Storage

- Message → `plaintext` block, `block_id: 'ctx-msg-pending'`, in `buildContextBlocksFromParams` (ipc.ts lines 81–92).
- Stored in `context_store` and `context_blocks` like other blocks.

### Usage

- **Search:** `handshake:queryContextBlocks` returns blocks; `HandshakeChatSidebar` uses `buildDataWrapper(contextBlocks)` for chat. Semantic search would use embeddings.
- **Local AI:** `handshake:chatWithContext` sends `dataWrapper` (from context blocks) to LLM.
- **Cloud AI:** Gated by `effective_policy.allowsCloudEscalation` in `authorizeToolInvocation` and `gateVaultAccess`.
- **Automatic replies:** No automatic reply logic found.
- **Workflow:** No explicit workflow engine; policy enforcement is in tool authorization.

### Control

- Message content is not distinguished from other blocks. Governance is handshake-level only.

---

## J. Relevant Files and Components

| File / Module | Purpose | Handshake | Vault / HS Context | Policy |
|--------------|---------|-----------|--------------------|--------|
| `electron/main/handshake/ipc.ts` | RPC handlers for handshake.* | Core flow | resolveProfileIdsToContextBlocks, vault gate | - |
| `electron/main/handshake/contextCommitment.ts` | Hash, commitment | Block hashing | - | - |
| `electron/main/handshake/contextBlocks.ts` | Persist, query blocks | Block storage | - | - |
| `electron/main/handshake/contextSyncEnqueue.ts` | Context sync queue | P2P sync | Vault status check | - |
| `electron/main/handshake/contextIngestion.ts` | Ingest blocks post-confirm | Ingestion | - | - |
| `electron/main/handshake/db.ts` | Schema, CRUD | Tables, inserts | - | policy_selections |
| `electron/main/handshake/ledger.ts` | Ledger DB | Metadata storage | - | - |
| `electron/main/handshake/initiatorPersist.ts` | Initiator insert | Persist | - | effective_policy |
| `electron/main/handshake/recipientPersist.ts` | Acceptor insert | Persist | - | effective_policy |
| `electron/main/handshake/enforcement.ts` | authorizeAction | Enforcement | - | effective_policy |
| `electron/main/handshake/vaultGating.ts` | gateVaultAccess | Vault gate | - | effective_policy |
| `electron/main/vault/db.ts` | Vault schema | - | hs_context_profiles, migrate | - |
| `electron/main/vault/hsContextProfileService.ts` | HS Profile CRUD | - | Profiles, documents | Tier gate |
| `electron/main/vault/service.ts` | Vault lifecycle | - | Unlock, currentVaultId | - |
| `electron/main/vault/types.ts` | Types | - | VaultStatus, ItemCategory | - |
| `packages/shared/src/vault/vaultCapabilities.ts` | Capabilities | - | handshake_context, canAttachContext | - |
| `electron/main/enforcement/authorizeToolInvocation.ts` | Tool auth | - | - | effective_policy |
| `src/components/VaultStatusIndicator.tsx` | Vault UI | - | Display | - |
| `src/components/AcceptHandshakeModal.tsx` | Accept UI | Accept flow | Blocks when locked | policy_selections |
| `src/components/HandshakeInitiateModal.tsx` | Initiate UI | Initiate flow | Display only | policy_selections |
| `src/components/HandshakeContextSection.tsx` | Context UI | Attach, list | Disables attach when locked | policy_selections |
| `src/components/PolicyCheckboxes.tsx` | Policy UI | - | - | cloud_ai, internal_ai |
| `src/components/RelationshipDetail.tsx` | Detail view | Context, policies | VaultStatusIndicator | policy_selections |
| `src/shims/hsContextProfilesRpc.ts` | Electron stub | - | Throws (HS Context N/A in Electron) | - |

---

## K. Gaps, Risks, and Design Limitations

1. **Initiator vault bypass:** With SSO, Ledger can be open and initiate with context succeeds without vault unlock, contradicting UI messaging.

2. **Global policies:** `effective_policy` and `policy_selections` are handshake-level only; no per-context-item governance.

3. **policy_selections vs effective_policy:** `policy_selections` (cloud_ai, internal_ai) is stored but not clearly used in enforcement; `effective_policy` drives gates.

4. **Vault unlock not fully enforced:** Initiate and buildForDownload can proceed via Ledger when vault is locked.

5. **Context ownership:** No explicit ownership or provenance for individual blocks beyond `publisher_id` and `sender_wrdesk_user_id`.

6. **Message vs other context:** Message is a plaintext block; no special handling for search, AI, or policy.

7. **Vault storage boundaries:** Handshake tables exist in both Ledger and Vault; exact split and when each is used depends on `getHandshakeDb()` and migration. Ledger is documented as metadata-only but schema allows payload.

8. **HS Context in Electron:** `hsContextProfilesRpc` throws in Electron; HS Context Profiles may be extension-only. Need to confirm Electron support.

9. **Data classification propagation:** `data_classification` exists on `context_blocks` but is not clearly set from HS Profile scope or ad-hoc input.

10. **Single-vault assumption:** UI states only one vault can be unlocked; no hard enforcement found in code.

---

## L. Open Questions / Unknowns

1. **Electron HS Context:** Is `resolveHsProfilesForHandshake` available in Electron, or is it only in the extension? The shim throws; the extension has a real implementation.

2. **Ledger vs Vault for context_blocks:** When both exist, which DB holds `context_blocks` and `context_store`? `migrateHandshakeTables` applies to the DB passed in; `getHandshakeDb` determines which DB is used.

3. **policy_selections usage:** Where, if anywhere, are `cloud_ai` and `internal_ai` used for access control or routing?

4. **Embedding pipeline:** How and when are `context_blocks` embedded? Is embedding policy-aware?

5. **Automatic replies:** Is there any automatic reply or agent behavior that uses handshake context?

6. **Vault creation flow:** When a user has no vault, does initiate/accept create one, or must they create it first?
