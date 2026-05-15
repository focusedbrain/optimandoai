# AES-GCM Chunk Decrypt Failure — Codebase Analysis

**Priority:** CRITICAL  
**Type:** Analysis only (no code changes in this document).

**Observed error:** `[qBEAP-decrypt] Decryption failed at step: aes-gcm-capsule-chunks`

**Observed context:** ML-KEM (32 B), X25519 (32 B), hybrid (64 B), and HKDF-derived keys (32 B) all report success before this step.

**Observed chunk metadata (example):**

- `nonceLen: 16` — in the **chunk structure** log this is the **base64 string length** (16 chars ≈ 12-byte IV in standard base64), not decoded byte length.
- `ciphertextLen: 804` — **base64 string length** for `chunk.ciphertext`.
- `hasTag: false`, `hasAuthTag: false` — no separate `tag` / `authTag` fields on the chunk object (expected for the current extension builder).
- **AES-GCM input log:** `nonceLen: 12` (bytes), `ciphertextLen: 601` (bytes) after decode.

**Base64 length note:** For a standard base64 string of length 804 (multiple of 4), the decoded length is \(804 \times 3 / 4 = 603\) bytes. A logged **601** byte length indicates either a different string than “804 chars of pure alphabet,” different padding, embedded whitespace, or a measurement from a slightly different decode path — worth re-checking on the **exact** string captured in logs.

---

## Executive summary

| Area | Finding |
|------|---------|
| **Tag vs ciphertext** | Encrypt returns **WebCrypto default**: ciphertext **includes** the 16-byte GCM tag. Chunks **do not** carry a separate `tag` field. Decrypt expects the same unless `tag` / `authTag` / `gcmTag` is present and then **appends** it. **No structural split/tag omission bug** in the nominal builder path. |
| **AAD** | Capsule chunks are encrypted **with** envelope AAD on the extension (`aeadEncrypt(..., aad)`). Electron decrypt **passes the same conceptual AAD** via `computeEnvelopeAadBytes(header)` + `decryptChunkSequence(..., envelopeAadBytes)`. **If AAD bytes differ** from what was used at encrypt time, AES-GCM **always** fails even with the correct key. |
| **tagLength** | Neither side sets a non-default `tagLength`; WebCrypto defaults to **128-bit** tag. **Consistent.** |
| **Likely failure classes** | (1) **Wrong `capsuleKey`** (peer/local key material mismatch — see `analysis-key-sync-diagnostic.md`). (2) **AAD mismatch** (header subset / JSON canonicalization / different `pkg.header` than sender used for AAD). (3) **Rare:** base64 / transport corruption. |

The encrypt and decrypt implementations are **intended mirror images** for AES-GCM chunk layout; the dominant remaining causes are **key agreement vs stored handshake keys** and **bit-exact AAD equality**, not “missing tag field” in JSON.

---

## Step 1: Encrypt vs decrypt (code references)

### 1A. Encrypt — `beapCrypto.ts`

**Grep anchors (representative):**

- `aeadEncrypt` — export at **713**, `subtle.encrypt` at **734–742**.
- `encryptCapsulePayloadChunked` — **979–1030**; per-chunk call **1002**.

**Function:** `aeadEncrypt` (`713–747`)

- **Cipher:** `AES-GCM` via `crypto.subtle.encrypt`.
- **Nonce:** `randomBytes(NONCE_LENGTH)` then `toBase64(nonce)` in the return value (**744–746**). Standard **12-byte** nonce (see `NONCE_LENGTH` elsewhere in file).
- **Return shape:** `{ nonce: string, ciphertext: string }` only — **no** separate `tag` field (**744–747**).
- **Tag handling:** WebCrypto AES-GCM returns **ciphertext || auth tag** in one buffer; the code base64-encodes the **entire** buffer as `ciphertext` (**746**). The tag is **not** split out.
- **AAD:** Optional third argument `aad?: Uint8Array` passed through to `additionalData` in the encrypt params (**738**).

**Chunked capsule path:** `encryptCapsulePayloadChunked` (**979–1030**)

