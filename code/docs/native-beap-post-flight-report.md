# Native BEAP Messaging — Post-Flight Report

**Generated:** 2026-03-28 (local; report assembled from codebase inspection)

**Codebase state:** `129e58365aa0864c41cf6c27727403c296f76c75` — `feat: Electron qBEAP decryption, local BEAP keys, build stamp build007`

**Note:** After this commit, additional edits may exist locally (e.g. `decryptQBeapPackage.ts` debug logging, `EmailInboxView.tsx` AI stream loop fix). Run `git status` for the exact working tree.

---

## 1. Architecture Overview

### 1.1 Message Flow (Sending)

End users compose BEAP messages primarily in the **Chromium extension** using the capsule / recipient UI. The extension’s `BeapPackageBuilder` orchestrates canonical packaging, signing, and crypto.

- **Entry point (extension):** User action in BEAP builder UI → `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` (service start ~line 1; build/send flows throughout; crypto imports from `beapCrypto.ts` ~line 34–61).
- **Package builder:** `BeapPackageBuilder.ts` calls `beapCrypto.ts` for salt, HKDF, AES-GCM (chunked payload), artefacts, PQ encapsulation helpers (`pqEncapsulate`, `pqKemSupportedAsync`), and X25519 via `x25519KeyAgreement.ts` (`deriveSharedSecretX25519`, `getDeviceX25519PublicKey`).
- **PQ crypto (ML-KEM + X25519):** In the **extension**, ML-KEM availability is probed via **`pqKemSupportedAsync`** which can hit the Electron HTTP API (e.g. `GET /api/crypto/pq/status` and ML-KEM routes on the packaged app). **Encapsulation/decapsulation** for building packages uses the shared `@noble/post-quantum` stack (see `beapCrypto.ts` / HTTP bridge as implemented). In **Electron main**, ML-KEM **decapsulate** for received qBEAP uses **`@noble/post-quantum/ml-kem`** directly in `decryptQBeapPackage.ts` (no HTTP for decrypt path).
- **Delivery:** Outbound packages can be sent **via P2P / coordination relay** (handshake RPC, relay registration), **email** (capsule as attachment / delivery path), or **file download** (e.g. `handshake.buildForDownload` in `electron/main/handshake/ipc.ts` ~line 828+). What “works” depends on environment (relay URL, OAuth, extension connected). The **canonical send path for qBEAP** is extension-side `BeapPackageBuilder` + delivery module; Electron stores **local** BEAP keys when it initiates/accepts handshakes so **incoming** qBEAP can be decrypted in the main process.

### 1.2 Message Flow (Receiving)

1. **WebSocket / coordination:** When a BEAP **message** (not only handshake) arrives, `apps/electron-vite-project/electron/main/p2p/coordinationWs.ts` routes `distribution.target === 'message_relay'` to `insertPendingP2PBeap` (**~lines 154–177**), logging `[Coordination] BEAP capsule received via WS push` and `[P2P-RECV] BEAP message inserted into pending table`.
2. **Pending table:** `insertPendingP2PBeap` in `electron/main/handshake/db.ts` (**~lines 1506–1571**) inserts into `p2p_pending_beap` (`handshake_id`, `package_json`, timestamps, etc.).
3. **Ingestion:** `processPendingP2PBeapEmails` in `electron/main/email/beapEmailIngestion.ts` (**export ~line 434**) drains pending rows, inserts or updates `inbox_messages` (`source_type` `direct_beap`), and calls **`decryptQBeapPackage`** for `header.encoding === 'qBEAP'` when `handshake_id` is set (**~lines 571–619**).
4. **Decryption:** `electron/main/beap/decryptQBeapPackage.ts` — **`export async function decryptQBeapPackage`** (**~line 204**).
5. **UI:** `apps/electron-vite-project/src/components/EmailMessageDetail.tsx` — `isPendingQbeapDepackaged` treats `beap_qbeap_decrypted` as **not** pending (**~lines 151–156**). Native BEAP detail rendering uses `depackaged_json`, `beap_package_json`, and handshake context elsewhere in the same file.

