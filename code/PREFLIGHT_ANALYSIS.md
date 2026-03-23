# PREFLIGHT_ANALYSIS.md
## BEAP™ Handshake Pre-Flight — Codebase Analysis & Cleanup Map

**Branch:** `handshake`  
**Date:** 2026-03-01  
**Analyst:** Senior Security Engineer (automated)  
**Scope:** Full repository — `apps/electron-vite-project/` (Electron main process) and `apps/extension-chromium/` (Chrome extension)

---

## Phase 1 — Full File Inventory

> Only files that **directly touch** handshake-related concerns are included. Files that merely import UI types or unrelated extension infrastructure are noted but not inventoried unless they have a handshake coupling.

### Extension Chromium — `apps/extension-chromium/src/`

| File Path | Concern(s) | Status | Notes |
|---|---|---|---|
| `handshake/types.ts` | Handshake data model, state enum (`PENDING/LOCAL/VERIFIED_WR`), `AutomationMode`, wire payload types (`HandshakeRequestPayload`, `HandshakeAcceptPayload`), X25519 / ML-KEM-768 key fields | **Keep / Refactor** | Core types are largely correct. Missing: asymmetric sharing flag, tier field, capsule-policy intersection, revocation state. `delivery_method` in `HandshakeRequest` includes `'messenger'` which is out of scope. |
| `handshake/handshakeService.ts` | Identity management, `getOurIdentity()`, payload creation (`createHandshakeRequestPayload`, `createHandshakeAcceptPayload`), fingerprint derivation from X25519 | **Keep / Refactor** | Solid cryptographic identity logic. ML-KEM always skipped ("Electron-only, optional"). No pipeline runner. No tier gate. No email-transport binding. |
| `handshake/useHandshakeStore.ts` | State store (Zustand), handshake CRUD, lifecycle: `createPendingOutgoingFromRequest`, `completeHandshakeFromAccept`, `createFromIncomingRequest`, `initializeWithDemo` | **Refactor** | State lives in `chrome.storage.local` only (no SQLite). Transitions are **not validated** — any state can jump to any other. `completeHandshakeFromAccept` matching logic is broken (first-pending wins, not requestId-based). Demo data with `isMock` contaminates production store. |
| `handshake/handshakePayload.ts` | Wire format serialization/parsing, type guards (`isHandshakeRequestPayload`, `isHandshakeAcceptPayload`), fail-closed parse | **Keep** | Well-implemented. Fail-closed. No pipeline runner integration needed here. |
| `handshake/fingerprint.ts` | SHA-256 fingerprint generation (async + sync fallback), formatting utilities, mock fingerprint generator | **Partial Refactor** | `generateFingerprintSync` uses a weak custom hash (not SHA-256) — acceptable only for UI display, but must not be used for identity. `generateMockFingerprint` should be isolated behind a `DEV_ONLY` guard. |
| `handshake/microcopy.ts` | UI string constants for handshake UX | **Keep** | No structural concerns. |
| `handshake/index.ts` | Module barrel export | **Keep** | No issues. |
| `handshake/components/HandshakeAcceptModal.tsx` | Accept/reject UX, fingerprint comparison, `AutomationMode` selector | **Keep / Refactor** | UX is correct. Accept callback passes `automationMode` to caller — but caller (`useHandshakeStore`) does not validate the transition or send the accept payload back via email. Missing: reciprocal context flow gate (does accept auto-send acceptor context?). |
| `handshake/components/HandshakeDetailsPanel.tsx` | Handshake detail view | **Keep** | Minor UX, no security logic. |
| `handshake/components/HandshakeSelectItem.tsx` | Picker list item component | **Keep** | No concerns. |
| `handshake/components/PackageHeaderMeta.tsx` | Fingerprint + handshake display in package header | **Keep** | No concerns. |
| `beap-messages/services/beapCrypto.ts` | AEAD (AES-256-GCM), HKDF-SHA256, X25519 key derivation, Ed25519 signing, ML-KEM-768 PQ interface via Electron HTTP API, chunking, AAD canonicalization | **Keep** | Solid. `_ephemeralSigningKey` (in-memory, lost on reload) is a known MVP gap noted in source. PQ calls over `127.0.0.1:17179` — tightly coupled to Electron being alive. |
| `beap-messages/services/x25519KeyAgreement.ts` | X25519 key generation, storage in `chrome.storage.local`, ECDH, `getOrCreateDeviceKeypair()` | **Keep** | Correct. Key stored in extension storage — not in vault. Must be noted as a migration target. |
| `beap-messages/services/BeapPackageBuilder.ts` | qBEAP / pBEAP package builder, key derivation per handshake, AAD binding, signing, PQ encapsulation | **Keep / Refactor** | Handshake coupling via `selectedRecipient.handshake_id` and `peerX25519PublicKey`. No incoming pipeline (builder is outbound only). |
| `beap-messages/services/beapDecrypt.ts` | Incoming capsule decryption, stage-based pipeline (Stage 0–6), ECDH key re-derivation | **Keep** | Correct pipeline structure. However Stage 0 eligibility check pulls key from `useHandshakeStore` which is `chrome.storage` — not SQLite. |
| `beap-messages/services/__tests__/BeapPackageBuilder.test.ts` | Unit tests for package builder: qBEAP policy gate, transport leakage, public config | **Keep** | No handshake state machine tests. |
| `beap-messages/services/__tests__/beapCrypto.test.ts` | Crypto primitive tests | **Keep** | No handshake tests. |
| `beap-messages/useBeapMessagesStore.ts` | UI message store for inbox/outbox/drafts/rejected, `importMessage`, folder management | **Keep** | References `handshake_id` in `BeapMessageUI.handshake_id`. No direct state mutation of handshake records. |
| `beap-messages/types.ts` | `BeapMessageUI`, `VerificationStatus`, delivery types, rejection reasons | **Keep / Refactor** | `delivery_method: 'email' | 'messenger' | 'download'` — messenger is in scope only for import, not send. Verify handshake send path is email-only. |
| `beap-messages/seedData.ts` | Demo/seed messages for UI | **Keep / Mark** | Contains hardcoded fingerprints and handshake IDs. Must be clearly marked as mock-only and not reachable in production flows. |
| `beap-messages/components/RecipientHandshakeSelect.tsx` | UI: select recipient handshake for outgoing message | **Keep** | Reads from `useHandshakeStore`. |
| `beap-messages/components/RecipientModeSwitch.tsx` | UI: public vs private mode toggle | **Keep** | |
| `beap-messages/hooks/useBeapDraftActions.ts` | Draft management actions | **Keep** | References handshake via `selectedRecipient`. |
| `beap-builder/canonical-types.ts` | `BeapEnvelope`, `BeapCapsule`, `CapabilityClass`, `NetworkConstraints`, `CapsuleAttachment` | **Keep** | `BeapEnvelope.handshakeId` present. `recipientFingerprint` present. Correct asymmetry modeled at envelope level. |
| `beap-builder/types.ts` | `BeapBuildResult`, `DeliveryConfig`, `DeliveryMethod` | **Keep** | `DeliveryMethod` includes `'messenger'` — out of scope for BEAP send. |
| `beap-builder/sendPipeline.ts` | Outbound send pipeline: intent → envelope → capsule → outbox | **Refactor** | Uses `generateMockFingerprint()` for sender fingerprint (line 26 import) in some paths. Transport selection (`email/messenger/download`) all wired — must gate to email-only for handshake sends. |
| `beap-builder/deliveryService.ts` | Email / messenger / download delivery dispatch | **Refactor** | `sendViaMessenger` creates `beap://` links and clipboard injection — needs removal for handshake-bound packages. Email path sends to `chrome.runtime.sendMessage` → background → Electron HTTP — correct for email transport. |
| `beap-builder/useEnvelopeGenerator.ts` | Envelope generation hook | **Keep** | |
| `beap-builder/useCapsuleBuilder.ts` | Capsule build hook | **Keep** | |
| `beap-builder/useBeapBuilder.ts` | Orchestrator hook | **Keep** | |
| `beap-builder/useSendBeapMessage.ts` | Send hook | **Keep** | |
| `beap-builder/useWRChatSend.ts` | WR Chat inline send (silent mode) | **Separate** | In-scope for WR Chat capsules, but NOT for handshake-bound email send. Keep separate. |
| `beap-builder/parserService.ts` | Attachment parsing, PDF extraction, no-transport-leakage guards | **Keep** | |
| `beap-builder/requiresBuilder.ts` | Decides when BEAP builder is required | **Keep** | |
| `beap-builder/dispatch-types.ts` | `SendContext`, `OutboxEntry`, `DispatchResult` | **Keep** | |
| `beap-builder/boundary-types.ts` | Execution boundary types | **Keep** | |
| `ingress/importPipeline.ts` | Incoming BEAP package import: email / messenger / file | **Refactor** | `importFromEmail` is a stub returning mock payloads. Real email pull must read from Electron email gateway. No handshake lookup at import time (correct by design). Messenger and file import remain valid. |
| `ingress/useIngressStore.ts` | Ingress event + payload store | **Keep** | |
| `ingress/types.ts` | `IngressSource`, `IngressEvent`, `ImportPayload` | **Keep** | |
| `ingress/components/ImportEmailModal.tsx` | Email import UI | **Keep** | Calls stub `importFromEmail`. |
| `ingress/components/ImportFileModal.tsx` | File import UI | **Keep** | |
| `ingress/components/ImportMessengerModal.tsx` | Messenger paste import UI | **Keep** | Paste import remains valid ingress path. |
| `envelope-evaluation/evaluateEnvelope.ts` | Three-step evaluation pipeline: envelope verification → boundary check → WRGuard intersection | **Refactor** | `verifyEnvelope` is a **stub** — no real signature verification. Checks only field presence. Handshake identity is not verified cryptographically. |
| `envelope-evaluation/types.ts` | `BeapEnvelope`, `EvaluationResult`, `RejectionCode`, `RejectionReason` | **Keep** | |
| `envelope-evaluation/useVerifyMessage.ts` | React hook calling evaluator | **Keep** | |
| `policy/schema/domains/handshake-overrides.ts` | Per-handshake policy: automation permissions, egress/ingress overrides, `HandshakePolicyOverrideSchema` | **Keep / Refactor** | Rich schema. `automation_partner` mode concept is present but not wired to handshake state machine. No ceiling enforcement validated (override cannot exceed global). |
| `policy/engine/evaluator.ts` | Policy evaluation engine | **Keep** | |
| `policy/engine/intersection.ts` | Policy intersection logic | **Keep** | |
| `policy/engine/decisions.ts` | Decision types | **Keep** | |
| `policy/schema/policy.schema.ts` | Master policy schema | **Keep** | |
| `policy/store/usePolicyStore.ts` | Policy Zustand store | **Keep** | |
| `packages/types.ts` | `BeapPackage`, `handshake_id`, `AutoRegisterPolicy` | **Keep** | |
| `packages/registrationService.ts` | Package registration, handshake lookup for auto-register | **Keep** | |
| `packages/usePackageStore.ts` | Package state store | **Keep** | |
| `shared/beap/types.ts` | `VerificationState`, `Folder`, `Source`, `DeliveryMethod`, `ImportKind`, `BeapPackageMarker` | **Keep** | |
| `shared/beap/constants.ts` | BEAP constants | **Keep** | |
| `shared/beap/validators.ts` | BEAP validators | **Keep** | |
| `vault/api.ts` | Extension-side vault API: `getItemMeta`, `setItemMeta`, `evaluateHandshakeAttach` | **Keep** | Calls Electron HTTP for handshake context evaluation. |
| `vault/types.ts` | `HandshakeContext`, `HANDSHAKE_CONTEXT_STANDARD_FIELDS` | **Keep** | |
| `vault/vault-ui-typescript.ts` | Handshake context list/create/edit/evaluate UI | **Keep** | |
| `background.ts` | Extension background script, message routing | **Review** | References `BEAP_SEND_EMAIL` handler for email delivery. Handshake send path terminates here. |
| `ui/components/P2PChatPlaceholder.tsx` | P2P Chat UI placeholder | **🗑️ Remove** | Explicitly labeled "not yet integrated / placeholder". Not in scope. Contains disabled inputs only. |
| `ui/components/P2PStreamPlaceholder.tsx` | P2P Stream UI placeholder | **🗑️ Remove** | Same — out of scope. |
| `ui/components/GroupChatPlaceholder.tsx` | Group Chat placeholder | **🗑️ Remove** | Out of scope for email-transport handshake. |

