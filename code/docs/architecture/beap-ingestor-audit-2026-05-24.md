# BEAP Ingestor / Validator / Depackager — Architecture & Code State Audit

**Audit date:** 2026-05-24  
**Repository root:** `code/code/` (pnpm monorepo)  
**Scope:** Ingestor, Validator, Depackager — discovery pass, no redesigns.

---

## 1. Repository orientation

### Top-level layout

| Area | Path | Role |
|------|------|------|
| Electron host app | `apps/electron-vite-project/` | Main-process orchestrator, inbox, P2P server, validator subprocess |
| Chromium extension | `apps/extension-chromium/` | Sandbox depackager, BEAP builder, extension-side inbox |
| Shared packages | `packages/*` | `ingestion-core`, `beap-pod`, `coordination-service`, `relay-server`, `shared`, etc. |
| Docs / ADRs | `docs/`, `*.md` at repo root | Pipeline specs, Phase B PRs, threat model |
| CI | `code/.github/workflows/tests.yml` | Workspace vitest; no pod image build |
| Build | pnpm 9, TypeScript 5.5, Vitest 2, Vite, electron-builder | Root `package.json`, `pnpm-workspace.yaml` |

Languages: TypeScript (primary), shell/PowerShell scripts, YAML manifests.

### Entry points (exact paths)

| Component | Canonical library | Production wiring |
|-----------|-------------------|-------------------|
| **Ingestor** | `packages/ingestion-core/src/ingestor.ts` | `apps/electron-vite-project/electron/main/ingestion/ingestionPipeline.ts` → `ingestInput()` |
| **Validator (handshake capsules)** | `packages/ingestion-core/src/validator.ts` | Same pipeline → `validateCapsule()` |
| **Validator (depackaged content + seals)** | `packages/ingestion-core/src/contentValidator.ts` | `electron/main/validator-process/index.ts` (forked subprocess) |
| **Structural .beap validator (pod-only)** | `packages/beap-pod/src/beapStructuralValidator.ts` | `packages/beap-pod/src/podServer.ts` |
| **Depackager (extension sandbox)** | `apps/extension-chromium/src/beap-messages/services/depackagingPipeline.ts` | `apps/extension-chromium/src/beap-messages/sandbox/sandbox.ts` |
| **Depackager (host qBEAP)** | `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` | `beapEmailIngestion.ts`, `messageRouter.ts` |
| **Pod HTTP server** | `packages/beap-pod/src/index.ts` | Standalone `node dist/index.js`; **not referenced from Electron** |

### Launch: dev vs production

**Ingestor / handshake validator (production path)**

- Electron main starts via `apps/electron-vite-project/electron/main.ts`.
- Ingestion exposed on:
  - WebSocket RPC: `ingestion.ingest` → `handleIngestionRPC()` (`electron/main/ingestion/ipc.ts`)
  - HTTP: `POST /api/ingestion/ingest` (`registerIngestionRoutes()`)
  - P2P: `POST /beap/ingest` (`electron/main/p2p/p2pServer.ts`)
- Dev: `pnpm` scripts in electron app (Vite dev server + Electron).
- No systemd unit, compose file, or quadlet for this pipeline.

**Content validator subprocess**

- Forked on vault unlock: `ValidatorOrchestrator.start()` in `electron/main/validator-process/orchestrator.ts`.
- Entry: `electron/main/validator-process/index.js` (built by Vite plugin).

**Depackager**

- Extension: sandbox page loads `sandbox.ts` inside manifest `sandbox.pages`.
- Host: inline in main process during IMAP/P2P ingest.

**beap-pod (optional, manual only)**

```bash
pnpm --filter @repo/beap-pod build
podman build -t wrdesk-pod -f packages/beap-pod/Containerfile .
podman run -p 17180:17180 wrdesk-pod
```

(`packages/beap-pod/README.md`)

### READMEs / ADRs