**Also:** `insertPendingP2PBeap` is invoked from `relayPull.ts`, `p2pServer.ts`, `messageRouter.ts`, `beapSync.ts` (email import paths), etc., so P2P is not the only source of pending rows.

### 1.3 Key Components

| File | Role |
|------|------|
| `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` | Canonical qBEAP/pBEAP package build, delivery hooks |
| `apps/extension-chromium/src/beap-messages/services/beapCrypto.ts` | HKDF, AES-GCM, PQ encapsulation, hashing, AAD |
| `apps/extension-chromium/src/beap-messages/services/x25519KeyAgreement.ts` | X25519 device keys and shared secret |
| `apps/extension-chromium/src/beap-messages/services/beapDecrypt.ts` | Extension-side decrypt reference |
| `apps/electron-vite-project/electron/main/p2p/coordinationWs.ts` | WS push → `p2p_pending_beap` for message relay |
| `apps/electron-vite-project/electron/main/handshake/db.ts` | Vault migrations, `insertPendingP2PBeap`, handshake CRUD |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` | `ensureKeyAgreementKeys`, initiate/accept handshake, persist BEAP keys |
| `apps/electron-vite-project/electron/main/handshake/initiatorPersist.ts` | Maps `BeapKeyAgreementMaterial` → `local_*` columns on insert |
| `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` | Electron qBEAP decrypt |
| `apps/electron-vite-project/electron/main/email/beapEmailIngestion.ts` | Pending queue drain, inbox update, attachment writes |
| `apps/electron-vite-project/electron/main/email/ipc.ts` | Pull/sync path `await processPendingP2PBeapEmails` (~line 2541) |
| `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` | Sync orchestration `await processPendingP2PBeapEmails` (~line 999) |
| `apps/electron-vite-project/electron/main.ts` | Startup / notifier `void processPendingP2PBeapEmails(...)` (~lines 8744, 8767); HTTP `AUTH_EXEMPT_PATHS` includes `/api/crypto/pq/status` (~line 5322) |
| `apps/electron-vite-project/src/components/EmailMessageDetail.tsx` | Pending vs decrypted qBEAP display |
| `apps/electron-vite-project/src/components/EmailInboxView.tsx` | `InboxDetailAiPanel`: AI analysis stream, native BEAP draft/capsule UI |

---

## 2. What Was Implemented (This Session)

### 2.1 Vault DB Migration v50

- **File:** `apps/electron-vite-project/electron/main/handshake/db.ts` (**~lines 923–931**)
- **New columns (all `TEXT` on `handshakes`):**
  - `local_x25519_private_key_b64`
  - `local_x25519_public_key_b64`
  - `local_mlkem768_secret_key_b64`
  - `local_mlkem768_public_key_b64`
- **Purpose:** Persist Electron-generated BEAP key material so the main process can perform qBEAP decryption without `chrome.storage.local`.

### 2.2 Key Generation & Storage

- **Where keys are generated:** `ensureKeyAgreementKeys` in `electron/main/handshake/ipc.ts` (**~lines 76–107**). Uses `@noble/post-quantum/ml-kem` `keygen()` when ML-KEM public key missing; uses `x25519` from `@noble/curves/ed25519` (`randomPrivateKey` / `getPublicKey`) when X25519 public missing. If the caller passes **only** X25519 public key (e.g. extension), **`sender_x25519_private_key_b64` is `null`** (no local decrypt for that key).
- **Where keys are stored:** `handshakes` columns above; serialized in `serializeHandshakeRecord` / INSERT / UPDATE paths in `db.ts`.
- **ensureKeyAgreementKeys changes:** Returns `BeapKeyAgreementMaterial` including optional `sender_x25519_private_key_b64` and `sender_mlkem768_secret_key_b64`.
- **Initiator flow:** `persistInitiatorHandshakeRecord(..., keyAgreement)` — `initiatorPersist.ts` (**~lines 112–117**) maps `sender_*` → `local_*` BEAP fields on the new handshake row.
- **Acceptor flow:** After `buildAcceptCapsule` / signing keys, `updateHandshakeRecord` merges **`acceptKeyAgreement`** into local BEAP columns (**`ipc.ts` ~lines 1093–1103**).

### 2.3 decryptQBeapPackage Implementation

- **File:** `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts`
- **Signature:** `export async function decryptQBeapPackage(packageJson: string, handshakeId: string, db: unknown): Promise<DecryptedQBeapContent | null>` (**~line 204**)
- **Crypto chain:**
  1. **ML-KEM-768 decapsulate:** `ml_kem768.decapsulate(ciphertext, secretKey)` from **`@noble/post-quantum/ml-kem`** (direct; **not** HTTP).
  2. **X25519 DH:** `x25519.getSharedSecret(localPriv, peerPub)` — **`@noble/curves/ed25519`** (X25519).
  3. **Hybrid secret:** `mlkemSecret` at offset 0, `x25519Secret` after ML-KEM length (**concat order ML-KEM || X25519**).
  4. **HKDF:** Node **`crypto.webcrypto`** (`wc.subtle` HKDF-SHA-256), infos **`BEAP v1 capsule`**, **`BEAP v1 artefact`**, and (derived for diagnostics / parity) **`BEAP v2 inner-envelope`** — see constants `HKDF_CAPSULE`, `HKDF_ARTEFACT`, `HKDF_INNER_ENVELOPE` in file.
  5. **AES-256-GCM decrypt:** **Web Crypto** (`subtle.decrypt`); optional **separate `tag` / `authTag`** base64 concatenated to ciphertext before decrypt.
  6. **Chunked payload:** Yes — `getPayloadChunks` supports `chunking.chunks` and top-level `payloadEnc.chunks`.
  7. **Artefact decryption:** Yes — chunk sequence or single blob; optional per-chunk tag.
- **Inner envelope (v2):** Not decrypted for display in this module (keys derived; full inner-envelope decrypt can be added later).
- **Error handling:** Returns `null`; logs warnings; on failure logs **`[qBEAP-decrypt] Decryption failed at step: <cryptoStep>`**. Extensive **`[qBEAP-decrypt]`** diagnostics: package header snapshot, key material lengths, receiver vs local key match, ML-KEM/X25519/hybrid lengths, HKDF key lengths, GCM nonce length (expects 12) and separate tag detection. **Hex previews** when `WR_QBEAP_DECRYPT_DEBUG=1`.

### 2.4 Ingestion Pipeline Wiring

- **File:** `apps/electron-vite-project/electron/main/email/beapEmailIngestion.ts`
- **Where decrypt is called:** Inside `processPendingP2PBeapEmails`, when parsed header has `encoding === 'qBEAP'` and `row.handshake_id` (**~lines 572–574**).
- **On success:** `updateInboxDecrypted` sets `depackaged_json` (format **`beap_qbeap_decrypted`**), **`body_text`**, **`subject`**, attachment counts; replaces attachments with encrypted-at-rest files via `writeEncryptedAttachmentFile` (**~lines 555–619**); logs ingestion success path (see console for `[BEAP-INBOX]` / `[INGEST]` patterns in file).
- **On failure:** Falls back to `beapPackageToMainProcessDepackaged` placeholder (`beap_qbeap_pending_main` style); row remains ingestible; **`markProcessed`** still advances pending queue when appropriate (see full `try`/`catch` in same function).
- **Async:** `processPendingP2PBeapEmails` is **`async`**; callers use **`await`** (`ipc.ts`, `syncOrchestrator.ts`) or **`void ... .then(...)`** (`main.ts`) so the event loop is not blocked incorrectly.

### 2.5 UI Changes

- **EmailMessageDetail.tsx:** `isPendingQbeapDepackaged` returns **`false`** for `dp.format === 'beap_qbeap_decrypted'` so decrypted messages are not treated as “waiting for extension” (**~lines 151–156**).
- **EmailInboxView.tsx / InboxDetailAiPanel:** Native BEAP uses `capsulePublicText` / `capsuleEncryptedText`, `skipEmailDraft`, and BEAP-specific draft handling inside `runAnalysisStream` (uses **`messageRef`** for stable analysis — see §4.2). **Not all of this was introduced in commit 129e5836**; AI loop stabilization may be **post-commit** (see git status).
- **HybridSearch.tsx:** **No changes in commit `129e5836`.** Context badge / wiring for BEAP unchanged by that commit (verify with `git diff` if needed).
- **Button renames:** **None identified** in commit `129e5836`.

### 2.6 PQ Crypto Status Probe Fix

- **File:** `apps/electron-vite-project/electron/main.ts`
- **Change:** `AUTH_EXEMPT_PATHS` includes **`/api/crypto/pq/status`** (**~line 5322**) so the extension can call the probe **without** `X-Launch-Secret` (same middleware block ~lines 5319–5337).
- **Effect:** `GET /api/crypto/pq/status` (**~lines 8495–8521**) returns `{ success, pq: { available, kem, library, version } }` when `@noble/post-quantum/ml-kem` loads; **`pqKemSupportedAsync`** in the extension can succeed once the app is reachable (exact client behavior in `beapCrypto.ts`).

### 2.7 Dependencies Added

| Package | Version (package.json) | Purpose |
|---------|-------------------------|---------|
| `@noble/curves` | `^1.9.7` | X25519 (`x25519` from `@noble/curves/ed25519`) in main process |
| `@noble/post-quantum` | Already present `^0.2.1` | ML-KEM-768 in main + extension |

---

## 3. Current Test Results

**These are not automated CI results — fill in from your environment.**

### 3.1 Handshake

| Check | Result |
|-------|--------|
| New handshake created after v50 | **Not verified in this document** |
| Handshake ID | **`[TEST_HANDSHAKE_ID]`** — replace manually |
| Local X25519 keys stored | **Not verified** — use SQL below |
| Local ML-KEM keys stored | **Not verified** — use SQL below |
| Peer X25519 public | **Not verified** |
| Peer ML-KEM public | **Not verified** |

To verify:

```sql
SELECT handshake_id, 
       length(local_x25519_private_key_b64) as x25519_priv_len,
       length(local_x25519_public_key_b64) as x25519_pub_len,
       length(local_mlkem768_secret_key_b64) as mlkem_sec_len,
       length(local_mlkem768_public_key_b64) as mlkem_pub_len,
       length(peer_x25519_public_key_b64) as peer_x25519_len,
       length(peer_mlkem768_public_key_b64) as peer_mlkem_len