---

### Electron Main Process — `apps/electron-vite-project/electron/`

| File Path | Concern(s) | Status | Notes |
|---|---|---|---|
| `main.ts` | WebSocket `ELECTRON_HANDSHAKE` auth message (launch secret distribution), `vault.bind` handshake (VSBT binding), `/api/vault/handshake/evaluate` HTTP route, `/api/crypto/pq/*` routes | **Keep / Clarify** | **"Handshake" here refers to two unrelated concepts:** (1) WebSocket auth handshake (launch secret), (2) `vault.bind` VSBT binding, (3) handshake-context attachment evaluation. None of these are BEAP handshakes. Must be explicitly distinguished. |
| `main/vault/service.ts` | `VaultService`: unlock/lock, item CRUD, `evaluateAttach` (handshake context policy), `canAttachContext` | **Keep** | `evaluateAttach` evaluates attachment eligibility for `handshake_context` vault items — correct implementation. |
| `main/vault/db.ts` | SQLite schema: `vault_meta`, `containers`, `vault_items`, `vault_documents`; migrations: `migrateEnvelopeColumns`, `migrateDocumentTable` | **Keep** | **No handshake state table in SQLite.** Handshake records live entirely in `chrome.storage.local` (extension). This is a critical gap — handshake state is not persisted to the encrypted vault. |
| `main/vault/crypto.ts` | Vault-level DEK management, HKDF, field encryption | **Keep** | |
| `main/vault/types.ts` | `VaultTier`, `HandshakeBindingPolicy`, `HandshakeTarget`, `AttachEvalResult`, `canAttachContext` | **Keep** | `HandshakeBindingPolicy` governs context attachment — not handshake state. |
| `main/vault/schemas.ts` | Vault schema version constants | **Keep** | |
| `main/vault/envelope.ts` | Record envelope encryption (sealRecord/openRecord) | **Keep** | |
| `main/vault/rpc.ts` | Vault RPC dispatcher over WebSocket | **Keep** | |
| `main/vault/rpcAuth.test.ts` | RPC auth tests | **Keep** | |
| `main/vault/capabilityGate.test.ts` | Tier capability gate tests | **Keep** | |
| `main/vault/tierResolution.test.ts` | Tier resolution tests (`resolveTier`, `mapRolesToTier`) | **Keep** | |
| `main/vault/vsbt.test.ts` | VSBT binding tests | **Keep** | |
| `main/vault/security-regression.test.ts` | Security regression tests | **Keep** | |
| `main/email/gateway.ts` | Email gateway: Gmail/Outlook/IMAP send and receive | **Keep** | Entry point for email transport. Handshake capsules are delivered through here (outbound) and received here (inbound). |
| `main/email/ipc.ts` | Email IPC handlers | **Keep** | |
| `main/email/providers/gmail.ts` | Gmail OAuth email provider | **Keep** | |
| `main/email/providers/outlook.ts` | Outlook email provider | **Keep** | |
| `main/email/providers/imap.ts` | IMAP email provider | **Keep** | |
| `main/policy/service.ts` | Policy service (Electron side) | **Keep** | |
| `main/policy/db.ts` | Policy database | **Keep** | |
| `preload.ts` | Electron preload bridge | **Keep** | No direct handshake logic. |
| `storage/migrations.ts` | PostgreSQL KV store migration | **Review** | PostgreSQL adapter is present alongside SQLite. No handshake schema in either. |
| `storage/PostgresAdapter.ts` | Postgres storage adapter | **Review** | Dual-database architecture (SQLite + Postgres) is unexpected. Clarify which is authoritative for what. |

