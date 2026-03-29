# Linux qBEAP Decrypt — Analysis Report

**Scope:** Codebase analysis only (no code changes).  
**Question:** Why does qBEAP show “Waiting for decryption…” on Linux while Windows decrypts, for the same repo build? Why is Reply inert on native BEAP on Linux?

---

## Executive summary

The main process **does** import and call `decryptQBeapPackage` during P2P BEAP ingestion when `header.encoding === 'qBEAP'`, `handshake_id` is set, and `beap_package_json` is present. The implementation in `decryptQBeapPackage.ts` is **real** (AES-GCM, HKDF, ML-KEM, X25519), not a stub returning `null` unconditionally.

Decryption **requires** that the ciphertext was encrypted **to this device’s local receiver public keys** (the keys stored on the `handshakes` row). If the message is an **outbound** send from Linux to another party, the package is encrypted **to the recipient’s** keys; the sender’s local private keys are **not** the keys needed to unwrap that envelope. In that case main-process decrypt **should** fail on every OS, and the UI will keep `depackaged_json.format === 'beap_qbeap_pending_main'` until some other path merges decrypted content—or the user is viewing a copy they cannot decrypt.

The **Reply** button is wired in the UI but **`handleReply` in `EmailInboxView.tsx` does not handle `direct_beap` / `email_beap`**, so it is a **no-op** for native BEAP. That behavior is **platform-independent** (not Linux-specific).

---

## 1. Decrypt pipeline status

| Check | Finding |
|--------|---------|
| **`decryptQBeapPackage` in build** | **Yes.** Bundled main output contains strings such as `[qBEAP-decrypt]` and `decryptQBeapPackage` (see `dist-electron/main-*.js` after build). |
| **Called from `beapEmailIngestion`** | **Yes.** `import { decryptQBeapPackage } from '../beap/decryptQBeapPackage'` and `tryQbeapDecryptInbox` → `await decryptQBeapPackage(pkg, handshakeId, db)` when `hdr.header?.encoding === 'qBEAP'`. |
| **Implementation** | **Real.** Returns `DecryptedQBeapContent \| null`; `null` on missing DB/handshake, wrong encoding, missing `header.crypto`, missing local X25519 private key, crypto failures, etc. |

### 1A. Conditions on the call path

From `tryQbeapDecryptInbox` (`beapEmailIngestion.ts`):

- Returns early with `{ decrypted: false }` if **`!handshakeId`** or **`!pkg.trim()`**.
- Parses package JSON; requires **`header.encoding === 'qBEAP'`**; otherwise no decrypt.
- **`decryptQBeapPackage(pkg, handshakeId, db)`** uses **`getHandshakeRecord(db, handshakeId)`** on the **same** DB handle passed in.

`inbox_messages` and `handshakes` are both created by migrations in `electron/main/handshake/db.ts` against the **vault SQLCipher database** (see comments and migration block for inbox tables). Email IPC `resolveDb()` / `getDb()` supplies that unified DB for `processPendingP2PBeapEmails(db)`. So **handshake_id missing** on the row would skip decrypt; **wrong DB** would not apply if the app uses the normal vault-backed `getDb()` path.

### 1B. P2P drain vs email-ingest-only paths

`tryQbeapDecryptInbox` is invoked from:

- **`processPendingP2PBeapEmails`** — after resolving/creating the `direct_beap` inbox row from `p2p_pending_beap`.
- **`retryPendingQbeapDecrypt`** — rows with `depackaged_json` containing `beap_qbeap_pending_main`, non-empty `beap_package_json`, and `handshake_id` (runs at most once per process).

If a message **never** goes through this pipeline (e.g. different ingest path without `handshake_id` / wrong `source_type`), decrypt may not run.

### 1C. Stub check

`decryptQBeapPackage.ts` is **not** a stub: it logs `[qBEAP-decrypt] Package header.crypto`, `[qBEAP-decrypt] Key material`, `[qBEAP-decrypt] Key match check`, and fails with explicit warnings (e.g. missing local X25519 private key, handshake not found).

---

## 2. Handshake key material

### 2A. Required columns (v50)

Migration **v50** adds `local_x25519_private_key_b64`, `local_x25519_public_key_b64`, `local_mlkem768_secret_key_b64`, `local_mlkem768_public_key_b64` on `handshakes` (`db.ts`).

