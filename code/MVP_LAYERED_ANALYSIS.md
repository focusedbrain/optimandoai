# MVP Layered Analysis — BEAP System

**Date:** 2025-03-15  
**Purpose:** Per-layer state, component map, critical path, and consolidated MVP execution plan.

---

═══════════════════════════════════════════════════════════════════
LAYER 1: Ingestion
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
Path A (Electron .beap file) works end-to-end: drop → IPC → p2p_pending_beap → usePendingP2PBeapIngestion → importBeapMessage → verifyImportedMessage → sandboxDepackage → addMessage → inbox. Path A (Extension) imports but does not auto-verify; message stays "pending verification." Path B (email) detects handshake capsules only; qBEAP/pBEAP message packages in email body/attachments are not detected (detectBeapInBody matches capsule_type, not header/metadata/envelope). Path C (P2P) receives handshake capsules; message packages go to p2p_pending_beap but validateCapsule rejects them (requires capsule_type). Path D (relay) same — message packages rejected. MVP demo needs Path A1 (Electron) working — it does.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| Electron file drop | BeapMessageImportZone.tsx | processFile, window.handshakeView.importBeapMessage | ✅ | — |
| Extension file import | importPipeline.ts | importFromFile, importBeapMessage | ⚠️ | No auto-verify |
| p2p_pending_beap insert | main.ts, db.ts | insertPendingP2PBeap | ✅ | — |
| Pending ingestion poll | usePendingP2PBeapIngestion.ts | Poll 5s, getPendingP2PBeapMessages | ✅ | — |
| Email sync | beapSync.ts | runBeapSyncCycle, detectBeapInBody | ⚠️ | Only handshake; no qBEAP/pBEAP |
| P2P ingest | p2pServer.ts | /beap/ingest → processIncomingInput | ⚠️ | Message packages rejected |
| Relay pull | relayPull.ts | Fetch, processIncomingInput | ⚠️ | Message packages rejected |

CRITICAL PATH TO MVP:
1. None for demo — Path A1 (Electron) is sufficient.
2. (Optional) Extension: Add auto-verify after importFromFile so extension import matches Electron UX.
3. (Deferred) Email: Extend detectBeapInBody or add parallel detector for header+metadata+envelope.
4. (Deferred) P2P/Relay: Route message packages to p2p_pending_beap instead of ingestion-core validateCapsule.

DEPENDENCIES:
- Layer 2 (Validation): ingestion-core used for handshake capsules; message packages bypass it.
- Layer 3 (Depackaging): verifyImportedMessage calls sandboxDepackage; must succeed for addMessage.

---

═══════════════════════════════════════════════════════════════════
LAYER 2: Validation
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
ingestion-core (ingestor, validator, distributionGate, pipeline) is complete and wired. It validates handshake capsules (initiate, accept, refresh, revoke, context_sync, internal_draft) with size/depth/field limits, prototype pollution guard, and routes by capsule_type. BEAP message packages (qBEAP/pBEAP) have header/metadata/envelope — no capsule_type — so they bypass ingestion-core entirely and go to p2p_pending_beap → extension sandbox depackaging. No beapStructuralValidator.ts exists for .beap structure; parseBeapFile does minimal checks (header, signature, metadata). For MVP demo, validation is not a blocker — message packages skip this layer.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| Ingestor | ingestion-core/ingestor.ts | ingestInput | ✅ | — |
| Validator | ingestion-core/validator.ts | validateCapsule | ✅ | Handshake only |
| Distribution gate | ingestion-core/distributionGate.ts | routeValidatedCapsule | ✅ | — |
| Pipeline | ingestion-core/pipeline.ts | validateInput | ✅ | — |
| processIncomingInput | ingestionPipeline.ts | ingest → validate → distribute | ✅ | — |
| beapStructuralValidator | — | — | ❌ | Does not exist |
| parseBeapFile | beapDecrypt.ts | Minimal header/signature/metadata | ⚠️ | No size/depth/fields |

CRITICAL PATH TO MVP:
1. None for demo — message packages bypass ingestion-core; parseBeapFile suffices for depackaging entry.
2. (Pod/server mode) Add beapStructuralValidator for .beap pre-filter: size, depth, fields, prototype pollution.

DEPENDENCIES:
- None from other layers for handshake path.
- Pod pre-filter would depend on Layer 3 (depackaging) for full pipeline.

---