- Calls `aeadEncrypt(capsuleKey, chunk, aad)` for **each** plaintext chunk (**1002**).
- Pushes `EncryptedChunk` objects with **`index`, `nonce`, `ciphertext`, `sha256Cipher`, `bytesPlain`** (**1006–1012**) — **no** `tag` / `authTag` fields.

**Stale comment:** Lines **1000–1001** say “TODO: Wire AAD” — the implementation **already passes `aad`** into `aeadEncrypt`. Treat as documentation drift.

### 1B. Decrypt — `decryptQBeapPackage.ts`

**Grep anchors:**

- `aesGcmDecrypt` — **103–125**, `subtle.decrypt` — **117–122**.
- Chunk pipeline — `decryptChunkSequence` **182–201**, capsule branch **393–424**.

**Function:** `aesGcmDecrypt` (**103–125**)

- **Cipher:** `AES-256-GCM` via `wc.subtle.decrypt`.
- **IV:** decoded from `nonceB64` (**111**).
- **Ciphertext buffer:** base64-decoded `ciphertextB64` (**112**). If optional `tagB64` is set, **concatenates** tag bytes after ciphertext (**113–116**) so WebCrypto sees **ciphertext || tag** (**99–101** comment).
- **AAD:** If `aad && aad.length > 0`, passes `additionalData: aad` (**118–120**); otherwise omits `additionalData` (**120**).
- **tagLength:** **Not** set on the algorithm object — **default 128-bit** tag in WebCrypto.

**Chunk sequence:** `decryptChunkSequence` (**182–201**)

- For each chunk, resolves optional separate tag from `chunk.tag` | `chunk.authTag` | `chunk.gcmTag` (**190–197**).
- Calls `aesGcmDecrypt(key, chunk.nonce, chunk.ciphertext, aad, tagExtra)` (**198**).

### 1C. Comparison table (as implemented)

| Aspect | Encrypt (`beapCrypto.ts`) | Decrypt (`decryptQBeapPackage.ts`) |
|--------|---------------------------|-------------------------------------|
| Cipher | AES-GCM (`subtle.encrypt`) | AES-GCM (`subtle.decrypt`) |
| Tag in `ciphertext` | **Yes** — full WebCrypto output base64-encoded | **Yes** — expects tag appended unless separate tag fields supplied |
| Separate tag fields | **Not** emitted for standard chunk builder | **Optional** — if present, appended before decrypt |
| tagLength | Default (128-bit) | Default (128-bit) |
| Nonce | 12-byte random → base64 | Base64 → bytes; logs warn if decoded length ≠ 12 |
| AAD | Passed as `additionalData` when encrypting chunks | Passed as `additionalData` when `envelopeAadBytes` is non-empty |

**Conclusion:** For chunks built by `encryptCapsulePayloadChunked`, **tag handling and default tag length align** with `aesGcmDecrypt`. A failure at **`aes-gcm-capsule-chunks`** is **not** explained by “missing `tag` column in JSON” alone — the tag is **inside** `ciphertext`.

---

## Step 2: What the builder actually puts in each chunk

**Trace:** `BeapPackageBuilder.ts` — `encryptCapsulePayloadChunked` from **1359–1362** (and implementation in `beapCrypto.ts` **979–1030**).

**Per-chunk fields** (encrypted chunk objects):

- `index`
- `nonce` (base64)
- `ciphertext` (base64) — **includes** auth tag bytes inside the WebCrypto output
- `sha256Cipher` (hash of **decoded** ciphertext bytes — used for Merkle / integrity)
- `bytesPlain` (plaintext chunk length)

So the Linux log shape:

`allKeys: ["index","nonce","ciphertext","sha256Cipher","bytesPlain"]`

is **expected** and **does not** imply a missing tag in the cryptographic sense.

### Check A — Self-contained ciphertext

`aeadEncrypt` returns `ciphertext: toBase64(new Uint8Array(ciphertextBuffer))` where `ciphertextBuffer` is the **full** `subtle.encrypt` output (**734–746**). **No** split of tag vs body.

### Check B — Base64 length (804 vs 601)

