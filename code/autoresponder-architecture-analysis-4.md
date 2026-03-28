# Autoresponder Architecture Analysis

**Scope:** Read-only survey of existing policy, processing-event, send-pipeline, orchestrator, queue, and audit artifacts relevant to a **future** BEAP autoresponder (policy-consented, session-bound, PoAE-aware). **No autoresponder exists today**; gaps are explicit.

---

## Policy Engine

| Item | Detail |
|------|--------|
| **Location** | Canonical schema + Zod: `apps/extension-chromium/src/policy/schema/policy.schema.ts` (and `schema/domains/*.ts`). **Evaluator:** `policy/engine/evaluator.ts` — **`computeEffectivePolicy`** **lines 79+** (intersection of NBP ∩ LNP ∩ HSP ∩ CAP). **Store:** `policy/store/usePolicyStore.ts` — **persisted** JSON via zustand (`localPolicy`, `networkPolicy`, `handshakePolicies`, `capsulePolicies`). |
| **Policy format** | **Typed JSON** (`CanonicalPolicy` + Zod); templates in `policy/templates/` (e.g. `standard.ts`, `restrictive.ts`). **Not** the same module as Stage 6.1 receiver capability flags (see below). |
| **Key fields (examples)** | `policy.schema.ts` ties together **channels**, **pre-verification**, **derivations**, **egress**, **execution**, **vault-access**, **identity**, **ingress** (legacy). Risk tier: **`RiskTierSchema`** **lines 40–45**. Handshake overrides include **`sessionRestrictions`** (`schema/domains/handshake-overrides.ts`). **Automation risk:** `schema/domains/automation-risk.ts`. |
| **6-gate integration** | The **depackaging / receiver** path uses **`processingEventGate.ts`** **`runStage61Gate`** **lines 1270–1354** — **not** `computeEffectivePolicy` from `policy/engine`. Stage 6.1 takes **`ReceiverCapabilityPolicy`** (e.g. **`DEFAULT_CAPABILITY_POLICY`** **lines 171–179**: all processing **denied** unless flags/tokens/consent allow). **Relationship:** Canon policy layers govern **what can be asked** at build time; **Stage 6.1** enforces **receiver** consent + declarations + capability tokens **on the decrypted capsule**. |

---

## Processing Events

| Item | Detail |
|------|--------|
| **Capsule / package field** | Sender declarations live in **`ProcessingEventOffer`** / **`ProcessingEventDeclaration[]`** — resolved in **`BeapPackageBuilder`** via **`resolveProcessingEventOffer`** and embedded in **`BeapPackageConfig.processingEvents`** (**`BeapPackageBuilder.ts`** **~391, 1065–1069**). Envelope/header carries processing metadata for AAD (see comments in **`processingEvents.ts`** **lines 33–38**). |
| **Types / classes** | **`ProcessingEventClass`** = **`'semantic' \| 'actuating'`** **`processingEvents.ts`** **lines 48–58**. Semantic: derived representations (LLM, embeddings, etc.). Actuating: **external effects / automation**. |
| **Consent evaluation** | **`runStage61Gate`** **lines 1291–1297**: **`resolveConsentRequirements`** (Stage 6.2) + aggregation into **`consentViolations`**. **`evaluateProcessingEventGate`** **line 1290** for boundary/scope/provider/retention vs **`ReceiverProcessingPolicy`**. |
| **Semantic vs actuating** | Documented in **`processingEvents.ts`** **lines 51–56**: semantic = **no** external effects; actuating = **system-level or external effects**. PoAE generation in **`BeapPackageBuilder.ts`** ties **actuating** permission to **`isProcessingPermitted(..., 'actuating')`** **~1564**. |

---

## Automated Send

| Item | Detail |
|------|--------|
| **Programmatic send (no UI)** | **Yes** at the **library** level: **`executeDeliveryAction(config)`** **`BeapPackageBuilder.ts`** **~2273–2344** — builds via **`buildPackage`**, then branches **`email` / `download` / `p2p`**. **`executeEmailAction`**, **`executeP2PAction`**, **`executeDownloadAction`** are plain **`async` functions** callable from any TS context (hooks use them; **no** requirement for a React button). |
| **Entry points** | **`useBeapDraftActions`** **`executeAction`** → **`executeDeliveryAction`** **`useBeapDraftActions.ts`** **lines 211–212**. **`useReplyComposer`** **`sendReply`** → **`buildPackage`** + store update (BEAP branch) or **`executeEmailAction`** (email branch) **`useReplyComposer.ts`** **~342–442**. **`useBulkSend`** **`sendSingleItem`** **`useBulkSend.ts`** **~125–185**. |
| **Parameters** | **`BeapPackageConfig`**: `recipientMode`, `deliveryMethod`, `selectedRecipient`, `messageBody`, `encryptedMessage`, `attachments`, `processingEvents`, fingerprints, etc. **`BeapPackageBuilder.ts`** **~299–392**. |
| **Constraints** | **P2P:** `executeDeliveryAction` **preflight** **`checkHandshakeSendReady`** **lines 2277–2294**. **qBEAP:** PQ + handshake keys required in **`buildQBeapPackage`**. Receiver policy **does not** gate **send** in this module — it gates **processing** on **receive** (Stage 6.1). |
| **Autoresponder gap** | A background job would need to **construct** `BeapPackageConfig` (**reply body**, **`processingEvents`** as required), call **`executeDeliveryAction`**, and persist **PoAE** / audit expectations. **No** dedicated **`autoReply()`** or **`sendBeapReply()`** name — use **`executeDeliveryAction` / `buildPackage` + `executeP2PAction`**. |

