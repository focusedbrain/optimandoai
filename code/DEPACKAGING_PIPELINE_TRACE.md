# BEAP Depackaging Pipeline — Complete Trace

**Date:** 2025-03-15  
**Critical Layer:** Without working depackaging, no messages appear in the inbox and no AI features can operate.

---

## Pipeline Architecture

| Component | File | Role |
|-----------|------|------|
| **6-Gate Pipeline** | `depackagingPipeline.ts` | Canon §10 sequential verification (Gates 1–6) |
| **Orchestrator** | `beapDecrypt.ts` → `decryptBeapPackage` | Calls pipeline, then Stage 2/4/6.1–6.3/7 |
| **Sandbox** | `sandbox.ts` | Runs inside Chrome extension sandboxed page |
| **Sandbox Client** | `sandboxClient.ts` | Host-side iframe + postMessage gateway |
| **Ingress** | `importPipeline.ts` → `verifyImportedMessage` | Calls `sandboxDepackage`, then `addMessage` |

---

## GATE 1 — Sender Identity Verification

**File:** `depackagingPipeline.ts`  
**Function:** `gate1SenderIdentity(pkg, knownSenders)`

### What it checks

1. **Structural:** `header.version` ∈ {1.0, 2.0}, `header.encoding` ∈ {qBEAP, pBEAP}
2. **Required fields:** `sender_fingerprint`, `template_hash`, `policy_hash`, `content_hash`, `signature.signature`
3. **Sender matching:** If `knownSenders` is non-empty, `sender_fingerprint` MUST match at least one entry. Otherwise **fail**.

### pBEAP (no handshake required)

- If `knownSenders` is **absent or empty**, Gate 1 performs **structural validation only** — no identity pinning.
- **Passes** for unknown senders when `knownSenders` is not provided.

### Unknown senders (depackaged email)

- Same as pBEAP: when `knownSenders` is absent/empty, gate passes with `senderKnown: false`.
- When `knownSenders` is provided and sender is not in set → **fail**.

### Status: ✅

- pBEAP / unknown sender: passes with structural check only.
- qBEAP with known handshake: requires `knownSenders` to include sender fingerprint.

---

## GATE 2 — Receiver Identity Verification

**File:** `depackagingPipeline.ts`  
**Function:** `gate2ReceiverIdentity(pkg, gate1ctx, knownReceiver)`

### What it checks

- **qBEAP:** Must have `receiver_binding.handshake_id` or `receiver_fingerprint`.
  - If `knownReceiver` provided: matches `receiver_fingerprint` or `handshake_id` against known set.
  - Constant-time scan over all fingerprints/handshake IDs.
- **pBEAP:** `receiverVerified = true` — no receiver binding required (public distribution).

### eligibilityCheck.ts

- **Not used by depackaging pipeline.** The pipeline uses `gate2ReceiverIdentity` (fingerprint/handshake_id match).
- `evaluateRecipientEligibility` (HMAC-based v2.0) and `evaluateLegacyEligibility` (handshake_id string match) are used by `beapDecrypt.checkRecipientEligibility` — but `decryptBeapPackage` uses the **6-gate pipeline** and does **not** call Stage 0 eligibility before the pipeline. The pipeline’s Gate 2 replaces that role.

### Constant-time comparison

- Yes: `constantTimeEqual` used for chunk hashes (Gate 3), template/content hashes (Gate 6).
- Gate 2 uses linear scan over known fingerprints — no early exit on match (constant-behavior).

### Status: ✅

- pBEAP: always passes.
- qBEAP: structural check or explicit match when `knownReceiver` provided.

---

## GATE 3 — Ciphertext Integrity Verification

**File:** `depackagingPipeline.ts`  
**Function:** `gate3CiphertextIntegrity(pkg, gate2ctx)`

### qBEAP