| Document | Path |
|----------|------|
| Ingestion pipeline spec | `INGESTION_PIPELINE.md` |
| Threat model | `THREAT_MODEL_INGESTION_VALIDATION.md` |
| Entry-point audit | `apps/electron-vite-project/electron/main/ingestion/ENTRYPOINT_AUDIT.md` |
| Depackaging trace | `DEPACKAGING_PIPELINE_TRACE.md` |
| Pod deployment trace (partially stale, dated 2025-03-15) | `POD_DEPLOYMENT_TRACE.md` |
| ingestion-core README | `packages/ingestion-core/README.md` |
| beap-pod README | `packages/beap-pod/README.md` |
| Phase B closure / PR series | `docs/phase-b/PHASE_B_CLOSURE.md`, `PR-B-*.md` |

### Test coverage

| Suite | Path | Scope |
|-------|------|-------|
| ingestion-core | `packages/ingestion-core/__tests__/ingestion-core.test.ts` | Library unit tests |
| beap-pod structural | `packages/beap-pod/__tests__/beapStructuralValidator.test.ts` | Pod validator only |
| Electron ingestion (15 files) | `apps/electron-vite-project/electron/main/ingestion/__tests__/` | ingestor, validator, distribution, e2e HTTP/WS, adversarial |
| Validator subprocess lifecycle | `electron/main/validator-process/__tests__/lifecycle.test.ts` | fork/IPC/seal |
| Email / depackager | `electron/main/email/__tests__/pr51DepackagerDeterminism.test.ts`, `mergeExtensionDepackaged.validation.test.ts`, `pbeapValidation.test.ts`, etc. | Host depack + sealed writes |
| Sealed storage harness | `test/harness/sealed-storage.test.ts` | Validator gate integration |
| CI gate script | `scripts/check-inbox-validator-gate.sh` | Ensures validator before inbox writes |
| Root CI | `.github/workflows/tests.yml` | `pnpm -r --if-present run test:ci` — beap-pod has `test` but **no `test:ci` script** |

---

## 2. Ingestor — current state

### Path(s)

- `packages/ingestion-core/src/ingestor.ts`
- Detection helpers: `packages/ingestion-core/src/beapDetection.ts`
- Plain draft wrap: `packages/ingestion-core/src/plainTransform.ts`
- Orchestrator: `apps/electron-vite-project/electron/main/ingestion/ingestionPipeline.ts`

### Input: transport, wire format, framing

| Source | Transport | Format |
|--------|-----------|--------|
| Extension | WebSocket RPC / IPC | JSON `RawInput` `{ body, headers?, mime_type?, attachments? }` |
| P2P peers | HTTP `POST /beap/ingest` | Raw JSON body, max 15 MB |
| Coordination relay | WebSocket | Native BEAP wire normalized via `prepareCoordinationRelayNativeBeapRawInput()` |
| Email/IMAP | Internal gateway | Parsed MIME → text/html/attachments |

No length-prefix or streaming frame; whole body buffered. P2P uses `MAX_BODY_BYTES = INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES`.

### Session attachment

Ingestor is **stateless per message**. Handshake relationship binding happens downstream. Ingestor attaches only `ProvenanceMetadata` (source type, SHA-256 hash, transport metadata, classification).

```
packages/ingestion-core/src/ingestor.ts:26-71
export function ingestInput(rawInput, sourceType, transportMeta?)
  → CandidateCapsuleEnvelope  { __brand: 'CandidateCapsule', provenance, raw_payload, ingestion_error_flag }
```

### AuthN/AuthZ at ingress

- HTTP `/api/ingestion/ingest`: checks vault open (503 if locked); **no Bearer**.
- P2P `/beap/ingest`: Bearer token bound to handshake; rate-limited.
- Extension RPC: partially trusted; contract forbids constructing `ValidatedCapsule`.
- SSO required downstream for handshake execution.

### Backpressure, rate limits, queue depth, timeouts

```
packages/ingestion-core/src/types.ts:259-269
MAX_RAW_INPUT_BYTES: 15 MB
PIPELINE_TIMEOUT_MS: 10 000 ms
```

P2P rate: 30 req/min/IP public, 600 private LAN. No explicit ingest queue depth cap beyond DB quarantine dedup.

### Observability

Console logs: `[INGESTION]`, `[P2P]`, `[BEAP_DELIVERY]`, audit records via `insertIngestionAuditRecord()`. No metrics/traces exporters found. Temporary main-process log broadcast to renderers (marked `TEMPORARY DEBUG`).

---