---

## Phase 2 — Architecture Map

### 2.1 Current State Machine

**States (as implemented in `handshake/types.ts` and `useHandshakeStore.ts`):**

```
type HandshakeStatus = 'PENDING' | 'LOCAL' | 'VERIFIED_WR'
type AutomationMode = 'DENY' | 'REVIEW' | 'ALLOW'
```

**State Transition Graph (actual code paths):**

```
[none]
  │  createPendingOutgoingFromRequest()
  ▼
PENDING ──── completeHandshakeFromAccept() ────► LOCAL
                                                   │
                                           (manual upgrade)
                                                   ▼
                                            VERIFIED_WR

createFromIncomingRequest() ────────────────► LOCAL (immediate)
```

**Critical findings:**
- **No pipeline runner.** Transitions are direct state assignments in `set()` calls. No validator checks if a transition is legal.
- **`completeHandshakeFromAccept` matching is broken.** Lines 282-286 of `useHandshakeStore.ts`: the match finds any pending handshake where `payload.senderFingerprint` is truthy — i.e., it matches the **first pending handshake regardless of which accept arrived.** Two simultaneous outgoing handshakes would create a collision.
- **No EXPIRED state.** `HandshakeRequestPayload.expiresAt` exists on the wire format but is never checked during accept processing.
- **No REJECTED state.** Rejections in the accept flow return `false` but do not record why or mark the handshake.
- **No REVOKED state.** Revocation is not modeled at all.
- **State lives in `chrome.storage.local` only.** No SQLite persistence. Vault lock does not affect handshake state.
- **`VERIFIED_WR` is unreachable.** No code path sets `status = 'VERIFIED_WR'` except demo data initialization.

---

### 2.2 Current Data Flow

**Outgoing (Send):**

```
[User composes draft in BeapBuilderModal]
  → useCapsuleBuilder / useEnvelopeGenerator
  → BeapPackageBuilder.buildPackage()           (apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts)
    ↳ selectedRecipient.handshake_id → lookup peerX25519PublicKey
    ↳ deriveSharedSecretX25519()                (x25519KeyAgreement.ts)
    ↳ deriveBeapKeys()                          (beapCrypto.ts)
    ↳ encryptCapsulePayloadChunked()
    ↳ encryptArtefactWithAAD()
    ↳ createBeapSignature()
  → deliverPackage()                            (beap-builder/deliveryService.ts)
    ↳ email: chrome.runtime.sendMessage(BEAP_SEND_EMAIL)
    ↳ background.ts → HTTP POST to Electron → email/gateway.ts
```

**Missing hops:** No validation that the handshake is in `LOCAL` or `VERIFIED_WR` state before encryption. A `PENDING` handshake (no `peerX25519PublicKey`) would fail at `hasValidX25519Key()` check in `BeapPackageBuilder`, but this throws a `BeapCanonViolationError` — not a friendly gate.

**Incoming (Receive):**

```
[Email arrives at Electron email gateway]          (electron/main/email/gateway.ts)
  → Electron polls / webhook
  → [NO AUTOMATIC IMPORT CURRENTLY]
  
[User manually triggers import via extension UI]
  → ingress/components/ImportEmailModal.tsx
  → importPipeline.importFromEmail()              (ingress/importPipeline.ts)
    ↳ STUB: returns mock payload — no real email body read
  → importBeapMessage()
    ↳ validateImportPayload() — minimal regex check only
    ↳ useIngressStore.storePayload()
    ↳ useIngressStore.addEvent()
    ↳ useBeapMessagesStore.importMessage()
      → status: 'pending_verification'
  
[User manually triggers "Verify" in UI]
  → envelope-evaluation/useVerifyMessage.ts
  → evaluateEnvelope.evaluateIncomingMessage()
    ↳ verifyEnvelope() — STUB (checks field presence only)
    ↳ checkBoundaries()
    ↳ evaluateWRGuardIntersection()
  → result → UI display (accepted / rejected)
  
[Decryption — triggered explicitly by user]
  → beapDecrypt.decryptBeapPackage()
    ↳ Stage 0: handshake lookup via useHandshakeStore
    ↳ deriveSharedSecretX25519(peerPublicKeyBase64)
    ↳ deriveBeapKeys()
    ↳ decryptCapsulePayload()
    ↳ decryptArtefact()
```

**Critical gaps in data flow:**
- Email gateway (`electron/main/email/gateway.ts`) has no automatic push to ingress pipeline. Real email receipt is not wired to import.
- Verification is a stub — no actual signature verification runs.
- State mutation (`status → accepted`) happens in UI store only, not persisted.
- No handshake lookup validation at import time (by design).
- No handshake state check at decryption time (decryption proceeds if key exists regardless of handshake status).

---

### 2.3 Current Transport Assumptions

**Email-specific code paths:**
- `electron/main/email/gateway.ts` — Gmail/Outlook/IMAP send/receive
- `electron/main/email/providers/*` — provider-specific implementations
- `beap-builder/deliveryService.ts → sendViaEmail()` — email delivery
- `ingress/components/ImportEmailModal.tsx` — email import UI
- `ingress/importPipeline.ts → importFromEmail()` — email import (stub)
- `envelope-evaluation/evaluateEnvelope.ts` — checks `ingressChannel === 'email'` for provider validation