- **Chunked:** Verifies each chunk’s `sha256` matches ciphertext bytes; Merkle root over chunk hashes.
- **Legacy single-blob:** Verifies `nonce` and `ciphertext` present, size bounds.
- AEAD authentication tags are verified during **decryption** (Gate 4) via `aeadDecrypt` — invalid tag throws.

### pBEAP (unencrypted)

- Verifies `pkg.payload` (base64) present and size-bounded.
- No AEAD/Merkle — structural check only.

### Status: ✅

- qBEAP: chunk hashes, Merkle root, size limits.
- pBEAP: payload presence and size.

---

## GATE 4 — Post-Quantum Decryption

**File:** `depackagingPipeline.ts`  
**Function:** `gate4Decryption(pkg, gate3ctx, senderX25519PublicKey)`

### qBEAP flow

1. **Key derivation:** `deriveSharedSecretX25519(senderX25519PublicKey)` → ECDH shared secret (32 bytes)
2. **HKDF:** `deriveBeapKeys(sharedSecret, salt)` → `capsuleKey`, `artefactKey`, `innerEnvelopeKey`
3. **Decryption:** `aeadDecrypt(capsuleKey, nonce, ciphertext)` per chunk or legacy blob
4. **Integrity:** If `sha256Plain` declared, constant-time compare against decrypted plaintext hash

### ML-KEM / hybrid

- **Builder:** Uses hybrid (X25519 + ML-KEM-768) → 64-byte `hybridSecret` → `deriveBeapKeys(hybridSecret, salt)`.
- **Depackaging:** Uses **X25519 only** — `deriveSharedSecretX25519` → 32-byte secret → `deriveBeapKeys`.
- **Mismatch:** Packages built with hybrid (64-byte) use a different key derivation input than the depackaging pipeline (32-byte). **Hybrid-built qBEAP will not decrypt** with the current depackaging code unless it is updated to support ML-KEM decapsulation.

### pBEAP

- Base64 decode of `pkg.payload` → plaintext.
- No key derivation; placeholder zero-length keys for downstream.

### beapDecrypt.ts

- `decryptBeapPackage` calls `runDepackagingPipeline` — the 6-gate pipeline is the main path.
- `decryptQBeapPackage` / `decodePBeapPackage` are legacy; the pipeline uses `decryptQBeapPackageFromContext` / `decodePBeapPackageFromContext` after Gates 1–6.

### Inner envelope (Stage 4)

- After pipeline: `decryptInnerEnvelope(innerEnvelopeCiphertext, verifiedCtx.innerEnvelopeKey, ...)` for v2.0 qBEAP.
- Uses `innerEnvelopeKey` from Gate 4.

### KEY QUESTION: Handshake X25519 + ML-KEM

- **Package header:** qBEAP carries `pkg.header.crypto.senderX25519PublicKeyB64` (sender’s public key).
- **Pipeline:** Requires `senderX25519PublicKey` in **options** — it does **not** fall back to `pkg.header.crypto.senderX25519PublicKeyB64`.
- **Caller:** `verifyImportedMessage` receives options from `usePendingP2PBeapIngestion` with only `{ handshakeId }` — no `senderX25519PublicKey`.
- **Result:** qBEAP fails at Gate 4 with "senderX25519PublicKey required for qBEAP" when options omit the key.
- **Fix:** Use `options.senderX25519PublicKey ?? pkg.header.crypto?.senderX25519PublicKeyB64` so the key from the package is used when options do not provide it.

### HANDSHAKE_KEY_EXCHANGE_DIAGNOSIS.md

- Handshake flow was updated: `enforcement.ts` and `recipientPersist.ts` populate `peer_x25519_public_key_b64` from `senderX25519` in initiate/accept capsules.
- Schema v25 adds `peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64`.
- For **receiving**, the sender’s X25519 is in the package; handshake lookup is only needed when the key is not in the package (legacy). Using the package key is the correct default.

### Status: ⚠️