## 3. Validator — current state

Two validators in production:

1. **Handshake / relay validator** — `validateCapsule()` in `ingestion-core/validator.ts`
2. **Content validator + HMAC seal** — `validateDecryptedBeapContent()` + subprocess in `contentValidator.ts` / `validator-process/index.ts`
3. **Pod structural validator** — `validateBeapStructure()` (standalone; **not on hot path**)

### Rules enforced today (handshake validator)

| Rule | Enforcement | On violation |
|------|-------------|--------------|
| Ingestion error propagation | `runValidation()` L816–818 | `INGESTION_ERROR_PROPAGATED` |
| Valid JSON object | L820–823 | `MALFORMED_JSON` |
| Prototype pollution (`__proto__`, `prototype`) | L827–832 | `STRUCTURAL_INTEGRITY_FAILURE` |
| JSON depth ≤ 50 | L838–841 | Reject |
| Field count ≤ 500 | L843–846 | Reject |
| `schema_version` in {1, 2} | L848–853 | `SCHEMA_VERSION_UNSUPPORTED` |
| Valid `capsule_type` enum | L855–860 | `INVALID_ENUM_VALUE` |
| Required fields per capsule type | L863–871 | `MISSING_REQUIRED_FIELD` |
| Enum: `sharing_mode`, `external_processing`, `cloud_payload_mode` | L873–890 | Reject |
| Structural: `seq`, `timestamp`, `handshake_id`, `context_blocks` | L892–911 | Reject |
| Crypto fields: `capsule_hash`, `sender_id` (non-draft) | L913–920 | `CRYPTOGRAPHIC_FIELD_MISSING` |
| Hash hex format (64-char) | L922–937 | `HASH_BINDING_MISMATCH` |
| Key/signature hex lengths | L939–953 | Reject |
| Payload size ≤ 10 MB | L955–958 | `PAYLOAD_SIZE_EXCEEDED` |
| Message package shape | `runValidationMessagePackage()` | Reject |
| Session import artefact (if present) | `validateSessionImportArtefact()` | `ARTEFACT_*` codes |
| Object sanitization | `sanitizeObject()` | Applied on success path |

### Content validator rules (post-decrypt)

- `plain_email` required fields, `host_quarantine` required fields, `beap_message` requires `attachments_canonical`, optional `session_import_artefact`, optional `ai_analysis_json` shape, attachment canonical entries.
- Never throws; always returns rejection state.

### Documented but not implemented

| Doc claim | Status |
|-----------|--------|
| `MAX_STRING_LENGTH` per string (threat model §Scenario 3) | Constant in `types.ts:268`; **no enforcement in validator** |
| `ALLOWED_CONTENT_TYPES` allowlist at ingestor | Constant exists; **not referenced in `ingestor.ts`** |
| "No code" in payloads | **No dedicated rule** |
| Pod `/depackage` full pipeline | Returns **501** (`podServer.ts:98-105`) |
| Validator subprocess encrypted kinds | Stub → reject `ARTEFACT_UNKNOWN_KEY` (`validator-process/index.ts:110-136`) |

### How validation results are reported

- Handshake clients: `{ success, validation_reason_code, reason }` via WS/HTTP.
- Quarantine DB: `insertQuarantineRecord()` on failure.
- Inbox writes: HMAC seal via `sealed-storage` gate.
- User UI: generic "Capsule rejected"; codes mapped in extension `validationState.ts`.
- Operator logs: `[ContentValidator]` warn with reason code only (no artefact content).

---

## 4. Depackager — current state

### Path(s)

| Layer | Primary files |
|-------|---------------|
| 6-gate pipeline | `apps/extension-chromium/src/beap-messages/services/depackagingPipeline.ts` |
| Orchestrator | `.../services/beapDecrypt.ts` → `decryptBeapPackage()` |
| Extension sandbox | `.../sandbox/sandbox.ts`, `sandboxClient.ts`, `sandboxProtocol.ts` |
| Host qBEAP decrypt | `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` |
| Extension→host merge | `electron/main/email/mergeExtensionDepackaged.ts` |
| Email routing | `electron/main/email/messageRouter.ts` |
| P2P inline | `electron/main/email/beapEmailIngestion.ts` → `processBeapPackageInline()` |