---

## Orchestrator Output

| Item | Detail |
|------|--------|
| **What exists** | **`OrchestratorService`** (`electron/main/orchestrator-db/service.ts`): **encrypted SQLite** + **generic `get`/`set`**, **`listSessions`**, **`upsertSession`**, export/import — **lines 96–420** region. **No** workflow graph executor or “run session steps” loop in this codebase survey. |
| **Output format** | **Session** rows: **`config_json`** arbitrary JSON (**`types.ts`** **`Session`** **lines 28–35**). No standard **“emit BEAP reply”** result type. |
| **Trigger reply** | **No** first-class link from orchestrator DB to **`executeDeliveryAction`**. |
| **Mechanism** | Would require **new** glue: e.g. IPC from main → renderer (or main-process BEAP send if ported) **or** extension background script invoking **`executeDeliveryAction`** with a **service account** identity + policy checks. |

---

## Background Processing

| Item | Detail |
|------|--------|
| **Queues / workers** | **Inbox:** **`remote_orchestrator_mutation_queue`** — **mirrors local lifecycle to mailbox** (IMAP/Gmail/etc.), **not** BEAP autoresponse. Documented in **`REMOTE_ORCHESTRATOR_SYNC.md`**; drain via **`setInterval`** / **`drainOrchestratorRemoteQueueBounded`** (**`syncOrchestrator.ts`**, **`ipc.ts`**). **P2P:** **`p2p_pending_beap`** + coordination WS — ingest path for incoming capsules (**`coordinationWs.ts`**, **`beapEmailIngestion.ts`**). |
| **Extensible for autoresponder** | **Not** as-is: would need a **new** job type (e.g. `autoresponder_jobs` or IPC handler) that runs **after** ingest + **Stage 6.1** + **policy** + **session import**, then calls **`executeDeliveryAction`**. Existing queues are **remote folder sync** and **email pull**, not **automation reply**. |

---

## Audit Trail

| Item | Detail |
|------|--------|
| **Consent / gate artefacts** | **`runStage61Gate`** **lines 1327–1340**: **`gatingArtefacts`** + optional **`policy.auditStore`** implementing **`GatingAuditStore.persistGatingArtefacts`** — **in-memory / optional** unless an audit store is wired. |
| **PoAE** | **`poae.ts`** — Sender PoAE records attach to **`BeapPackage`** (**`generatePoAERecord`** in **`BeapPackageBuilder.ts`** **~1568**). **Receiver** Stage 7 notes in **`poae.ts`** **lines 22–26** (response-package PoAE-R). **Persistent storage** of PoAE is **package-bound**, not a separate “autoresponder audit log” table in Electron inbox DB. |
| **Full chain traceable** | **No** single persisted timeline: **Message → policy → import → automation → reply** would require **new** structured logging (or unified audit bus). **Consent decisions** exist as **`AuthorizedProcessingResult`** in memory on depackage; **remote** queue rows only track **mailbox** operations. |

---

## Output Template (filled)

```markdown
## Policy Engine
- Location: extension-chromium/src/policy/engine/evaluator.ts; schema/policy.schema.ts; store/usePolicyStore.ts
- Policy format: Zod-validated JSON + persisted store
- Key fields: CanonicalPolicy domains (execution, egress, channels, …); handshake sessionRestrictions; risk tier
- 6-gate integration: runStage61Gate (processingEventGate.ts) uses ReceiverCapabilityPolicy; separate from computeEffectivePolicy stack

## Processing Events
- Capsule field: processingEvents on BeapPackageConfig; offer in envelope/header
- Types: semantic | actuating (processingEvents.ts:48-58)
- Consent evaluation: resolveConsentRequirements inside runStage61Gate (processingEventGate.ts:1291-1297)
- Semantic vs actuating: semantic = derived content only; actuating = external effects (processingEvents.ts:51-56)

## Automated Send
- Programmatic send exists: yes (executeDeliveryAction, buildPackage)
- Function: executeDeliveryAction at BeapPackageBuilder.ts:~2273; executeEmailAction ~1907; executeP2PAction (same file)
- Parameters: BeapPackageConfig
- Constraints: handshake/PQ for qBEAP; P2P preflight; receiver policy gates processing on ingest not send

## Orchestrator Output
- Output format: session config_json + KV settings; no workflow runner
- Can trigger reply: no wired path
- Mechanism: would need new integration

## Background Processing
- Queue exists: yes (remote_orchestrator_mutation_queue for mailbox mirror; p2p_pending_beap for ingest)
- Type: SQLite + timers; not autoresponder
- Extensible for autoresponder: needs new job type + policy + gate + send glue

## Audit Trail
- Consent log: optional GatingAuditStore on runStage61Gate (processingEventGate.ts:1337-1339)
- PoAE storage: package.poae + poae.ts types; generatePoAERecord in BeapPackageBuilder
- Full chain traceable: no
```

---

*Analysis Prompt 4 of 4 — Autoresponder architecture preparation.*