- **pBEAP:** ✅ Works (no key needed).
- **qBEAP:** ❌ Fails when options lack `senderX25519PublicKey` — no fallback to package header.
- **Hybrid (ML-KEM + X25519):** ❌ Depackaging uses X25519-only; hybrid-built packages will not decrypt.

---

## GATE 5 — Capsule Signature Verification

**File:** `depackagingPipeline.ts`  
**Function:** `gate5SignatureVerification(pkg, gate4ctx, skipSignatureVerification)`

### What it checks

- Ed25519 signature over: canonical outer header (excl. signature), payload commitment (Merkle root or sha256Plain), artefacts manifest.
- Key: `matchedIdentity.ed25519PublicKey` (from Gate 1) if provided; else `pkg.header.signing.publicKey`.

### Status: ✅

- pBEAP and qBEAP both verified.
- `skipSignatureVerification` exists for tests (not recommended).

---

## GATE 6 — Template Hash Verification

**File:** `depackagingPipeline.ts`  
**Function:** `gate6TemplateHash(pkg, gate5ctx, knownTemplateHashes, expectedContentHash)`

### What it checks

- `template_hash` and `content_hash` present, 64-char hex SHA-256.
- If `knownTemplateHashes` provided: `template_hash` must match an entry.
- If `expectedContentHash` provided: `content_hash` must match.

### No template hash declared

- If `knownTemplateHashes` absent: only structural validity (non-empty, hex format) — gate passes.
- If `expectedContentHash` absent: only structural validity for `content_hash`.

### Status: ✅

- Structural checks always enforced.
- Optional pinning when maps are provided.

---

## POST-GATE PROCESSING

### Output

- `Gate6Context` with `authorizedCapsulePlaintext`, `capsuleKey`, `artefactKey`, `innerEnvelopeKey`.
- Then: `decryptQBeapPackageFromContext` / `decodePBeapPackageFromContext` → `DecryptedPackage`.

### sanitisePackage()

- **File:** `sandbox.ts`
- **Called:** After `decryptBeapPackage` succeeds, before sending result to host.
- **Strips:** `pipelineResult.verifiedContext` (keys), raw ciphertext refs, internal errors.
- **Output:** `SanitisedDecryptedPackage` — only safe fields cross the boundary.

### Sanitised package fields

- `header`, `capsule`, `artefacts`, `metadata`, `verification`, `authorizedProcessing`, `innerEnvelopeMetadata`, `poaeVerification`, `poaeRLog`, `allGatesPassed`, `verifiedAt`.
- `capsule` includes: `body`, `transport_plaintext`, `attachments` (with `semanticContent`, `semanticExtracted`), `automation`, `subject`.
- `sanitisedPackageToBeapMessage` maps to `BeapMessage` with `messageBody`, `canonicalContent`, `attachments`, `automationTags`, `trustLevel`, `senderFingerprint`.

### Attachments

- **In capsule:** `attachments[].semanticContent` — populated by sender’s parser at build time.
- **PDF parsing:** Done at **build** time via `parserService.ts` → `http://127.0.0.1:51248/api/parser/pdf/extract` (Electron orchestrator).
- **At depackaging:** No parsing — attachments come as stored in the capsule (base64, semanticContent if present).
- **Known issue:** Parser depends on Electron at 127.0.0.1:51248; when Electron is down, PDF semantic extraction fails at build time.

---

## SANDBOX INTEGRATION

### Where depackaging runs

- **Inside** Chrome extension sandboxed page (`sandbox.html`).
- Declared in manifest `sandbox.pages`.
- Isolated context: no `chrome.*`, no extension storage, no network.

### IPC protocol

- **postMessage** from host to sandbox iframe.
- Request: `SandboxRequest` { `requestId`, `type: 'DEPACKAGE'`, `rawBeapJson`, `options` }.
- Response: `SandboxAck` (immediate), then `SandboxSuccess` or `SandboxFailure`.

### Handshake keys per request