**Messenger / non-email code paths (⚠️ OUT OF SCOPE):**
- `beap-builder/deliveryService.ts → sendViaMessenger()` — clipboard copy + `beap://` link generation
- `ingress/components/ImportMessengerModal.tsx` + `importPipeline.ts → importFromMessenger()` — paste import
- `ui/components/P2PChatPlaceholder.tsx` — P2P chat (placeholder only, never functional)
- `ui/components/P2PStreamPlaceholder.tsx` — P2P stream (placeholder only)
- `beap-builder/useWRChatSend.ts` — WR Chat inline send (silent mode, not external)
- `shared/beap/types.ts → Source` includes `'messenger' | 'chat'`
- `handshake/types.ts → HandshakeRequest.delivery_method` includes `'messenger' | 'download'`

**Transport-agnostic abstractions:**
- `beap-messages/services/BeapPackageBuilder.ts` — transport-agnostic package builder (correct)
- `beap-messages/services/beapCrypto.ts` — transport-agnostic crypto (correct)
- `handshake/handshakePayload.ts` — transport-agnostic serialization (correct)

**Hardcoded transport assumptions in handshake logic:**
- `handshake/types.ts:166` — `delivery_method: 'email' | 'messenger' | 'download'` — messenger must be removed from outgoing handshake delivery
- `beap-builder/deliveryService.ts:108` — `beap://` link scheme assumes messenger delivery

---

### 2.4 Current Sharing Model

**Is asymmetric sharing modeled?** No.

The current model is **always bidirectional** upon acceptance:
- When Alice sends a handshake request, she includes her X25519 public key.
- When Bob accepts, he sends back his X25519 public key + chosen automation mode.
- Both parties can now encrypt to each other.

**What happens on accept — does the acceptor's context go back automatically?**
No. `createHandshakeAcceptPayload()` creates the payload, but there is no code that automatically sends the accept payload back to the initiator via email. The accept is captured in the store locally but **never transmitted back**.

**Context blocks:** There is no concept of "context block" in the current implementation. Handshake context items (`vault/types.ts`) are vault items that can be manually attached — they are not automatically exchanged.

**Receive-only mode:** Not modeled. All handshakes grant symmetric encryption capability. A handshake that provides only a receive-only token (initiator shares public key but cannot encrypt to acceptor until accept arrives) does not exist.

---

### 2.5 Current Tier / Classification

**Where are tier signals evaluated?**
- `electron/main/vault/service.ts` calls `resolveTier(wrdesk_plan, roles)` per HTTP request from JWT claims.
- `resolveTier` / `mapRolesToTier` are defined in `apps/electron-vite-project/src/auth/capabilities.ts`.
- `tierResolution.test.ts` verifies resolution from `wrdesk_plan` claim vs role fallback.
- `canAccessCategory()` in `vault/types.ts` gates vault item access by tier.
- `canAttachContext()` gates handshake context attachment at tier `publisher` and above.

**Is classification deterministic and signal-based?** Yes, for tier. `wrdesk_plan` JWT claim is the primary signal; roles are the fallback.

**Snapshot vs effective distinction:** Not explicitly modeled. Tier is resolved per-request from live JWT, so it is always "effective" at request time. No snapshot stored.

**Where does the tier decision affect downstream handshake behavior?**
- Handshake context attachment (`/api/vault/handshake/evaluate`) is gated at `publisher+`.
- Handshake **creation** is NOT tier-gated. Any authenticated user can create a handshake.
- Handshake **automation mode (ALLOW / Full-Auto)** is not tier-gated. Any tier can enable Full-Auto per-handshake.
- **Gap:** Whether a handshake can use qBEAP encryption vs pBEAP is determined by `recipientMode: 'private' | 'public'` in `BeapPackageBuilder` — not by tier. Tier does not gate qBEAP usage.

---

### 2.6 Current Policy Model

**Does a receiver policy exist?**
Yes — `handshake-overrides.ts` defines `HandshakePolicyOverrideSchema` with per-handshake automation permissions, egress/ingress permissions, rate limits. However, this schema is defined but **not wired** to the handshake state machine or to the envelope evaluation pipeline.

**Does capsule policy exist? Is intersection logic implemented?**
Yes — `policy/engine/intersection.ts` and `evaluator.ts` implement policy intersection. Tests exist (`evaluator.test.ts`, `intersection.test.ts`). However, intersection with handshake-specific overrides is not called during envelope evaluation.

**Is receiver policy dominant (ceiling)?**
The schema states: "Override cannot exceed global ceiling (no escalation), Admin locks apply to overrides too." But this invariant is **not enforced** in code — `mergeWithGlobalPolicy()` in `handshake-overrides.ts` (line 201) simply overwrites with override values without ceiling checks.

---

### 2.7 Current Persistence

**SQLite schema (vault DB — `electron/main/vault/db.ts`):**