- **804** is the **character length** of the base64 **string** in JSON (see chunk structure log in `decryptQBeapPackage.ts` **406–420** — `ciphertextLen` is `typeof c0.ciphertext === 'string' ? c0.ciphertext.length`).

- **601** is the **decoded byte length** from `logGcmDecryptInputs` (**33–34**, **75–77**), using `fromBase64` implemented as `Buffer.from(s, 'base64')` (**75–77**).

For a clean 804-character standard base64 string (no whitespace), decoded length is **603**. A **601** byte result suggests:

- Truncation or different string than assumed, or
- Non-base64 characters / normalization differences, or
- Logging from **two different** samples.

**Extension encoding:** `toBase64` uses `btoa` over raw bytes (**292–297**) — **standard** base64.

**Extension decoding (sender-side verification):** `fromBase64` uses `safeAtob` (URL-safe **decoding**, whitespace strip) (**304–320**).

**Electron decrypt:** `Buffer.from(s, 'base64')` — generally compatible with extension **output**; if the **stored** string were URL-safe (`-`/`_`), Node’s `'base64'` might differ from `safeAtob` — **worth verifying the literal string** if corruption is suspected.

---

## Step 3: AAD (additional authenticated data)

### Encrypt

- `BeapPackageBuilder.ts` builds `headerPreSignature`, then `aadFields = buildEnvelopeAadFields(headerPreSignature)`, `aadBytes = canonicalSerializeAAD(aadFields)` (**1334–1335**).
- `encryptCapsulePayloadChunked(capsuleKey, capsulePayloadJson, aadBytes)` (**1359–1362**).
- Inside `encryptCapsulePayloadChunked`, **each** `aeadEncrypt(capsuleKey, chunk, aad)` passes **`aad`** into WebCrypto (**1002**).

So **capsule payload chunks are encrypted with non-empty AAD** for normal qBEAP (builder asserts non-empty AAD — **1337–1343**).

### Decrypt

- `decryptQBeapPackage.ts` **377–385**: `envelopeAadBytes = computeEnvelopeAadBytes(header)` where `header = pkg.header`.
- `computeEnvelopeAadBytes` in `beapEnvelopeAad.ts` (**113–115**) applies `buildEnvelopeAadFields` + `canonicalSerializeAAD` — documented to **mirror** extension `beapCrypto.ts` (**1–7**).

- **424:** `decryptChunkSequence(capsuleKey, chunks, envelopeAadBytes)` — **same AAD** applied to **every** chunk.

### Critical implication

If **`computeEnvelopeAadBytes(parsedHeader)`** is **not bit-identical** to the **`aadBytes`** used at send time, **AES-GCM authentication fails** even if:

- `capsuleKey` is correct, and  
- Nonce/ciphertext/tag layout is correct.

So “capsule payload uses no AAD” is **false** for the current pipeline — **both** sides use AAD. The question is **strict equality** of the **canonical JSON bytes**.

**Header drift scenarios** (analysis):

- Sender encrypted with AAD derived from **`headerPreSignature`** at build time (**1300–1325**). Receiver recomputes from **`pkg.header`** as deserialized. If any field in the **AAD subset** differs between what was serialized at send and what arrives (or JSON re-serialization differs), decrypt fails.
- `buildEnvelopeAadFields` in extension (**480–531**) includes a **fixed subset** of header fields (excludes e.g. mutable `receiver_binding` per comments **452–455**, **472–475**). Electron `beapEnvelopeAad.ts` **38–106** mirrors that subset.

---

## Step 4: Exact WebCrypto `decrypt` call

From `aesGcmDecrypt` (**117–122**):

```ts
const decrypted = await wc.subtle.decrypt(
  aad && aad.length > 0
    ? { name: 'AES-GCM', iv, additionalData: aad }
    : { name: 'AES-GCM', iv },
  key,
  data,
)
```

- **`tagLength`** is omitted → **default 128** (16-byte tag) — matches **encrypt**.
- **IV** is `Uint8Array` from `fromBase64(nonceB64)` — must be **12 bytes** for interoperability with the extension’s `NONCE_LENGTH`.

