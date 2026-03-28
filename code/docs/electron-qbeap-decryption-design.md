# Electron qBEAP Decryption — Design Report

## Extension Crypto Chain (reference)

`decryptBeapPackage` (`apps/extension-chromium/src/beap-messages/services/beapDecrypt.ts` ~1193) receives a **parsed `BeapPackage` object** (not raw JSON alone) from `parseBeapFile`, then delegates to **`runDepackagingPipeline`** (`depackagingPipeline.ts`).

### 1. Input

- **Type:** `BeapPackage` (structured), after JSON parse + structural validation.
- **Options:** `handshakeId`, `senderX25519PublicKey`, `mlkemSecretKeyB64`, `hybridSharedSecretB64`, gates/policy objects, etc.

### 2. Key material (receiver)

| Secret | Source in extension |
|--------|---------------------|
| **X25519 device private** | `deriveSharedSecretX25519` → `x25519KeyAgreement.ts` / vault-backed device key |
| **ML-KEM-768 secret** | `chrome.storage.local` key `beap_mlkem768_secret_v1::<handshakeId>` (`mlkemHandshakeStorage.ts`) |
| **Sender X25519 pub** | Handshake RPC / `getHandshake` → `peerX25519PublicKey`, or `pkg.header.crypto.senderX25519PublicKeyB64` |
| **Hybrid pre-derivation** | Optional `hybridSharedSecretB64` (64 bytes) computed in **host** (`importPipeline` augment) when ML-KEM decaps runs via HTTP |

Electron **`handshakes`** table stores **`peer_x25519_public_key_b64`** / **`peer_mlkem768_public_key_b64`** (public only, schema v25). It does **not** store ML-KEM **secret** keys or the device X25519 **private** key.

### 3. ML-KEM decapsulation

- **Field path:** `pkg.header.crypto.pq.kemCiphertextB64` (hybrid packages).
- **Function:** `pqDecapsulate(kemCiphertextB64, mlkemSecretKeyB64)` in `beapCrypto.ts` (~2123).
- **Transport:** HTTP `POST` to Electron **`/api/crypto/pq/mlkem768/decapsulate`** with launch secret (extension background).
- **Returns:** `{ sharedSecretBytes: Uint8Array }` (32-byte ML-KEM shared secret).

### 4. X25519 ECDH

- **Sender public:** options or `pkg.header.crypto.senderX25519PublicKeyB64`.
- **Function:** `deriveSharedSecretX25519(senderPubB64)` → device private + X25519 ECDH.
- **Returns:** `{ sharedSecret: Uint8Array }` (32 bytes).

### 5. Hybrid secret + HKDF

- **Combine (hybrid):** `concat(mlkemSecret32, x25519Secret32)` → **64 bytes** (`depackagingPipeline.ts` gate4 ~879–882).
- **Salt:** `fromBase64(pkg.header.crypto.salt)`.
- **`deriveBeapKeys(sharedSecret, saltBytes)`** (`beapCrypto.ts` ~662):
  - HKDF-SHA256 labels: **`BEAP v1 capsule`**, **`BEAP v1 artefact`**, **`BEAP v2 inner-envelope`** (32-byte keys each).
- **Implementation:** `hkdfSha256` in extension (Web Crypto compatible).

### 6. Inner envelope (v2 qBEAP)

- **Cipher:** **AES-256-GCM** (`aeadDecrypt` in `beapCrypto.ts`).
- **Key:** `innerEnvelopeKey` from `deriveBeapKeys`.
- **AAD:** Canonical envelope AAD (`canonicalSerializeAAD` / `buildEnvelopeAadFields`) — see `beapDecrypt.ts` Stage 4.

### 7. Capsule payload

- **Cipher:** **AES-256-GCM** with **`capsuleKey`**, nonces in `payloadEnc` (single blob or chunked Merkle chunks).
- **Plaintext:** UTF-8 JSON string of capsule (subject, body, transport_plaintext, attachments metadata, automation).