```sql
vault_meta (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL,
  updated_at INTEGER NOT NULL
)

containers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  favorite INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

vault_items (
  id TEXT PRIMARY KEY,
  container_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT,
  fields_json TEXT NOT NULL,
  favorite INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Additive migration columns:
  wrapped_dek BLOB,
  ciphertext BLOB,
  record_type TEXT,
  meta TEXT,
  schema_version INTEGER DEFAULT 1
  FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE CASCADE
)

vault_documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  wrapped_dek BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

**Indexes:** `idx_items_container`, `idx_items_domain`, `idx_items_category`, `idx_items_favorite`, `idx_items_schema_version`, `idx_items_record_type`, `idx_docs_sha256`, `idx_docs_created`

**Key findings:**
- **No `handshakes` table in SQLite.** Handshake records live entirely in `chrome.storage.local` (extension), not in the encrypted vault.
- **No handshake state migration tracking.** No version column on handshake records.
- The `handshake_context` records ARE stored in `vault_items` (category = `'handshake_context'`) — but the handshake state records themselves are not.
- PostgreSQL adapter exists (`storage/PostgresAdapter.ts`, `storage/migrations.ts`) for a `kv_store` table. This is the orchestrator storage — not handshake storage.

**Encryption at rest:**
- Vault DB: SQLCipher (AES-256-GCM, PBKDF2-HMAC-SHA512, 64000 iterations). ✅
- Handshake state: `chrome.storage.local` — **NOT encrypted at rest.** Browser storage is not encrypted.

**Key lifecycle:**
- Vault DEK is zeroed via `zeroize()` on lock/logout. ✅
- X25519 device keypair: stored in `chrome.storage.local`, **not zeroed on vault lock**. Gap.
- Ed25519 ephemeral signing key: in-memory only (`_ephemeralSigningKey`), lost on extension reload. Gap.

**Migration tracking:**
- SQLite: Additive-migration pattern (try/catch ALTER TABLE), no migration version table. Functional but not formally tracked.
- PostgreSQL: Single `MIGRATION_001_KV_STORE` applied on startup via `runMigrations()`.

---

### 2.8 Current Test Coverage

| Test File | Type | What It Tests | What It Misses |
|---|---|---|---|
| `beap-messages/services/__tests__/BeapPackageBuilder.test.ts` | Unit | qBEAP policy gate, transport leakage guard, public/private config, automation tag extraction | Handshake state checks, accept flow, requestId matching, multi-handshake collision |
| `beap-messages/services/__tests__/beapCrypto.test.ts` | Unit | AEAD encrypt/decrypt, HKDF, chunking, AAD | Handshake-level key agreement, fingerprint derivation |
| `beap-builder/__tests__/parserService.test.ts` | Unit | Attachment parsing, semantic-content-not-in-transport guard | No handshake concerns |
| `policy/engine/__tests__/evaluator.test.ts` | Unit | Policy evaluator | No handshake-specific override intersection |
| `policy/engine/__tests__/intersection.test.ts` | Unit | Policy intersection | No handshake override ceiling enforcement |
| `electron/main/vault/tierResolution.test.ts` | Unit | `resolveTier`, `mapRolesToTier` | No handshake tier gating |
| `electron/main/vault/capabilityGate.test.ts` | Unit | Vault capability gate | No handshake access control |
| `electron/main/vault/rpcAuth.test.ts` | Unit | RPC auth, VSBT binding | Not related to BEAP handshake |
| `electron/main/vault/vsbt.test.ts` | Unit | VSBT validation | Not related to BEAP handshake |
| `electron/main/vault/security-regression.test.ts` | Unit | Vault security regressions | No handshake scenarios |
| `electron/main/vault/sessionLock.test.ts` | Unit | Session lock | No handshake lock behavior |
| `electron/main/vault/atomicWrite.test.ts` | Unit | Atomic file write | Not handshake-related |
| `electron/main/vault/documentService.test.ts` | Unit | Document vault | Not handshake-related |
| `electron/main/vault/envelope.test.ts` | Unit | Record envelope encryption | Not handshake-related |
| `electron/main/vault/lazyDecrypt.test.ts` | Unit | Lazy decrypt | Not handshake-related |

**Zero tests exist for:**
- Handshake state transitions
- `completeHandshakeFromAccept` correctness / multi-handshake collision
- `createFromIncomingRequest` correctness
- Handshake accept payload transmission via email
- Fingerprint derivation from X25519 key (no test)
- Expiry checking on incoming handshake request
- Revocation (no implementation to test)
- VERIFIED_WR upgrade path (no implementation)
- Asymmetric sharing (not implemented)
- Handshake-scoped policy ceiling enforcement

---

## Phase 3 — Misalignment Report

| Concern | Status | Current Location(s) | Gap Description | Action |
|---|---|---|---|---|
| State machine — states | 🟡 Partial | `handshake/types.ts` | Three states exist (`PENDING/LOCAL/VERIFIED_WR`) but `EXPIRED` and `REVOKED` are missing. `VERIFIED_WR` is unreachable. | Add missing states; wire upgrade path |
| State machine — transitions | 🔴 Misaligned | `handshake/useHandshakeStore.ts` | No pipeline runner. Transitions are raw store mutations. No validation logic. | Rewrite with validated pipeline runner |
| State machine — accept matching | 🔴 Misaligned | `useHandshakeStore.ts:282-286` | `completeHandshakeFromAccept` matches on first-pending, not requestId. Multi-handshake collision guaranteed. | Fix matching by requestId + senderFingerprint |
| Transport — email only (send) | 🟡 Partial | `deliveryService.ts`, `types.ts` | Email path exists and is correct. Messenger path (`sendViaMessenger`) also wired and must not be used for handshake-bound sends. | Remove or gate messenger path from handshake send |
| Transport — email only (receive) | 🔴 Misaligned | `ingress/importPipeline.ts` | `importFromEmail` is a stub returning mock data. Real email receipt not wired. | Wire Electron email gateway pull to ingress pipeline |
| Capsule parsing | 🟡 Partial | `ingress/importPipeline.ts` | Minimal regex check only. No structural parsing. | Acceptable for import step; real parsing is in beapDecrypt |
| Capsule serialization | 🟢 Aligned | `beap-messages/services/BeapPackageBuilder.ts` | Full serialization implemented with AAD, chunking, signing. | Keep as-is |
| Context blocks — storage | 🟢 Aligned | `HANDSHAKE_CONTEXT.md`, `vault/types.ts`, `service.ts` | Context items stored in vault_items with binding policy. | Keep |
| Context blocks — exchange | ⚫ Missing | — | Context blocks are never automatically exchanged during accept. No auto-attachment to outgoing accept payload. | Build from scratch |
| Context blocks — dedup | ⚫ Missing | — | No dedup or versioning of context blocks across handshake updates. | Build from scratch |
| Sharing model — asymmetric | ⚫ Missing | — | All handshakes are symmetric. No concept of receive-only or one-way identity share. | Build from scratch |
| Accept — reciprocal key exchange | 🔴 Misaligned | `useHandshakeStore.ts` | Accept payload is built and stored locally but **never transmitted back** to initiator. Initiator never receives acceptor's key. | Wire accept transmission via email |
| Tier gate — handshake creation | ⚫ Missing | — | Any authenticated user can create a handshake. No tier gating. | Determine required tier and enforce |
| Tier gate — Full-Auto (ALLOW) | ⚫ Missing | — | No tier gate on setting `automation_mode = 'ALLOW'`. | Determine and enforce |
| Tier gate — qBEAP | ⚫ Missing | — | qBEAP usage is controlled by `recipientMode`, not tier. | Determine required tier and enforce |
| Policy — receiver policy | 🟡 Partial | `policy/schema/domains/handshake-overrides.ts` | Schema defined. Not wired to handshake state machine or envelope evaluation. | Wire receiver policy check into evaluation pipeline |
| Policy — capsule policy intersection | 🟡 Partial | `policy/engine/intersection.ts` | Implemented and tested. Not called from envelope evaluation for handshake-specific overrides. | Wire intersection into evaluation |
| Policy — ceiling enforcement | 🔴 Misaligned | `handshake-overrides.ts:201` | `mergeWithGlobalPolicy()` does not enforce ceiling (override can exceed global). | Fix ceiling enforcement |
| Revocation | ⚫ Missing | — | No revocation state, no crypto-erase, no cleanup pipeline. | Build from scratch |
| WRVault — gating | 🟢 Aligned | `vault/service.ts`, `capabilities.ts` | Capability gate on vault item access by tier is implemented. | Keep |
| WRVault — key management | 🟡 Partial | `x25519KeyAgreement.ts`, `beapCrypto.ts` | X25519 device keypair stored in `chrome.storage.local` (unencrypted). Ed25519 signing key is ephemeral. | Migrate keypairs to encrypted vault storage |
| Keycloak / SSO — session handling | 🟢 Aligned | `auth/session.ts`, `auth/jwtVerify.ts`, `auth/capabilities.ts` | JWT-based session, per-request tier resolution, `email_verified` check. | Keep |
| Key management — handshake-derived keys | 🟡 Partial | `beapCrypto.ts:deriveBeapKeys()` | Keys derived from X25519 ECDH shared secret per-envelope. Not stored (ephemeral per send). | Acceptable for envelope keys. ML-KEM path incomplete. |
| Key management — zeroing on lock | 🔴 Misaligned | `x25519KeyAgreement.ts`, `beapCrypto.ts` | X25519 device key not zeroed on vault lock. Ed25519 key lost on reload but not actively zeroed. | Implement zeroize on lock for both |
| IPC — main ↔ extension | 🟢 Aligned | `main.ts`, `rpc.ts`, WebSocket | WebSocket RPC with VSBT binding is the correct IPC channel. | Keep |
| IPC — handshake events | ⚫ Missing | — | No IPC event when handshake state changes (e.g., incoming accept arrives via email). Extension not notified. | Add handshake events over WebSocket |
| SQLite — handshake schema | ⚫ Missing | — | No `handshakes` table in SQLite. All state in `chrome.storage.local`. | Add encrypted handshake table to vault DB |
| SQLite — migration tracking | 🟡 Partial | `vault/db.ts` | Additive migrations via try/catch. No version table. | Add migration version tracking |
| Embeddings | ⚫ Missing | — | No embedding generation or search in handshake context. | Not required for MVP — defer |
| Cloud AI / external processing | 🟢 Aligned | Codebase | No cloud AI references in handshake paths. All crypto local. | Keep |
| LWM / Optimando boundary | 🟢 Aligned | LLM is isolated in `electron/main/llm/` | LLM does not touch handshake state. | Keep |
| UX — preview screens | 🟢 Aligned | `HandshakeAcceptModal.tsx`, `HandshakeDetailsPanel.tsx` | Accept/reject UI exists and is correct structurally. | Keep |
| UX — confirmation flows | 🟡 Partial | `HandshakeAcceptModal.tsx` | Confirmation UI exists. But accept action does not transmit accept payload. | Fix transmission |
| P2P transport paths | 🗑️ Remove | `P2PChatPlaceholder.tsx`, `P2PStreamPlaceholder.tsx`, `GroupChatPlaceholder.tsx` | Explicitly placeholder, never functional, not in scope for email-transport handshake. | Delete |
| Messenger transport for handshake send | 🗑️ Remove | `deliveryService.ts:sendViaMessenger()`, `handshake/types.ts:delivery_method` | Out of scope for handshake sends. Messenger paste import for receiving may remain. | Remove messenger from handshake delivery_method enum; remove sendViaMessenger call path from handshake send |
| Tests — handshake state machine | ⚫ Missing | — | Zero tests for any handshake state transition. | Build from scratch |
| Tests — accept transmission | ⚫ Missing | — | Zero tests for accept payload email delivery. | Build from scratch |
| Tests — requestId matching | ⚫ Missing | — | Zero tests for collision scenario. | Build from scratch |

---

## Phase 4 — Dependency Graph of Handshake-Touching Code

```
apps/extension-chromium/src/handshake/types.ts
  ← imported by:
      handshake/handshakeService.ts
      handshake/handshakePayload.ts
      handshake/useHandshakeStore.ts
      handshake/components/HandshakeAcceptModal.tsx
      handshake/components/HandshakeDetailsPanel.tsx
      handshake/components/HandshakeSelectItem.tsx
      beap-builder/canonical-types.ts
      beap-messages/components/RecipientHandshakeSelect.tsx
      beap-messages/hooks/useBeapDraftActions.ts
  → imports: (none — leaf type module)