═══════════════════════════════════════════════════════════════════
LAYER 3: Depackaging
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
The 6-gate depackaging pipeline (depackagingPipeline.ts) and decryptBeapPackage (beapDecrypt.ts) work. pBEAP passes all gates; qBEAP requires handshake keys (peerX25519PublicKey, peerPQPublicKey). The Chrome extension sandbox (sandbox.ts) runs depackaging in an isolated iframe via postMessage; sandboxClient.ts relays requests. Electron uses the same sandbox (sandboxClient) when extension context is available. ML-KEM calls go to Electron HTTP (127.0.0.1:17179). Key storage (x25519, signing) uses chrome.storage.local. For MVP demo with pBEAP, depackaging works. qBEAP needs new handshakes with key exchange. Pod (Node replacement for sandbox) does not exist.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| 6-gate pipeline | depackagingPipeline.ts | runDepackagingPipeline | ✅ | — |
| Decrypt orchestrator | beapDecrypt.ts | decryptBeapPackage | ✅ | — |
| Chrome sandbox | sandbox.ts | handleMessage → decryptBeapPackage | ✅ | Browser-only |
| Sandbox client | sandboxClient.ts | create, request, postMessage | ✅ | — |
| verifyImportedMessage | importPipeline.ts | sandboxDepackage | ✅ | — |
| ML-KEM | beapCrypto.ts | fetch(127.0.0.1:17179) | ⚠️ | Electron required for qBEAP |
| Key storage | x25519KeyAgreement, signingKeyVault | chrome.storage.local | ⚠️ | Extension/Electron |
| Pod HTTP server | — | — | ❌ | Does not exist |
| Pod Containerfile | — | — | ❌ | Does not exist |

CRITICAL PATH TO MVP:
1. None for pBEAP demo — sandbox + pipeline work.
2. (qBEAP) Ensure handshakes have peer_x25519_public_key_b64, peer_mlkem768_public_key_b64; RecipientHandshakeSelect passes them.
3. (Pod, post-MVP) Extract depackaging to Node package; add HTTP server; Containerfile; injectable key provider.

DEPENDENCIES:
- Layer 1: verifyImportedMessage receives raw package from import pipeline.
- Layer 4: addMessage receives sanitised package from depackaging.

---

═══════════════════════════════════════════════════════════════════
LAYER 4: Inbox Store & Routing
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
useBeapInboxStore (addMessage, getInboxMessages, getHandshakeMessages, selectMessage) works. sanitisedPackageToBeapMessage produces BeapMessage with urgency: 'normal', isRead: false. Messages appear in getInboxMessages() and getHandshakeMessages(handshakeId). BeapInboxDashboard (Electron) and BeapInboxView (extension) render the list. BeapMessageDetailPanel shows split view (content | AI panel). Selection and routing to detail panel work. No critical gaps for MVP.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| Inbox store | useBeapInboxStore.ts | addMessage, getInboxMessages, getHandshakeMessages | ✅ | — |
| Sanitised → message | sanitisedPackageToBeapMessage.ts | Map pkg → BeapMessage | ✅ | — |
| Electron inbox | BeapInboxDashboard.tsx | 3-col layout, list, detail, import | ✅ | — |
| Extension inbox | BeapInboxView.tsx | Sidebar, detail panel | ✅ | — |
| Detail panel | BeapMessageDetailPanel.tsx | Split view, content, AI panel | ✅ | — |

CRITICAL PATH TO MVP:
1. None — store and routing are complete.

DEPENDENCIES:
- Layer 3: addMessage receives sanitised package from depackaging.
- Layer 5: AI features consume store data.

---

═══════════════════════════════════════════════════════════════════
LAYER 5: AI Inbox
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
useBulkClassification (startClassification, classifyBatch, batchClassify) works; runStage61Gate per message; grid reorders by urgency. useReplyComposer (generateAiDraft, sendReply) works but aiProvider is not passed in either extension or Electron — "Draft with AI" shows "No AI provider configured." Auto-tidy (scheduleDeletion, purgeExpiredDeletions, PendingDeleteOverlay) works. Search bar routing (pendingInboxAiRef) works in extension when in BEAP inbox with message selected; Electron has no integrated search bar. Attachment reader (BeapAttachmentReader, semanticContent) works when sender included semanticContent; AttachmentRow has warning dialog. pBEAP often has processingEvents: null → classification stays 'normal'.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| Bulk classification | useBulkClassification.ts | startClassification, classifyBatch | ✅ | — |
| Classification engine | beapClassificationEngine.ts | classifySingleMessage, gateMessage | ✅ | — |
| Grid reorder | BeapBulkInbox.tsx | sortedMessages by urgency | ✅ | — |
| Reply composer | useReplyComposer.ts | generateAiDraft, sendReply | ⚠️ | aiProvider not passed |
| BeapMessageDetailPanel | BeapMessageDetailPanel.tsx | replyComposerConfig prop | ⚠️ | No aiProvider from parent |
| BeapInboxDashboard | BeapInboxDashboard.tsx | — | ⚠️ | Does not pass replyComposerConfig |
| BeapInboxView | BeapInboxView.tsx | replyComposerConfig | ⚠️ | Only senderFingerprint, no aiProvider |
| Auto-tidy | useBulkClassification, PendingDeleteOverlay | scheduleDeletion, purgeExpiredDeletions | ✅ | — |
| Search bar routing | sidepanel.tsx | handleSendMessage, pendingInboxAiRef | ⚠️ | Extension only; Electron no search bar |
| Attachment reader | BeapMessageDetailPanel, BeapAttachmentReader | semanticContent display | ✅ | — |