`decryptQBeapPackage` requires at minimum **local X25519 private** (and uses ML-KEM secret for the PQ step per implementation). If `local_x25519_private_key_b64` is missing, it logs and returns `null`.

### 2B. Migration tracking

Use table **`handshake_schema_migrations`** (not a generic `schema_version` name in this codebase):

```sql
SELECT version, applied_at, description
FROM handshake_schema_migrations
ORDER BY version DESC
LIMIT 5;
```

`PRAGMA table_info(handshakes);` confirms v50 columns exist.

### 2C. Vault

Handshake tables **live in the vault SQLCipher DB**. If the vault is **locked** or the DB is not opened, `getDb()` may be unavailable—ingest/decrypt paths would not run correctly. This is **environmental** (user must unlock), not Linux-vs-Windows in code.

### 2D. Receiver key match (cryptographic)

The implementation logs **`Key match check`**: it compares **`receiverX25519PublicKeyB64` / `receiverMlkemPublicKeyB64` from the package header** to **`hs.local_x25519_public_key_b64` / `hs.local_mlkem768_public_key_b64`**.

**Implication:** Decryption succeeds only when this machine is the **intended recipient** of the qBEAP envelope. A message **sent from** Linux **to** `info@optimando.ai` is encrypted to the **recipient’s** public keys. The **sender’s** stored keys are not the decryption keys for that ciphertext. So seeing **`beap_qbeap_pending_main`** on the **sender** inbox copy is **consistent** with the crypto design—not a Linux bug.

---

## 3. Message analysis (what to verify in SQLite)

Example queries (adjust DB path to your machine):

```sql
SELECT id, source_type, handshake_id,
       substr(body_text, 1, 100) AS body_preview,
       substr(depackaged_json, 1, 200) AS dp_preview,
       CASE WHEN beap_package_json IS NOT NULL THEN length(beap_package_json) ELSE 0 END AS pkg_size
FROM inbox_messages
WHERE source_type = 'direct_beap'
ORDER BY received_at DESC
LIMIT 5;
```

**Interpretation:**

| Field | Role |
|--------|------|
| **`handshake_id`** | Required for `tryQbeapDecryptInbox`. |
| **`beap_package_json`** | Required input for decrypt. |
| **`depackaged_json`** | If `format` is **`beap_qbeap_pending_main`**, main process stored metadata-only excerpt; decrypt did not replace it with `beap_qbeap_decrypted`. |

**Outbound vs inbox copy:** If From is the **local** account and To is the peer, this row may still be a **relay echo** or **sent copy**; decryptability depends on whether the package was encrypted **to keys this device holds**. **Outbox** (`sent_beap_outbox`) records sent metadata separately and does not imply inbox decrypt.

---

## 4. Terminal logs (what to grep on Linux)

When P2P drain runs, expect:

- `[BEAP-INBOX] Processing N pending P2P BEAP message(s)`
- On decrypt attempt: `[qBEAP-decrypt] Package header.crypto:`, `[qBEAP-decrypt] Key material:`, `[qBEAP-decrypt] Key match check:`

Failure modes logged in code include:

- `[qBEAP-decrypt] Missing db or handshakeId`
- `[qBEAP-decrypt] Handshake not found: …`
- `[qBEAP-decrypt] Missing local X25519 private key for handshake: … (re-establish handshake for native qBEAP decrypt)`
- Warnings from `[BEAP-INBOX] qBEAP decrypt skipped: …`

**If no `[qBEAP-decrypt]` lines:** possible causes include: package not `qBEAP`, empty `handshake_id`, drain not running, or process exiting before decrypt.

**Debug:** Set `WR_QBEAP_DECRYPT_DEBUG=1` for extra HKDF/GCM detail (`decryptQBeapPackage.ts`).

---

## 5. Reply button

### 5A. Handler location

- **`EmailMessageDetail.tsx`**: `handleReply` calls `onReply?.(message)` (lines ~578–580).
- **`EmailInboxView.tsx`**: `onReply={handleReply}` on `EmailMessageDetail` (~2892).

### 5B. Actual behavior

```2312:2321:apps/electron-vite-project/src/components/EmailInboxView.tsx
  const handleReply = useCallback((msg: InboxMessage) => {
    const src = msg.source_type as string
    if (src === 'email_plain' || src === 'depackaged') {
      setComposeMode('email')
      setComposeReplyTo({
        to: msg.from_address || '',
        subject: 'Re: ' + (msg.subject || ''),
        body: '',
      })
    }
  }, [])
```