apps/extension-chromium/src/handshake/useHandshakeStore.ts
  ← imported by:
      beap-messages/services/beapDecrypt.ts          ⚠️ direct state read in Stage 0
      beap-messages/services/BeapPackageBuilder.ts   (via selectedRecipient)
      beap-messages/components/RecipientHandshakeSelect.tsx
      beap-messages/hooks/useBeapDraftActions.ts
      handshake/index.ts
      handshake/components/HandshakeAcceptModal.tsx  (implicit via parent)
  → imports:
      handshake/types.ts
      handshake/fingerprint.ts
      zustand

apps/extension-chromium/src/handshake/handshakeService.ts
  ← imported by:
      handshake/index.ts
      (no direct import by store — service is called from UI hooks)
  → imports:
      handshake/types.ts
      handshake/fingerprint.ts
      beap-messages/services/x25519KeyAgreement.ts
      beap-messages/services/beapCrypto.ts

apps/extension-chromium/src/handshake/fingerprint.ts
  ← imported by:
      handshake/handshakeService.ts
      handshake/useHandshakeStore.ts
      beap-builder/sendPipeline.ts                   ⚠️ imports generateMockFingerprint
  → imports: (none — leaf utility)

apps/extension-chromium/src/beap-messages/services/beapCrypto.ts
  ← imported by:
      beap-messages/services/BeapPackageBuilder.ts
      beap-messages/services/beapDecrypt.ts
      handshake/handshakeService.ts
  → imports:
      @noble/ed25519
      (calls Electron HTTP for PQ operations)

apps/extension-chromium/src/beap-messages/services/x25519KeyAgreement.ts
  ← imported by:
      beap-messages/services/beapCrypto.ts
      beap-messages/services/beapDecrypt.ts
      handshake/handshakeService.ts
  → imports:
      @noble/curves/ed25519
      chrome.storage.local                           ⚠️ unencrypted key storage

apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
  ← imported by:
      beap-messages/hooks/useBeapDraftActions.ts
      beap-messages/services/__tests__/BeapPackageBuilder.test.ts
  → imports:
      beap-messages/services/beapCrypto.ts
      beap-messages/services/x25519KeyAgreement.ts
      handshake/types.ts (via RecipientMode, SelectedRecipient)

apps/extension-chromium/src/ingress/importPipeline.ts
  ← imported by:
      ingress/components/ImportEmailModal.tsx
      ingress/components/ImportFileModal.tsx
      ingress/components/ImportMessengerModal.tsx
  → imports:
      ingress/types.ts
      ingress/useIngressStore.ts
      beap-messages/useBeapMessagesStore.ts
      wrguard (useWRGuardStore)

apps/extension-chromium/src/envelope-evaluation/evaluateEnvelope.ts
  ← imported by:
      envelope-evaluation/useVerifyMessage.ts
  → imports:
      envelope-evaluation/types.ts
      wrguard (useWRGuardStore)

apps/extension-chromium/src/policy/schema/domains/handshake-overrides.ts
  ← imported by:
      policy/schema/domains/index.ts
      policy/schema/policy.schema.ts
  → imports:
      zod
      policy/schema/domains/session-restrictions.ts

apps/electron-vite-project/electron/main/vault/service.ts
  ← imported by:
      electron/main/vault/rpc.ts
      electron/main.ts (via getVaultService())
  → imports:
      vault/types.ts (HandshakeBindingPolicy, canAttachContext)
      vault/crypto.ts
      vault/db.ts
      vault/envelope.ts
      vault/cache.ts
      vault/unlockProvider.ts