### Formats handled

- Native BEAP envelopes: qBEAP, pBEAP (v1.0, v2.0).
- MIME email: detection in `messageRouter.ts`; plain path via `plainEmailConverter.ts`.
- Nested MIME / attachments: email attachments scanned for `.beap`, `.json`, BEAP MIME types.
- Archives: **no zip/tar depackager** on ingest path.

### Attachment handling

- Extension sandbox: artefacts in memory; sanitised package returned via `postMessage`.
- Host merge: `writeEncryptedAttachmentFile()` → `{userData}/inbox-attachments/{messageId}/` AES-256-GCM at rest.
- Filenames sanitized (`attachmentBlobCrypto.ts:27-28`).
- Retention: persisted until message deleted (`unverified` for TTL GC).

### Risky operations (filesystem / subprocess / untrusted bytes)

| Location | Risk |
|----------|------|
| `attachmentBlobCrypto.ts` — `fs.writeFileSync` | Writes attacker-supplied attachment bytes to disk |
| `quarantine-blob-storage/index.ts` | Stores encrypted quarantine blobs |
| `decryptQBeapPackage.ts` — JSON.parse, AES-GCM, ML-KEM | Host-process decrypt of untrusted ciphertext |
| `depackagingPipeline.ts` — full crypto on untrusted package | CPU/memory exposure; same process as orchestrator |
| `messageRouter.ts` — `extractPdfText` | Subprocess/parser on PDF attachments |
| `libreofficeService.ts` | Spawns LibreOffice for doc→PDF conversion |
| `sandbox.ts` — `JSON.parse(req.rawBeapJson)` | Untrusted input (sandboxed from extension APIs, not OS-level container) |
| `mergeExtensionDepackaged.ts` — base64 attachment decode | Large attachment memory pressure |

### HTML / link sanitization

- Sandbox exit: `sanitisePackage()` strips key material (`sandbox.ts:192-194`).
- UI layer: `src/utils/safeLinks.ts` — link extraction/button rendering, not HTML sanitizer.
- **No DOMPurify** on depackaged body in main path.

### Defenses vs zip bombs / nested MIME / malformed encodings

| Attack | Defense | Gap |
|--------|---------|-----|
| JSON depth/fields | MAX depth 50, fields 500 in ingestor+pod; 4 MB capsule + 256 chunk limits in pipeline | |
| Oversized package | 15 MB raw ingest; 10 MB validator payload | Pod HTTP reads up to 600 MB (`podServer.ts:17`) |
| Zip bomb | No zip extract on ingest path | |
| Depackage hang | Sandbox: timeout race (`sandbox.ts:123-132`) | Host `decryptQBeapPackage` — **no global timeout** |
| Malformed base64 | Gate 3 constant-time checks | |

---

## 5. Containerization & isolation audit

### Containerfile / Dockerfile

**`packages/beap-pod/Containerfile`** — multi-stage, `node:20-alpine`, non-root user `beap` uid 1000.

Also unrelated: `packages/coordination-service/Dockerfile`, `packages/relay-server/Dockerfile`.

**No** Containerfile wrapping Electron ingestor/validator/depackager as a unit.

### Pod / compose / quadlet / K8s

| Artifact | Path | Used in prod? |
|----------|------|---------------|
| K8s Pod manifest | `packages/beap-pod/pod.yaml` | Manual only |
| Containerfile | `packages/beap-pod/Containerfile` | Manual / `docker:build` script |
| docker-compose for beap-pod | **None** | |
| quadlet | **None** | |

### CI / deployment

**No.** `.github/workflows/tests.yml` runs vitest only; no `podman build` or `docker build` for `beap-pod`. `beap-pod/package.json` has local `docker:build` script not invoked in CI.

### Runtime isolation from host orchestrator

| Component | Actual isolation |
|-----------|------------------|
| Handshake ingestor/validator | **Same Electron main process** (Node V8), shared UID with orchestrator |
| Content validator + seal | **`child_process.fork`** — separate V8 isolate, same OS user/host, IPC via `process.send` |
| Depackager (primary) | **Chromium extension sandbox page** — separate JS heap, no `chrome.*`, still same process tree |
| Host qBEAP decrypt | **Main process** — no isolation |
| beap-pod HTTP server | Separate container if manually started; **Electron does not call it** |