**There is no branch for `direct_beap` or `email_beap`.** Clicking Reply on native BEAP does **nothing** (no compose mode, no capsule focus). The button still renders when `onReply` is passed (`EmailMessageDetail` ~735–751) and `title` says “Reply with BEAP” for BEAP types—**misleading** relative to behavior.

### 5C. Recommendation (analysis)

- **Hide** Reply for `direct_beap` / `email_beap`, **or** wire it to open BEAP compose / focus the right-panel capsule reply path.
- Document that **capsule reply** is the intended flow for native BEAP (`InboxDetailAiPanel`).

This is **not Linux-specific**.

---

## Output format (filled)

### 1. Decrypt pipeline status

- **decryptQBeapPackage in build:** **yes** (present in bundled main JS).
- **Called from beapEmailIngestion:** **yes** (`tryQbeapDecryptInbox` → `decryptQBeapPackage`).
- **Implementation:** **real** (returns `null` only on validation/crypto failure).

### 2. Handshake key material

- **v50 migration applied:** **Verify on device** via `handshake_schema_migrations` and `PRAGMA table_info(handshakes)`.
- **Vault status:** **Must be unlocked** for normal vault DB access (codebase assumption).
- **Handshake has local keys:** **Required** for decrypt; **verify** `local_x25519_private_key_b64` (and ML-KEM secret per algorithm path).
- **Column names present:** **yes** in source migrations (v50).

### 3. Message analysis

- **handshake_id on message:** **Must be non-null** for decrypt path (else early exit).
- **beap_package_json:** **Must be present** for decrypt input.
- **depackaged_json format:** **`beap_qbeap_pending_main`** indicates pending; success is **`beap_qbeap_decrypted`**.
- **Is this an outbound message?** **If the ciphertext was encrypted to the peer’s keys, the sender cannot decrypt—likely root cause for “same message” on sender machine vs recipient on Windows.**

### 4. Terminal logs

- **[qBEAP-decrypt] lines:** **present** when decrypt runs; **absent** if preconditions fail or drain does not run.
- **Failure step:** See logged `cryptoStep` / warnings in `decryptQBeapPackage.ts` (not reproduced here without runtime).
- **Error:** Use exact lines from Linux terminal (e.g. missing local key, handshake not found, key mismatch).

### 5. Reply button

- **Handler:** `EmailInboxView.tsx` `handleReply` (~2312); `EmailMessageDetail.tsx` forwards to `onReply` (~578).
- **Works for direct_beap:** **no** (no branch).
- **Should show for direct_beap:** **As implemented, misleading** — shows but does nothing useful.
- **Recommendation:** **hide or wire to BEAP/capsule reply**; add short UX copy pointing to the right panel.

### 6. Root cause (hypothesis ranking)

1. **Strong:** Message is **outbound / wrong role for decrypt** — qBEAP is encrypted **to the recipient’s** public keys; **sender’s** inbox copy **cannot** be decrypted with **sender** local keys. Windows may be showing a **recipient** view or a different row.
2. **Plausible:** **Missing v50 key material** on Linux handshake row (old handshake, or migration before keys populated).
3. **Plausible:** **Vault locked** or DB not opened so handshake row unreadable.
4. **Weaker for “same codebase”:** Stale build—**verify** with grep on Linux `dist-electron` for `[qBEAP-decrypt]`.

### 7. Fix (recommended steps — product/engineering, not code in this doc)

1. On Linux, capture logs for one failing message: confirm **`Key match check`** (`x25519Match` / `mlkemMatch`) and whether **local private keys** exist.
2. Confirm **role**: Is this inbox row the **sender’s copy** of an outbound qBEAP? If yes, **do not expect** main-process decrypt; use **outbox** / sent ledger for sent copy, or decrypt only on **recipient**.
3. If keys are missing, **re-establish handshake** or backfill local BEAP keys (per app’s handshake flows).
4. **Reply UX:** Hide or implement Reply for native BEAP as above.

---

*Generated from repository analysis: `beapEmailIngestion.ts`, `decryptQBeapPackage.ts`, `handshake/db.ts`, `EmailInboxView.tsx`, `EmailMessageDetail.tsx`, bundled `dist-electron`.*