### 8. Artefacts (`artefactsEnc`)

- **Key:** `artefactKey`.
- **Cipher:** AES-256-GCM per artefact (`encryptArtefactWithAAD` / decrypt path in pipeline).
- **Content:** Original file bytes (base64 in JSON after decrypt).

### 9. Gates 1–6 + PoAE + Stage 6.1

Full **`runDepackagingPipeline`** includes sender/receiver identity, ciphertext integrity, signatures, template hash, optional PoAE anchor, then **`runStage61Gate`** for processing authorization. **Display-only** decryption still needs **Gates 1–6 + AEAD tag verification** to avoid accepting forged ciphertext; Stage 6.1 can be skipped only if product accepts that trade-off (policy stated in prompt).

---

## Available in Electron (main)

| Primitive | Status |
|-----------|--------|
| **ML-KEM** | `@noble/post-quantum` in `package.json`; also HTTP `/api/crypto/pq/mlkem768/decapsulate` |
| **X25519** | Node `crypto` / could add `@noble/curves` |
| **AES-GCM** | Node `crypto.createDecipheriv` |
| **HKDF** | Node `crypto.hkdf` |
| **XChaCha20** | Not used for qBEAP capsule in traced path — **AES-GCM** in `aeadDecrypt` |

---

## Handshake Key Access (Electron DB)

- **Table:** `handshakes` (`electron/main/handshake/db.ts`).
- **Columns (public material):** `peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64` (v25).
- **Secrets:** ML-KEM **secret** and device X25519 **private** are **not** persisted in SQLite; they live in the **extension** (storage / vault).

**Lookup:** e.g. `SELECT * FROM handshakes WHERE handshake_id = ?` — used from IPC/handshake services; **no ML-KEM secret column**.

---

## Blocker — Why Option B Is Not a Drop-In

**Electron main cannot derive the same 64-byte hybrid secret or X25519 ECDH output without the same private keys the extension holds.** Until ML-KEM secrets (and/or pre-derived hybrid secrets) are **securely replicated** to Electron (e.g. keytar + new schema) or passed over a **trusted IPC** at runtime, **`decryptQBeapPackage` in main cannot succeed** for hybrid qBEAP.

**Recommended path:**

1. **Short term:** Keep extension sandbox + merge (current path); improve reliability.
2. **Medium term:** Persist **receiver ML-KEM secret** (or **hybridSharedSecret**) for each active handshake into **OS keychain / encrypted column** from the extension during handshake completion, then implement **`runDepackagingPipeline`** (or shared package) in main using **@noble/post-quantum** + Node crypto **without** HTTP round-trip.
3. **Shared module:** Extract `depackagingPipeline` + `beapCrypto` into `packages/beap-receiver-core` consumed by both extension (bundled) and Electron main.

---

## Implementation Plan (when keys are available)

| Step | Action |
|------|--------|
| 1 | Add secure storage for per-handshake ML-KEM secret (or hybrid) visible to main |
| 2 | New `electron/main/beap/decryptQBeapPackage.ts` calling shared pipeline or duplicated Gate 4–6 |
| 3 | `processPendingP2PBeapEmails`: after insert, `await decryptQBeapPackage(...)`; on success, UPDATE `body_text`, `depackaged_json`, attachments via `writeEncryptedAttachmentFile` |
| 4 | Extension merge remains optional verification |

---

## Risks

- **Key drift** if Electron and extension use different code paths.
- **Stage 6.1:** Skipping gate changes automation/AI semantics; must not skip AEAD/signature checks if claiming “same security.”
- **HTTP PQ** in extension vs **direct @noble** in main — must produce **identical** ML-KEM outputs.

---

## Stub Module

`electron/main/beap/decryptQBeapPackage.ts` may return `null` until key material is available in main, logging a single-line reason (no secrets).