### Rootful / rootless / user namespaces

- Container spec: `USER beap` (non-root) in Containerfile.
- Electron path: runs as desktop user; no user namespace mapping.

### Capabilities, seccomp, SELinux

**Not configured** in `Containerfile` or `pod.yaml` (no `cap_drop`, seccomp, AppArmor/SELinux annotations).

### Network

- Pod: `EXPOSE 17180`, binds `0.0.0.0` (`podServer.ts:118`).
- P2P server: binds `0.0.0.0` configurable port.
- No default-deny egress policy in manifests.

### Filesystem

- Pod: no volumes in default `pod.yaml`; tmpfs commented out.
- Electron: read/write `userData`, SQLite, inbox attachments on host FS.

### Resource limits

- `pod.yaml`: 128Mi–512Mi memory, 50m–500m CPU.
- Electron/subprocess: **no cgroup limits** in repo.

### IPC with host orchestrator

- Validator subprocess: Node IPC + HMAC seal key in startup message; key zeroized in parent after send.
- Depackager: `window.postMessage` extension sandbox ↔ renderer.
- **No TLS/authenticated channel to beap-pod** — not wired.

### Image build reproducibility

- Base: `node:20-alpine` **tag only, no digest pin**.
- Pod deps: empty `dependencies`; build uses `pnpm install --frozen-lockfile`.

> **Verdict: The ingestor/validator/depackager IS NOT isolated in a podman container today.**
>
> Evidence: (1) Production ingest/validate runs inside Electron main. (2) Content validation runs via `child_process.fork` — process separation only, same host. (3) Depackaging runs in extension sandbox + main-process decrypt. (4) `packages/beap-pod/` exists with Containerfile/`pod.yaml`, but no import/call from Electron, no CI build, `/depackage` returns 501. (5) `POD_DEPLOYMENT_TRACE.md` described these as missing at time of writing; artifacts now exist but remain off the production path.

---

## 6. Pod composition & wizard-reusability

### Services in the pod (as designed)

Single container `beap-pod`: HTTP server, structural validator, planned depackager (501 stub).

### Configuration surface

| Parameter | Source | Hardcoded? |
|-----------|--------|-----------|
| `POD_PORT` | env (default 17180) | No |
| `POD_VERSION` | env | No |
| Depack keys | Request body `keys` | Not implemented |
| Image tag | `wrdesk-pod:latest` in pod.yaml | Yes |

### Things that would break on a remote VM

- Electron P2P rate-tier boost uses LAN/loopback detection — `p2pConfig.ts`, `isClientIpPrivateLan()`.
- Validator seal key from **local vault VMK** — `validatorReadiness.ts`; no remote key injection.
- Extension sandbox depackager requires **Chromium extension manifest** — not in pod.
- Host decrypt uses **local handshake DB keys** — `decryptQBeapPackage.ts`.
- SQLite + sealed storage on host `userData` — not pod-local.
- Keycloak redirect URIs `127.0.0.1:62151–62155` — `src/auth/login.ts`.
- `app.getPath('userData')` attachment paths — `attachmentBlobCrypto.ts`.
- No pod URL configuration in Electron settings (setup wizard does not exist).

### Feature flags / environment branches

- `WR_QBEAP_DECRYPT_DEBUG=1` — decrypt logging (`decryptQBeapPackage.ts:18`).
- `getHandshakeClassification()` → non-confidential fast path skips validator subprocess.
- Sandbox vs host orchestrator mode — `orchestratorModeStore.ts`.
- GPU gate for inbox AI — `inboxAiTaskDedup.ts`.

### Image reproducibility

- Partial: frozen lockfile in builder stage.
- Base image tag unpinned; no SBOM generation.

---

## 7. Data flow & trust boundaries

### Path A — P2P native BEAP message (common production path)