FROM handshakes 
WHERE handshake_id = '[TEST_HANDSHAKE_ID]';
```

### 3.2 Message Send (from capsule builder)

| Check | Result |
|-------|--------|
| PQ status probe | **Expected `available: true`** when Electron serves `/api/crypto/pq/status` and library loads |
| CANON VIOLATION error | **Unknown** — depends on builder + validation snapshot |
| Package built successfully | **Not verified** |
| P2P delivery | **Not verified** |

### 3.3 Message Receive + Decrypt

| Check | Result |
|-------|--------|
| Message arrives in inbox | **Not verified** |
| `[qBEAP-decrypt]` log output | **Paste from console when testing** |
| Decryption result | **Unknown** — often **`The operation failed for an operation-specific reason`** if AES-GCM fails (WebCrypto) |
| If failure | Likely **key mismatch** (sender encrypted to different receiver pub keys than stored `local_*`) or **nonce/tag format** |
| Key match verified | Inspect logs for **`x25519Match` / `mlkemMatch`** and **`[qBEAP-decrypt] Key match check`** |

### 3.4 Message Display

| Check | Result |
|-------|--------|
| body_text | **Actual content after successful decrypt; else placeholder** |
| depackaged_json format | **`beap_qbeap_decrypted`** vs **`beap_qbeap_pending_main`** |
| Public message (pBEAP) visible | **Not verified** |
| Encrypted body (qBEAP) visible | **Not verified** |
| Attachments visible | **Not verified** |

### 3.5 AI Draft

| Check | Result |
|-------|--------|
| Auto-draft fires | **Not verified** |
| Draft content quality | **Not verified** |
| Draft populates capsule fields | **Not verified** |

### 3.6 Known Bugs

| Issue | Status |
|-------|--------|
| AI-ANALYZE-STREAM infinite loop | **Addressed in code (post-commit):** `runAnalysisStream` depends only on `[messageId]`; `messageRef` holds latest `message` — verify with logs / git diff |
| Auto-send | **Not part of this report** — assume unchanged unless verified |
| Other | AES-GCM failure until sender/receiver keys align with packaged `receiver_*` fields in header (if present) |

---

## 4. Known Issues & Root Causes

### 4.1 AES-GCM Decryption Failure

- **Error:** `The operation failed for an operation-specific reason` (WebCrypto `subtle.decrypt` rejection).
- **When:** Capsule payload or chunk decrypt (`cryptoStep` e.g. `aes-gcm-capsule-single` or chunk path).
- **Suspected cause:** Wrong derived **`capsuleKey`** (HKDF/salt/hybrid order), wrong **nonce** (length ≠ 12), **ciphertext+tag** layout (tag appended vs separate field), or **local private keys do not match** the receiver public keys the sender used when encapsulating.
- **Debug logging added:** **Yes** — `decryptQBeapPackage.ts`: header snapshot, key lengths, `Key match check`, hybrid/HKDF steps, `AES-GCM input`, `NONCE LENGTH WRONG`, `SEPARATE TAG`, failure **`at step:`**. Set **`WR_QBEAP_DECRYPT_DEBUG=1`** for hex previews.
- **Status:** **Needs confirmation** with a captured log for one failing package + SQL key lengths.

### 4.2 AI-ANALYZE-STREAM Loop

- **Symptom:** `[AI-ANALYZE-STREAM] Starting for message: <id>` repeating ~every few seconds (`electron/main/email/ipc.ts` **~line 3665**).
- **Root cause:** `runAnalysisStream` previously depended on **`message?.body_text`** (and related fields). Ingestion updating **`body_text`** after decrypt changed callback identity → `useEffect` in **`InboxDetailAiPanel`** re-ran → new stream.
- **Status:** **Mitigated in source:** `useCallback(..., [messageId])` + **`messageRef`** (`EmailInboxView.tsx` **~lines 184–371** region). Confirm on branch with that diff.
- **Impact:** Reduced Ollama load and log spam when message row updates.

### 4.3 Other

- **Extension-only X25519:** If handshake used extension-supplied X25519 public without Electron private, **`local_x25519_private_key_b64`** may be null → decrypt returns early.
- **Pre-v50 handshakes:** No local ML-KEM secret / X25519 private → qBEAP decrypt returns null until handshake re-established.

---

## 5. File Inventory (all files touched in this session)

### 5.1 New Files Created

| File | Purpose |
|------|---------|
| *None in commit 129e5836* | All changes were edits to existing files |

### 5.2 Files Modified (commit `129e5836`)

| File | What Changed |
|------|----------------|
| `code/.gitignore` | Extension build dir ignore (`build007`) |
| `code/apps/electron-vite-project/electron-builder.config.cjs` | Windows output path `build007` |
| `code/apps/electron-vite-project/electron/main.ts` | `processPendingP2PBeapEmails` wiring |
| `code/apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` | Full qBEAP decrypt implementation |
| `code/apps/electron-vite-project/electron/main/email/beapEmailIngestion.ts` | Async drain + `decryptQBeapPackage` + inbox/attachment updates |
| `code/apps/electron-vite-project/electron/main/email/ipc.ts` | `await processPendingP2PBeapEmails` |
| `code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` | `await processPendingP2PBeapEmails` |
| `code/apps/electron-vite-project/electron/main/handshake/db.ts` | Migration v50, serialize/insert/update |
| `code/apps/electron-vite-project/electron/main/handshake/initiatorPersist.ts` | BEAP key material on initiator insert |
| `code/apps/electron-vite-project/electron/main/handshake/ipc.ts` | `ensureKeyAgreementKeys`, persist keys on initiate/accept |
| `code/apps/electron-vite-project/electron/main/handshake/types.ts` | `BeapKeyAgreementMaterial`, `HandshakeRecord` fields |
| `code/apps/electron-vite-project/package.json` | `@noble/curves` |
| `code/apps/electron-vite-project/src/components/EmailMessageDetail.tsx` | `beap_qbeap_decrypted` pending check |
| `code/apps/electron-vite-project/vite.config.ts` | Build stamp |
| `code/apps/extension-chromium/vite.config.ts` | Build stamp / outDir |
| `code/pnpm-lock.yaml` | Lockfile |

### 5.3 Dependencies Changed

| Package | Added/Updated | Version |
|---------|---------------|---------|
| `@noble/curves` | Added | `^1.9.7` |

---

## 6. Database Schema (v50)

### 6.1 `handshakes` table — new columns

| Column | Type | Purpose | Populated by |
|--------|------|---------|--------------|
| `local_x25519_private_key_b64` | TEXT | BEAP X25519 private key | `ensureKeyAgreementKeys` when generated; merged on accept |
| `local_x25519_public_key_b64` | TEXT | BEAP X25519 public key | Same |
| `local_mlkem768_secret_key_b64` | TEXT | ML-KEM secret key | Same (when ML-KEM keygen runs) |
| `local_mlkem768_public_key_b64` | TEXT | ML-KEM public key | Same |

### 6.2 `inbox_messages` — `depackaged_json.format` values

| `depackaged_json.format` | Meaning |
|---------------------------|---------|
| `beap_qbeap_pending_main` | Main-process placeholder; qBEAP not decrypted natively yet |
| `beap_qbeap_decrypted` | Decrypted by Electron `decryptQBeapPackage` + ingestion |
| *(other / null)* | Other pipelines or no depackaged payload |

---

## 7. Crypto Implementation Details

### 7.1 Extension Reference (canonical)

1. ML-KEM-768 decapsulate → 32-byte shared secret.  
2. X25519 DH → 32-byte shared secret.  
3. Hybrid: **ML-KEM || X25519** → 64 bytes.  
4. HKDF-SHA256(hybrid, salt):  
   - `info='BEAP v1 capsule'` → capsule key 32B  
   - `info='BEAP v1 artefact'` → artefact key 32B  
   - `info='BEAP v2 inner-envelope'` → inner envelope key 32B  
5. AES-256-GCM with capsule key; nonce + ciphertext (+ auth tag per WebCrypto conventions).  
6. Parse decrypted JSON: `subject`, `body`, `transport_plaintext`, `attachments`, etc.

### 7.2 Electron Implementation

| Topic | Detail |
|-------|--------|
| Same chain | **Yes** — hybrid order and HKDF info strings match §7.1 |
| Library differences | HKDF/AES-GCM via **Node Web Crypto** (`crypto.webcrypto`); ML-KEM/X25519 via **@noble** |
| Deviations | Inner envelope decrypt not implemented for UI; optional separate **tag** concatenation added for GCM |

### 7.3 Key Exchange Flow (Electron + extension)

- **Initiator:** `ensureKeyAgreementKeys` → public keys embedded in handshake capsule; **local secrets** stored as **`local_*`** via `persistInitiatorHandshakeRecord`.  
- **Initiator sends to peer:** Public keys in capsule fields (`sender_x25519_public_key_b64`, `sender_mlkem768_public_key_b64` in handshake wire format — see `buildInitiateCapsuleWithContent` usage in `ipc.ts` ~lines 761–770).  
- **Acceptor:** Stores initiator keys as **`peer_*`** through normal handshake ingest; on accept, **`ensureKeyAgreementKeys`** generates acceptor **local** BEAP material and **`updateHandshakeRecord`** writes **`local_*`**.  
- **Acceptor sends to initiator:** Accept capsule includes acceptor’s public BEAP keys (same pattern).  
- **Initiator receives:** Peer keys stored as **`peer_*`** on the handshake row (existing pipeline).  

Exact field names on `HandshakeRecord` are in `electron/main/handshake/types.ts`.

---

## 8. Next Steps (Priority Order)

### 8.1 Immediate (debug + fix decrypt)

1. Run with **`WR_QBEAP_DECRYPT_DEBUG=1`** and capture full `[qBEAP-decrypt]` trace for one failure.  
2. Run **§9.4** SQL and compare to header **receiver** key fields (if present).  
3. If mismatch: **re-handshake** or ensure sender uses current **`local_*` public keys**.  
4. If nonce/tag issue: adjust concatenation rules to match extension builder output.

### 8.2 Short-term

1. Confirm AI stream fix in production build (no repeated `[AI-ANALYZE-STREAM]` for same id).  
2. Verify artefact decrypt + attachment open path.  
3. Re-test AI draft with decrypted plaintext.  
4. Exercise **Send BEAP Reply** / PQ send path.

### 8.3 Medium-term

Per product roadmap: extension inbox parity, shared BEAP UI package, session attachments, policy-gated autoresponder (no auto-send).

---

## 9. How to Test

### 9.1 Prerequisites

- Electron running, vault unlocked  
- Extension connected (WS / coordination if using relay)  
- Ollama optional (for AI)  
- Handshake with **`local_*` keys populated** (post–v50 flows)

### 9.2 Test Sequence

1. Send qBEAP from extension with attachment.  
2. Watch Electron main console for `[qBEAP-decrypt]` / `[BEAP-INBOX]`.  
3. Confirm inbox shows plaintext and attachments.  
4. Confirm AI analysis references content.  
5. Test reply / send BEAP flows.

### 9.3 What to Look For in Logs

```
[BEAP-INBOX] Processing N pending P2P BEAP message(s)
[qBEAP-decrypt] Package header.crypto: {...}
[qBEAP-decrypt] Key material: {...}
[qBEAP-decrypt] ML-KEM decapsulate result: {secretLength: 32}
[qBEAP-decrypt] X25519 result: {secretLength: 32}
[qBEAP-decrypt] Hybrid secret (ML-KEM || X25519): {length: 64}
[qBEAP-decrypt] Derived keys: {capsuleKeyLen: 32, ...}
[qBEAP-decrypt] AES-GCM input (capsule-payload): {nonceLen: 12, ...}
[qBEAP-decrypt] Success { ... }
```

### 9.4 Debug SQL Queries

```sql
-- Check handshake key material
SELECT handshake_id, 
       CASE WHEN local_x25519_private_key_b64 IS NOT NULL THEN 'YES' ELSE 'NO' END as has_x25519,
       CASE WHEN local_mlkem768_secret_key_b64 IS NOT NULL THEN 'YES' ELSE 'NO' END as has_mlkem
FROM handshakes WHERE status = 'ACTIVE';

-- Check latest inbox message
SELECT id, source_type, handshake_id, 
       substr(body_text, 1, 80) as body_preview,
       CASE WHEN depackaged_json LIKE '%decrypted%' THEN 'DECRYPTED'
            WHEN depackaged_json LIKE '%pending%' THEN 'PENDING'
            ELSE 'OTHER' END as decrypt_status,
       has_attachments, attachment_count
FROM inbox_messages 
WHERE source_type = 'direct_beap' 
ORDER BY received_at DESC LIMIT 5;

-- Check attachments
SELECT a.id, a.message_id, a.filename, a.content_type, a.size_bytes,
       CASE WHEN a.storage_path IS NOT NULL THEN 'HAS_FILE' ELSE 'METADATA_ONLY' END
FROM inbox_attachments a
JOIN inbox_messages m ON a.message_id = m.id
WHERE m.source_type = 'direct_beap'
ORDER BY a.created_at DESC LIMIT 10;
```

---

*End of report.*