---

## Step 5: Does “Windows works, Linux fails” imply a Linux-only bug?

**Same committed code** on both OSs: the **Electron** decrypt path is identical. If Windows **truly** decrypts the **same** package bytes with the **same** `main` + `decryptQBeapPackage.ts` revision, a Linux-only failure is **unlikely** to be “AES-GCM chunk layout” unless:

- Different **Node/Electron** versions change WebCrypto behavior (rare for AES-GCM), or  
- Different **handshake DB state** / **keys** / **header bytes** seen at runtime.

**Action:** On **both** machines:

```bash
git status
git diff --stat
```

Compare **revisions** of:

- `code/apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts`
- `code/apps/electron-vite-project/electron/main/email/beapEmailIngestion.ts` (or other ingest paths)

Uncommitted local changes on one machine can explain “works here, fails there.”

---

## Output template — fill with measured values

```markdown
# AES-GCM Chunk Decrypt — Analysis Report

## Encrypt Side (`beapCrypto.ts`)
- Function: `aeadEncrypt` (export ~713); chunked capsule: `encryptCapsulePayloadChunked` (~979)
- Tag handling: **Tag concatenated inside** `ciphertext` (WebCrypto default); **no** separate tag in chunk JSON
- AAD for capsule chunks: **Yes** — `aadBytes` from `buildEnvelopeAadFields` + `canonicalSerializeAAD` (see `BeapPackageBuilder.ts` ~1334–1362)
- Base64 encoding: **Standard** `btoa` / `toBase64` (~292–297)
- Returns: `{ nonce, ciphertext }` per chunk (+ `sha256Cipher`, `bytesPlain`, `index`)

## Decrypt Side (`decryptQBeapPackage.ts`)
- Function: `aesGcmDecrypt` (~103); chunks: `decryptChunkSequence` (~182)
- Tag handling: **Expects tag inside** `ciphertext`; **optional** separate `tag` / `authTag` / `gcmTag` appended if present
- AAD passed: **Yes** when `computeEnvelopeAadBytes(header)` is non-empty (~377–424)
- Base64 decoding: `Buffer.from(s, 'base64')` (~75–77)
- tagLength param: **Omitted** (default 128-bit)

## Mismatch Found
| Aspect | Encrypt | Decrypt | Match? |
|--------|---------|---------|--------|
| Tag in ciphertext | yes | expects yes (or + optional separate tag) | ✅ |
| AAD | present (`additionalData`) | present if `envelopeAadBytes.length > 0` | Must be **bit-identical** JSON bytes |
| Base64 variant | standard `btoa` | Node `Buffer` base64 | ✅ if string untransformed |
| tagLength | default 128 | default 128 | ✅ |

## Root cause
[One sentence — e.g. “AAD bytes recomputed from received header do not match sender AAD” **or** “capsuleKey wrong due to peer/local key mismatch despite successful length logs.”]

## Fix
[Exact next steps — e.g. `WR_QBEAP_DECRYPT_DEBUG=1`; hex-compare `capsuleKey` and first 32 bytes of `computeEnvelopeAadBytes(header)` vs sender; re-handshake per key-sync doc; verify `git` clean and same commit on both hosts.]
```

---

## Related documents

- `code/docs/analysis-key-sync-diagnostic.md` — peer/local key cross-check.
- `code/docs/electron-qbeap-decryption-design.md` — decrypt pipeline.
- `code/docs/native-beap-post-flight-report.md` — `WR_QBEAP_DECRYPT_DEBUG=1` and `[qBEAP-decrypt]` logging.

---

## References (file paths in repo)

| Item | Location |
|------|----------|
| `aeadEncrypt` / `encryptCapsulePayloadChunked` | `code/apps/extension-chromium/src/beap-messages/services/beapCrypto.ts` |
| Chunked payload encryption call | `code/apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` (~1359–1362) |
| `aesGcmDecrypt` / chunk decrypt | `code/apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` |
| AAD computation (Electron) | `code/apps/electron-vite-project/electron/main/beap/beapEnvelopeAad.ts` |