| Hop | Component / File | Format | Trust state | Persistence |
|-----|-----------------|--------|-------------|-------------|
| 1 | P2P HTTP ingress — `p2pServer.ts` | bytes (JSON package) | untrusted | no |
| 2 | Auth — Bearer + handshake DB lookup | — | authenticated peer, content untrusted | no |
| 3 | `processBeapPackageInline()` — `beapEmailIngestion.ts` | parsed JSON | untrusted | no |
| 4 | Capability gate — `capabilityBroker.canPerform()` | policy check | policy-checked | no |
| 5 | Depackage — `decryptQBeapPackage()` (host) | plaintext object | crypto-verified if decrypt succeeds | no |
| 6 | Validator subprocess — `validatorOrchestrator.validate()` | HMAC seal produced | **trusted for storage** | no |
| 7 | Sealed DB write — `runSealedTransaction` | SQLite `inbox_messages` | persisted sealed row | yes |
| 8 | Host orchestrator consumption — IPC | sealed query | assumes seal intact | — |

### Path B — Handshake capsule (initiate/accept/refresh)

WS/HTTP ingest → `processIncomingInput()` → `validateCapsule()` → `canonicalRebuild()` → `processHandshakeCapsule()` → handshake DB.

### What the host orchestrator assumes

- **Inbox rows**: HMAC seal verified by sealed-storage gate at read.
- **Handshake capsules**: `ValidatedCapsule` brand + runtime guard; 20-step pipeline re-validates signatures, seq, tier.
- **Does not** assume pod structural validation occurred.
- **Plain email**: marked `plain_email_no_validation_required`; minimal structural check only.

---

## 8. Cryptographic & SSO surface

### Crypto libraries

| Library | Where | Use |
|---------|-------|-----|
| Node `crypto` | ingestion-core, validator subprocess, host decrypt | SHA-256, HMAC-SHA256 seals, AES-GCM |
| `@noble/curves/ed25519` | `decryptQBeapPackage.ts` | X25519 key agreement |
| `@noble/post-quantum/ml-kem` | `decryptQBeapPackage.ts` | ML-KEM-768 PQ |
| Web Crypto (`crypto.subtle`) | extension `beapCrypto.ts` | AEAD, HKDF in sandbox pipeline |

### Keys / rotation

- Inner vault VMK → `vault.deriveApplicationKey('validator-seal-key-v1')`.
- Handshake keys in SQLite `handshakes` table (local X25519/Ed25519).
- SSO refresh token — `src/auth/tokenStore.ts`.
- No KMS/HSM; no automated rotation.
- No pod ephemeral Ed25519 compliance artefact generator.

### Signing / verification paths

- Capsule Ed25519 signatures — `depackagingPipeline.ts` Gate 5.
- HMAC content seals — `validator-process/index.ts` `computeSeal()`.
- Package signature structural check (base64 only, no verify) — `beapStructuralValidator.ts`.
- Handshake capsule signatures — handshake enforcement layer.

### SSO

- Provider: **Keycloak OIDC** — `src/auth/login.ts`, `session.ts`.
- Claims: `sub`, `iss`, `wrdesk_user_id`, `wrdesk_plan`, roles.
- P2P uses handshake tokens (not SSO JWT) at ingestor boundary.
- **No** per-message SSO-bound certificate for ingest boundary.

---

## 9. AI analysis frame — current state

### Hook locations

- `electron/main/email/ipc.ts` — handlers `inbox:aiSummarize`, `inbox:aiAnalyzeMessage`, `inbox:aiAnalyzeMessageStream`, `inbox:aiDraftReply`.
- Dedup/concurrency: `electron/main/email/inboxAiTaskDedup.ts`.
- Extension batch classification: `beapClassificationEngine.ts` + `runStage61Gate()` from `processingEventGate.ts`.

### Inputs consumed

- Sealed inbox row: `body_text`, `depackaged_json`, `beap_package_json`, headers, attachments flag.
- Stage 6.1 gate filters content by processing-event scope before batch classify.

### Outputs produced

- JSON in `inbox_messages.ai_analysis_json` via `resealWithAiAnalysis` / `sealedContentUpdate.ts`.
- Stream events to renderer.
- Structurally validated by `validateAiAnalysisField()` on re-seal.

### Model / provider / prompts

- Provider resolved in `inboxLlmChat.ts` / settings (Ollama local, cloud API).
- Prompts inline in `ipc.ts` (e.g. summarize system prompt ~L3694).
- GPU gate: `assertGpuInferenceAvailable()`.