apps/electron-vite-project/electron/main.ts
  ← nothing imports it (entry point)
  → imports:
      vault/rpc.ts
      email/gateway.ts
      email/ipc.ts
      llm/*.ts
      ocr/*.ts
      policy/*.ts
      (calls /api/vault/handshake/evaluate)

⚠️ FLAGGED: beap-builder/sendPipeline.ts imports generateMockFingerprint from handshake/fingerprint.ts
   This couples the send pipeline to mock data. Must be removed.

⚠️ FLAGGED: beap-messages/services/beapDecrypt.ts reads directly from useHandshakeStore (Zustand/chrome.storage)
   This couples the decryption service to the browser extension store rather than an abstract key provider.
   If handshakes migrate to SQLite, this coupling must be updated.

⚠️ FLAGGED: beap-messages/services/beapCrypto.ts calls 127.0.0.1:17179 for PQ KEM operations
   If Electron is not running, all PQ operations fail silently (available = false, treated as non-PQ).
   This is acceptable for graceful degradation but must be documented.

No circular dependencies detected.
```

---

## Phase 5 — Cleanup Plan (Ordered)

### Priority 1: Remove (delete dead / out-of-scope code)

1. **`apps/extension-chromium/src/ui/components/P2PChatPlaceholder.tsx`** — Delete. P2P chat is explicitly out of scope. All content is disabled placeholders.
2. **`apps/extension-chromium/src/ui/components/P2PStreamPlaceholder.tsx`** — Delete. Same reason.
3. **`apps/extension-chromium/src/ui/components/GroupChatPlaceholder.tsx`** — Delete. Out of scope for handshake transport layer.
4. **`beap-builder/deliveryService.ts → sendViaMessenger()`** — Delete the function body. Keep the function signature returning a `not_supported` error if needed for graceful failure.
5. **`handshake/types.ts → HandshakeRequest.delivery_method`** — Remove `'messenger'` from the union. Keep `'email' | 'download'` (download for file-based handshake tokens).
6. **`handshake/useHandshakeStore.ts → initializeWithDemo()`** — Remove or gate behind `DEV_ONLY` build flag. Demo data with `isMock: true` must not initialize in production stores.
7. **`beap-builder/sendPipeline.ts → import { generateMockFingerprint }`** — Remove this import. Sender fingerprint must come from `getOurIdentity()` in `handshakeService.ts`.
8. **`handshake/fingerprint.ts → generateFingerprintSync()`** — Remove (weak non-SHA-256 hash). Replace call sites with `generateFingerprint()` (async SHA-256) or an explicit dev-only shim.

### Priority 2: Decouple (break wrong dependencies)

1. **`beap-messages/services/beapDecrypt.ts` → direct `useHandshakeStore` read** — Introduce an abstract `KeyProvider` interface. Decryption service should call `KeyProvider.getHandshakeKey(handshakeId)` not read from the Zustand store directly. This allows migration to SQLite without changing decryption logic.
2. **`ingress/importPipeline.ts → importFromEmail()` stub** — Replace stub with a real call to Electron email gateway HTTP endpoint. Decouple from mock payload generation.
3. **`envelope-evaluation/evaluateEnvelope.ts → verifyEnvelope()` stub** — Wire real signature verification. This function must call the crypto layer, not just check field presence. Until then, flag all accepted messages as `signature_unverified` rather than passing them through.
4. **`handshake/useHandshakeStore.ts → completeHandshakeFromAccept()` matching** — Fix to match on `senderFingerprint + createdAt → requestId` hash, not first-pending. The `requestId` derivation must be consistent between sender and acceptor.
5. **`policy/schema/domains/handshake-overrides.ts → mergeWithGlobalPolicy()`** — Add ceiling enforcement before returning merged policy. Override values must be clamped to global policy maxima.

### Priority 3: Preserve (keep and note for reuse)

1. **`handshake/handshakePayload.ts`** — Fail-closed wire format parsing. Reuse as-is. The implementation prompt must not re-implement this.
2. **`handshake/handshakeService.ts → getOurIdentity()` / `createHandshakeRequestPayload()` / `createHandshakeAcceptPayload()`** — Correct cryptographic identity logic. Reuse directly.
3. **`beap-messages/services/beapCrypto.ts`** — Complete crypto suite. Reuse entirely.
4. **`beap-messages/services/x25519KeyAgreement.ts`** — Correct ECDH implementation. Reuse; migration to vault storage is a separate step.
5. **`beap-messages/services/BeapPackageBuilder.ts`** — Outbound package builder is correct. Reuse. Only the sender fingerprint sourcing needs to be fixed.
6. **`envelope-evaluation/evaluateEnvelope.ts`** — Three-step structure is architecturally correct. Preserve structure; replace `verifyEnvelope()` stub with real implementation.
7. **`policy/engine/intersection.ts` + `evaluator.ts`** — Policy engine is implemented and tested. Reuse; wire into handshake evaluation.
8. **`handshake/components/HandshakeAcceptModal.tsx`** — UX is correct. Preserve. Fix the action callback to trigger accept payload email send.
9. **`vault/service.ts → evaluateAttach()`** — Handshake context attachment evaluation is correctly implemented. Preserve.

### Priority 4: Stub (create clean interfaces for new code)

The implementation prompt must create or receive the following:

1. **`HandshakeStateMachine` pipeline runner** — A step-validated transition function: `transition(id: string, event: HandshakeEvent) → Result`. Events: `SEND_REQUEST | RECEIVE_ACCEPT | VERIFY_WR | EXPIRE | REVOKE`.
2. **`VerifiedCapsuleInput` type** — Typed input to decryption that requires `handshakeId`, `verifiedFingerprint`, and `receivedAt`. Prevents decryption from proceeding on unverified material.
3. **`KeyProvider` interface** — Abstract key lookup: `getX25519PrivateKey(keyId): Uint8Array | null`. Decryption service depends on this, not on `useHandshakeStore`.
4. **`HandshakeRecord` SQLite table** — Schema for encrypted handshake storage in vault DB. Minimum columns: `id`, `status`, `fingerprint_full`, `peer_x25519_pub`, `local_x25519_key_id`, `automation_mode`, `created_at`, `updated_at`, `expires_at`, `revoked_at`.
5. **`AcceptTransmissionService`** — Service that sends the accept payload back to initiator via email after `createFromIncomingRequest` completes.
6. **`HandshakeIPCEvent` type** — WebSocket event to push to the extension when handshake state changes (e.g., `HANDSHAKE_ACCEPTED`, `HANDSHAKE_EXPIRED`).

---

## Phase 6 — Risk Register

| Risk | Severity | Description | Mitigation |
|---|---|---|---|
| Accept payload never transmitted | **Critical** | When a user accepts an incoming handshake request, the accept payload containing their X25519 public key is stored locally but never sent back to the initiator. The initiator cannot encrypt to the acceptor. | Implement `AcceptTransmissionService` that sends the accept payload as an email attachment to the initiator's recorded email address. Must be atomic with state transition. |
| Orphaned PENDING handshakes | **High** | If the initiator's app is reset or `chrome.storage` is cleared, pending outgoing handshakes are lost. The initiator cannot match incoming accepts. | Add `expiresAt` enforcement. On reload, scan pending handshakes — those past expiry are auto-expired. Add `requestId` to email so accept payload can be correlated even after store loss. |
| First-pending collision | **High** | `completeHandshakeFromAccept` matches first pending handshake in store. Two simultaneous outgoing requests would cause both accepts to complete the same handshake. | Fix matching: derive requestId hash client-side and match on full `requestId` + `senderFingerprint`. |
| X25519 private key in unencrypted storage | **High** | Device X25519 private key is stored in `chrome.storage.local` — not encrypted. Any extension with `storage` permission or `chrome.storage` API access could read it. | Migrate key storage to Electron vault (SQLite + SQLCipher). Key retrieval requires vault unlock. |
| Handshake state not in encrypted vault | **High** | All handshake records (including fingerprints, peer keys, automation modes) live in `chrome.storage.local`. Not encrypted at rest. | Create `handshakes` table in vault SQLite DB. Migrate state persistence to encrypted store. |
| Envelope verification is a stub | **High** | `verifyEnvelope()` checks field presence only. Any JSON blob with the right shape passes. There is no real signature verification. | Implement real Ed25519 signature verification in `verifyEnvelope()`. Until then, mark all messages as `signature_unverified` in the store and do not allow automation on them. |
| Broken IPC for new handshake events | **Medium** | Extension has no WebSocket event handler for handshake state changes. If an email arrives with an accept payload, the extension is not notified. | Add `HANDSHAKE_*` event types to the WebSocket RPC protocol and add handlers in background.ts. |
| Demo data in production store | **Medium** | `initializeWithDemo()` seeds mock handshakes with `isMock: true` into the live store on first load if the store is empty. A user who has never set up handshakes gets mock entries. | Gate `initializeWithDemo()` behind a `DEV_ONLY` build flag or remove entirely. Let the store start empty. |
| P2P placeholders in UI surface | **Low** | P2P Chat and P2P Stream placeholder components are rendered in the mode selector. Users may attempt to use them. | Delete the placeholder components entirely. Remove from `ModeSelect.tsx` or replace with "Coming Soon" non-interactive labels. |
| Messenger delivery_method on HandshakeRequest | **Medium** | The `HandshakeRequest` type includes `'messenger'` as a valid delivery method. If the send pipeline is called with this value, it will attempt clipboard injection — not email. | Remove `'messenger'` from `delivery_method` union. Fail at type level if messenger is passed. |
| ML-KEM always skipped | **Medium** | PQ keys are never included in handshake requests or accepts (`// ML-KEM: Not included for now`). Handshake is X25519-only despite canon requirement for PQ-hybrid qBEAP. | Complete ML-KEM integration: include `senderMlkem768PublicKeyB64` in handshake request payloads and acceptor payloads. |
| Ed25519 signing key lost on reload | **Low** | `_ephemeralSigningKey` is in-memory. Every extension reload generates a new signing keypair. Old signatures cannot be verified with new key. | Migrate signing keypair to vault storage (same as X25519). Alternatively, clarify if signing is per-session-intentional. |
| Policy ceiling not enforced | **Medium** | `mergeWithGlobalPolicy()` allows handshake override to exceed global policy maxima. An `automation_partner` override on a handshake could grant permissions beyond what the global policy allows. | Enforce ceiling in merge function before returning. |

---

## Phase 7 — Questions / Ambiguities

- **Q1:** Should the handshake accept payload be transmitted automatically, or must the user explicitly confirm sending it?
  - Context: `HandshakeAcceptModal.tsx` has an "Accept" button that calls `onAccept(automationMode)`. The store method `createFromIncomingRequest` is called but no email is sent.
  - Impact: Determines whether the transmission is synchronous with the UI action or async in background. If explicit confirmation is required, a second dialog step is needed.

- **Q2:** What is the exact `delivery_method` scope for outgoing handshake requests?
  - Context: Current `HandshakeRequest.delivery_method` is `'email' | 'messenger' | 'download'`. Target architecture says email only, but file download (USB exchange) is a common alternative.
  - Impact: If download (file transfer) is in scope, the `importFromFile` path must handle `HandshakeRequestPayload` JSON files, not just BEAP packages.

- **Q3:** Is `VERIFIED_WR` intended for a future WR Desk server verification flow, or is it deprecated?
  - Context: No code sets `status = 'VERIFIED_WR'` except demo data. No WR Desk server integration exists.
  - Impact: If this state is still planned, a stub upgrade path (HTTP call to `wrdesk.com`) needs to be scaffolded. If deprecated, the state should be removed.

- **Q4:** Should the X25519 device keypair be per-user or per-device?
  - Context: Current implementation creates a single keypair stored in `chrome.storage.local` (device-bound). If the same Keycloak user logs in on two browsers, they have two different identities with different fingerprints.
  - Impact: If per-user semantics are required, the keypair must be stored in the vault (which is login-gated) and synced (or the user must re-establish handshakes on each device).

- **Q5:** What happens to existing handshake state when the vault is locked?
  - Context: Vault lock zeroes the DEK but does not affect `chrome.storage.local`. Handshake records (including peer X25519 keys) remain accessible in `chrome.storage.local` after vault lock.
  - Impact: If the threat model requires that handshake key material is inaccessible while vault is locked, keys must move to vault storage and be zeroed on lock.

- **Q6:** Is the Postgres adapter (`storage/PostgresAdapter.ts`, `storage/migrations.ts`) active in production or development-only?
  - Context: Both SQLite (vault) and Postgres (orchestrator KV store) are present. The handshake schema must go into one of them.
  - Impact: If Postgres is the orchestrator's authoritative store, should handshake records that are needed by the orchestrator (e.g., for policy evaluation) go into Postgres rather than SQLite?

- **Q7:** What is the intended behavior when `pqEncapsulate()` fails (Electron not running or ML-KEM unavailable)?
  - Context: `pqKemSupported()` returns `false` when Electron is unreachable. `BeapPackageBuilder` proceeds with X25519-only in that case. Canon A.3.13 says qBEAP MUST use PQ. The current graceful degradation directly violates canon.
  - Impact: Must determine if PQ failure is a hard block (refuse to build qBEAP package) or soft degradation (build X25519-only and mark in metadata).

- **Q8:** Does the `automation_mode` on a handshake override the policy engine's intersection, or does the policy engine take precedence?
  - Context: `useHandshakeStore` stores `automation_mode: 'DENY' | 'REVIEW' | 'ALLOW'`. The policy engine (`policy/engine/evaluator.ts`) evaluates per-handshake overrides independently. The relationship between the store's `automation_mode` and the policy engine's `HandshakeAutomationPermissions.mode` is undefined.
  - Impact: Must define precedence order. The policy engine's handshake override schema has a more granular mode enum (`strict | restrictive | standard | permissive | automation_partner`) — this does not map 1:1 to the store's `DENY | REVIEW | ALLOW`.

- **Q9:** Is `importFromMessenger()` (paste import) in scope for receiving handshake request payloads?
  - Context: `importFromMessenger` currently calls `importBeapMessage` with `source = 'messenger'`. A user could paste a `HandshakeRequestPayload` JSON into the messenger import field.
  - Impact: If messenger paste is an acceptable ingress path for handshake requests (not full capsules), the import pipeline must detect and route `HandshakeRequestPayload` vs `BEAP_PACKAGE` appropriately.

- **Q10:** Are there any planned capabilities that depend on handshake state being in SQLite for cross-process access?
  - Context: Currently handshake state is only accessible in the extension process (via `useHandshakeStore`). The Electron main process (`main.ts`) has no access to handshake records.
  - Impact: If Electron needs to make handshake-aware decisions (e.g., auto-routing incoming emails to correct handshake recipient, applying per-handshake policy in email gateway), state must be in SQLite.

---

*End of PREFLIGHT_ANALYSIS.md*