- Options are passed per request: `SandboxDecryptOptions` includes `handshakes`, `senderX25519PublicKey`, `knownSenders`, `knownReceiver`, etc.
- Sandbox deserialises these in `deserialiseOptions()` before calling `decryptBeapPackage`.

### sandboxStub replacement

- No `sandboxStub.ts` found.
- `sandbox.ts` is the implementation; `sandboxClient.ts` is the host client.
- Flow: `sandboxDepackage` → `SandboxClient.create()` → inject iframe → `postMessage` → sandbox `handleMessage` → `handleDepackage` → `decryptBeapPackage` → `sanitisePackage` → `postMessage` response.

### Return to importPipeline

- `verifyImportedMessage` calls `sandboxDepackage(payload.rawData, options)`.
- On success: `acceptMessage`, `useBeapInboxStore.addMessage(pkg, handshakeId)`.
- Sandbox result flows back via `postMessage` → `SandboxClient.handleMessage` → promise resolve.

---

## CRITICAL: Can pBEAP Depackage Successfully Right Now?

### Answer: ✅ YES

### Exact code path

1. **Import:** `importBeapMessage(rawData, 'p2p')` or `importFromFile` → ingress store.
2. **Verify:** `verifyImportedMessage(messageId, { handshakeId: '__file_import__' })` (or from `usePendingP2PBeapIngestion`).
3. **Sandbox:** `sandboxDepackage(rawBeapJson, { handshakeId })`) — no `senderX25519PublicKey`, `knownSenders`, or `knownReceiver`.
4. **Pipeline:**
   - **Gate 1:** `knownSenders` absent → structural only → ✅
   - **Gate 2:** pBEAP → `receiverVerified = true` → ✅
   - **Gate 3:** pBEAP → payload present, size check → ✅
   - **Gate 4:** pBEAP → base64 decode, no key → ✅
   - **Gate 5:** Ed25519 signature with `pkg.header.signing.publicKey` → ✅
   - **Gate 6:** Structural template/content hash → ✅
5. **Post-pipeline:** `decodePBeapPackageFromContext` → `DecryptedPackage`.
6. **Stage 6.1:** `runStage61Gate` → `authorizedProcessing.decision = 'AUTHORIZED'` (default policy allows).
7. **Sanitise:** `sanitisePackage` → `SanitisedDecryptedPackage`.
8. **Inbox:** `addMessage(pkg, null)` (pBEAP → `handshakeId = null`).

### What blocks qBEAP

1. **Missing senderX25519PublicKey in options:** Gate 4 fails. Fix: fallback to `pkg.header.crypto.senderX25519PublicKeyB64`.
2. **Hybrid vs X25519-only:** Builder uses 64-byte hybrid secret; depackaging uses 32-byte X25519. Hybrid-built qBEAP will not decrypt until depackaging supports ML-KEM decapsulation.

---

## Summary Table

| Gate | Function | qBEAP | pBEAP | Status |
|------|----------|-------|-------|--------|
| 1 | gate1SenderIdentity | knownSenders or structural | structural | ✅ |
| 2 | gate2ReceiverIdentity | receiver_binding/fingerprint | always pass | ✅ |
| 3 | gate3CiphertextIntegrity | AEAD/Merkle | payload size | ✅ |
| 4 | gate4Decryption | ECDH + HKDF + AEAD | base64 decode | ⚠️ qBEAP needs key in options |
| 5 | gate5SignatureVerification | Ed25519 | Ed25519 | ✅ |
| 6 | gate6TemplateHash | structural + optional pinning | same | ✅ |

| Component | Status |
|-----------|--------|
| Sandbox (sandbox.html) | ✅ |
| Sandbox client (postMessage) | ✅ |
| sanitisePackage | ✅ |
| pBEAP depackaging | ✅ |
| qBEAP depackaging | ⚠️ Blocked by missing key fallback |
| Hybrid (ML-KEM) depackaging | ❌ Not implemented |