### Extension seams for new analyses (phishing, validation cross-check)

1. **After depack, at seal** — add checks in `validateDecryptedBeapContent()` or `contentValidator.ts`.
2. **At AI write** — `ipc.ts` handlers around `inbox:aiAnalyzeMessage` + `resealWithAiAnalysis`.
3. **Pre-LLM gate** — `beapClassificationEngine.ts` / `runStage61Gate()`.
4. **Renderer** — `parseInboxAiJson.ts`, dashboard components (display only).

---

## 10. Resilience — current state

| Failure | Behavior |
|---------|----------|
| Ingestor crash mid-message | Stateless; exception → pipeline catch → error audit. |
| Validator subprocess OOM | Process exit → `liveness = 'dead'`, pending requests rejected, user notified. **No auto-restart.** |
| Depackager hang | Sandbox: timeout race. Host decrypt: **no global timeout**. |
| Restart policy | Pod `pod.yaml` liveness/readiness on `/health` — **only if pod deployed**. Electron: manual restart. |
| Health probes | Pod: HTTP `/health`. Subprocess: ping/pong every 5 s. |
| Horizontal scaling | **None** — single Electron instance. |
| DoS surfaces | `POST /api/ingestion/ingest` without rate limit; P2P body up to 15 MB; JSON depth recursion CPU; attachment disk fill; LLM inbox AI without global concurrency cap. |

---

## 11. Risks & uncertainties

| Concern | Path | Planned-change relevance | Severity |
|---------|------|--------------------------|----------|
| Production path never uses pod despite artifacts | `packages/beap-pod/*` vs `electron/main/*` | **wizard / certification** | blocker |
| Pod `/depackage` unimplemented (501) | `packages/beap-pod/src/podServer.ts` | **wizard** | blocker |
| Host qBEAP decrypt in main process on untrusted input | `electron/main/beap/decryptQBeapPackage.ts` | **general security / self-healing** | serious |
| Validator subprocess encrypted kinds stubbed | `validator-process/index.ts:110-136` | **certification** | serious |
| `MAX_STRING_LENGTH` and `ALLOWED_CONTENT_TYPES` documented but not enforced | `packages/ingestion-core/src/types.ts` | **general security** | serious |
| `/api/ingestion/ingest` lacks Bearer/rate limit | `electron/main/ingestion/ipc.ts:237-243` | **general security** | serious |
| No HTML/script sanitization on depackaged email HTML | `messageRouter.ts`, `safeLinks.ts` | **AI analysis** | serious |
| `POD_DEPLOYMENT_TRACE.md` stale vs codebase | `POD_DEPLOYMENT_TRACE.md` | **wizard** | nuisance |
| Pod base image unpinned by digest | `packages/beap-pod/Containerfile:5,15` | **wizard / reproducibility** | nuisance |
| Main-process debug log broadcast to renderer | `electron/main.ts:102-157` | **general security** | nuisance |
| Session import capability enum manually synced | `validator.ts:205-208` comment | **certification** | nuisance |

---

## 12. One-page summary

- **Isolation today:** **no** — ingestor/handshake validator run in Electron main; content validator in a forked child process; depackager in extension sandbox and/or main. `beap-pod` Containerfile exists but is not on the production path and CI does not build it.
- **Pod reusable for remote deployment:** **with-changes** — wire Electron to call pod HTTP, implement `/depackage` with injectable keys, extract depackager from extension chrome deps, add wizard/config for pod URL, replace localhost/vault coupling, add auth on pod channel.
- **Cryptographic certification scaffolding:** **partial** — HMAC content seals and handshake signatures exist; no per-message SSO-bound certificate or pod compliance artefact.
- **Top 3 fixes before new layers:** (1) Put production traffic through an actually deployed isolation boundary. (2) Implement and test pod `/depackage` + key injection. (3) Close validator gaps (encrypted kinds, `MAX_STRING_LENGTH`).
- **Top 3 assets to build on:** (1) `@repo/ingestion-core` — portable, well-tested ingest/validate library. (2) Sealed-storage + validator subprocess HMAC pipeline (Phase B). (3) Extension 6-gate depackaging pipeline + sandbox boundary.