CRITICAL PATH TO MVP:
1. Wire aiProvider into replyComposerConfig: extension from processFlow/agent; Electron from main via IPC (getProvider).
2. Pass replyComposerConfig (with aiProvider) from BeapInboxDashboard to BeapMessageDetailPanel.
3. (Optional) Add fallback processingEvents for pBEAP so heuristic classification can run.
4. (Optional) Electron: Add search bar + pendingInboxAiRef routing if demo needs it.

DEPENDENCIES:
- Layer 4: Messages from store; selectedMessageId.
- External: AI provider (OpenAI, etc.) for classification and draft generation.

---

═══════════════════════════════════════════════════════════════════
LAYER 6: Outbound
═══════════════════════════════════════════════════════════════════

CURRENT STATE SUMMARY:
Path A (Download) works: buildPackage → executeDownloadAction → Blob + anchor click. buildResult.package fix applied. PRIVATE + download uses executeDeliveryAction (not sendViaHandshakeRefresh). Path B (Email) is a stub — executeEmailAction simulates 500ms, no real send. Path C (P2P) implemented in Electron (enqueueOutboundCapsule, processOutboundQueue); extension needs backend. Path D (Relay) not explicitly implemented. Handshake key exchange (X25519, ML-KEM) applied for new handshakes; existing ACTIVE handshakes need re-establish for qBEAP. MVP demo needs Download — it works.

COMPONENT MAP:

| Component | File | Function | Status | Blocker |
|-----------|------|----------|--------|---------|
| Package builder | BeapPackageBuilder.ts | buildPackage | ✅ | — |
| executeDeliveryAction | BeapPackageBuilder.ts | Route by deliveryMethod | ✅ | — |
| executeDownloadAction | BeapPackageBuilder.ts | Blob, createObjectURL, anchor click | ✅ | — |
| executeEmailAction | BeapPackageBuilder.ts | buildEmailTransportContract, simulate | ❌ | Stub; no real send |
| executeP2PAction | BeapPackageBuilder.ts | sendBeapViaP2P | ⚠️ | Electron only; needs p2p_endpoint |
| useReplyComposer send | useReplyComposer.ts | buildPackage, executeEmailAction (email) | ❌ | Same stub |
| useBulkSend | useBulkSend.ts | buildPackage, executeEmailAction | ❌ | Same stub |

CRITICAL PATH TO MVP:
1. None for download demo — works.
2. (Email demo) Wire executeEmailAction to emailGateway.sendEmail with emailContract.
3. (Deferred) P2P: Ensure p2p_endpoint populated; extension backend for RPC.

DEPENDENCIES:
- Layer 4: Reply composer uses message from store.
- External: Email gateway (OAuth, sendEmail) for Path B.

---

═══════════════════════════════════════════════════════════════════
MVP CRITICAL PATH — SHORTEST ROUTE TO WORKING DEMO
═══════════════════════════════════════════════════════════════════

PRIORITY 1 (blocks everything):
- None. Core path (Electron .beap import → depackage → store → inbox) works.

PRIORITY 2 (blocks demo features):
1. **aiProvider for Draft with AI** — Pass aiProvider in replyComposerConfig to BeapMessageDetailPanel. Extension: wire from processFlow/agent. Electron: expose getProvider via preload, pass from BeapInboxDashboard.
2. **Email send (if demo includes email)** — Wire executeEmailAction to emailGateway.sendEmail with emailContract (to, subject, body, attachments).

PRIORITY 3 (nice to have for demo):
1. Extension auto-verify after file import (match Electron UX).
2. pBEAP classification fallback — default processingEvents so heuristic classification runs.
3. Electron search bar integration (if demo needs search → AI panel).

DEFERRED (post-MVP):
- Email qBEAP/pBEAP detection (extend detectBeapInBody).
- P2P/relay message package routing (bypass ingestion-core for message packages).
- beapStructuralValidator, Pod HTTP server, Containerfile, setup wizard.
- Key exchange upgrade path for existing handshakes.

ESTIMATED FIX COUNT:
- Priority 2: 2 fixes (aiProvider, email send).
- Priority 3: 1–3 fixes (auto-verify, classification fallback, search bar).
- Total for MVP demo: 2–5 individual fixes.

RECOMMENDED EXECUTION ORDER:
1. **aiProvider** (Priority 2) — Unblocks "Draft with AI" in demo. Can do Electron first (simpler: add replyComposerConfig to BeapInboxDashboard with aiProvider from IPC), then extension.
2. **Email send** (Priority 2) — If demo needs email. Wire executeEmailAction → emailGateway.sendEmail. Single change in BeapPackageBuilder.ts.
3. **Extension auto-verify** (Priority 3) — Call verifyImportedMessage after importFromFile success.
4. **pBEAP classification** (Priority 3) — Add default processingEvents in beapClassificationEngine when null.
5. **Electron search bar** (Priority 3) — Add input + pendingInboxAiRef routing in BeapInboxDashboard.

Parallel: aiProvider (Electron) and email send can be done in parallel. aiProvider (extension) after Electron if both needed.
