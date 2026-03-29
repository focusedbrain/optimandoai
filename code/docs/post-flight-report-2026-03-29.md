# Post-Flight Report — Full Session (2026-03-29)

**Scope:** Comprehensive state snapshot after recent handshake / qBEAP work.  
**Analysis only** — no code changes in this document.

---

## 1. What Was Implemented This Session

### 1A. Confirmed in this session (git + conversation)

| Item | Files / evidence | Status |
|------|------------------|--------|
| **ensureKeyAgreementKeys paired key generation** | `apps/electron-vite-project/electron/main/handshake/ipc.ts` — `ensureKeyAgreementKeys` now **always** generates ML-KEM and X25519 keypairs in the main process; extension-supplied public-only material is ignored (`_params` unused). | **Implemented** — intended to fix acceptor `local_*` NULL and decrypt failure. |
| **Analysis documentation** | `docs/analysis-acceptor-key-storage.md`, `docs/analysis-linux-decrypt-failure.md` | **Added** (committed with `fb74069b`). |
| **Release workflow** | Build stamp **build5542** (already in `vite.config.ts` / `electron-builder.config.cjs`); extension + Electron rebuilt; `main` pushed to GitHub. | **Done** (operational). |

### 1B. Broader inventory (repository state — not necessarily edited this session)

The following appear in the codebase or prior commits; **this session did not necessarily modify each one**. Status reflects **code presence / docs**, not a full QA pass.

| Feature / fix | Primary location(s) | Status (working / partial / unknown) |
|---------------|---------------------|--------------------------------------|
| **Inline BEAP composer (replaced popup)** | Extension BEAP UI / inline composer paths vs legacy popup | **Partial / product-dependent** — verify in UI. |
| **Electron qBEAP decryption pipeline** | `electron/main/beap/decryptQBeapPackage.ts`, `beapEmailIngestion.ts` | **Working** when handshake row has correct `local_*` + inbound ciphertext; **was broken** on acceptor when `local_x25519_private_key_b64` was NULL (mitigated by paired-key fix). |
| **AES-GCM tag handling** | `decryptQBeapPackage.ts` (payload / chunk decrypt) | **Unknown end-to-end** — failures reported at capsule chunk stage when keys or AAD diverge; see §2. |
| **Outbox / Sent tab** | `sent_beap_outbox` migration v51, `main.ts` inserts/selects | **Present** — **unknown** Linux parity. |
| **Send success feedback** | UI / P2P send paths | **Unknown** — not audited this session. |
| **UI contrast fixes** | Various components | **Partial** (known issue list). |
| **PQ auth (CORS + X-Launch-Secret)** | `main.ts` (CORS headers, launch secret), preload IPC for PQ | **Present in code**. |
| **P2P size limit (100MB)** | `BeapPackageBuilder.ts` `P2P_PACKAGE_JSON_MAX_BYTES`, `ingestion/types.ts`, `preload.ts` | **Implemented** (100 × 1024 × 1024). |
| **AI stream loop fix** | Orchestrator / stream handlers | **Partially fixed** (known issue). |
| **Outbound message detection** | Inbox / depackaging | **Partial** — Linux doc notes outbound vs inbound decrypt confusion. |
| **Reply button for native BEAP** | `EmailInboxView.tsx` — `handleReply` | **Broken / inert** for `direct_beap` / `email_beap` per `analysis-linux-decrypt-failure.md`. |
| **Debug log native BEAP deletion** | Logging only | **Unknown** this session. |
| **Context document upload in chat bar** | Feature-specific components | **Unknown** — not verified. |
| **Field editability when selected for AI** | UI | **Unknown** — not verified. |
| **force peer keys from accept capsule** | `enforcement.ts` (recent commits `3d7d3e96`, `950b8abc`) | **Implemented** on initiator side. |

---

## 2. The Critical Open Bug: AES-GCM / qBEAP Decrypt Failure

### 2A. Documented state (pre– and post–paired-key fix)

**Before `ensureKeyAgreementKeys` always generated locals:**

- Hybrid steps (ML-KEM, X25519, HKDF) could **appear** to run or **fail earlier** depending on branch; the **dominant acceptor failure** was **missing `local_x25519_private_key_b64` / ML-KEM secret** when the extension supplied **public-only** key material — see `docs/analysis-acceptor-key-storage.md`.
- Symptom: **Initiator could decrypt** (correct `peer_*` = acceptor public from capsule); **acceptor could not** (no matching local private).

**After the paired-key fix (commit `fb74069b`):**

- **Expected:** Acceptor DB rows created/updated on accept should have **non-NULL** `local_x25519_private_key_b64` and `local_mlkem768_secret_key_b64` for new handshakes.
- **Not re-verified in this document:** Full **bidirectional** decrypt on Windows and Linux; testers should confirm **both directions** after **deleting old handshakes** and re-establishing.

**If AES-GCM still fails at capsule chunk decrypt** after keys are present:

- Suspects include **AAD mismatch**, **wrong chunk key**, **corrupt ciphertext**, or **header `receiver*` not matching** `local_*` public keys on the row (`decryptQBeapPackage` logs `Key match check`).

---

### 2B. Key flow problem — exact trace

#### SENDER (extension — `BeapPackageBuilder`)

`BeapPackageBuilder.ts` uses `config.selectedRecipient` (lines ~980–1125):

1. **Recipient public keys** — `recipient.peerX25519PublicKey`, `recipient.peerPQPublicKey` (ML-KEM). Grep anchors:

```text
1000:  const hasX25519KeyMaterial = hasValidX25519Key(recipient.peerX25519PublicKey)
1110:  const ecdhResult = await deriveSharedSecretX25519(recipient.peerX25519PublicKey!)
1118:    const peerMlkemPublicKey = recipient.peerPQPublicKey
1125:    pqKemResult = await pqEncapsulate(peerMlkemPublicKey)
```

2. **ML-KEM encapsulate** uses **`recipient.peerPQPublicKey`** (counterparty ML-KEM public).

3. **X25519 DH** uses **`recipient.peerX25519PublicKey`** (counterparty X25519 public).

4. **Where from?** — Not from a separate extension-only SQL DB for BEAP keys. The extension’s `HandshakeRecord` is filled from **`normalizeRecord`** in `handshakeRpc.ts`:

```471:472:apps/extension-chromium/src/handshake/handshakeRpc.ts
    peerX25519PublicKey: raw.peer_x25519_public_key_b64 ?? undefined,
    peerPQPublicKey: raw.peer_mlkem768_public_key_b64 ?? undefined,
```

`raw` comes from **Electron main-process handshake records** over the **handshake RPC / IPC** path — i.e. **`peer_*` columns in the vault `handshakes` table**, projected to the extension.

5. **So for sending:** the builder encrypts to whatever **`peer_*`** the **local Electron DB** says is the counterparty for that `handshake_id`.

#### RECEIVER (Electron main — `decryptQBeapPackage`)

1. Loads **`getHandshakeRecord(db, handshakeId)`** — `local_x25519_private_key_b64`, `local_mlkem768_secret_key_b64`, `local_*_public_*`, etc.
2. **ML-KEM decapsulate** — uses **`local_mlkem768_secret_key_b64`**.
3. **X25519 DH** — uses **`local_x25519_private_key_b64`** with sender’s public from header.
4. **HKDF** — derives **capsuleKey** (and related keys) from the hybrid secret.

#### THE QUESTION — same logical keying event?

- **Source store:** Both **sender’s `peer_*`** (who I encrypt to) and **receiver’s `local_*`** (what I decrypt with) are intended to come from the **same canonical handshake row in the Electron vault DB**, synced to the extension for display/send.
- **They are not independent random stores** — the extension **does not** generate a second unrelated keypair for `peer_*`; it displays what the main process persisted.
- **Failure mode that *looked* like “different stores”:** **`peer_*` on the initiator** correctly held the acceptor’s **public** keys (from accept capsule), while **`local_*` on the acceptor** had **NULL private** (old `ensureKeyAgreementKeys` branch). Same handshake *logically*, but **incomplete local secret material** on the acceptor — **not** two different key generation events in two DBs.

**After always-generating paired keys:** **`local_*` public and private on the acceptor** should match what goes into the **accept capsule** and thus what the **initiator** has as **`peer_*`** — **re-test required**.

---

## 3. All Files Modified (inventory — recent `main`)

From `git log` / session (not exhaustive for entire repo history):

| File | Description |
|------|-------------|
| `code/apps/electron-vite-project/electron/main/handshake/ipc.ts` | `ensureKeyAgreementKeys` — always generate X25519 + ML-KEM pairs; ignore extension public-only keys. |
| `code/docs/analysis-acceptor-key-storage.md` | Trace of accept flow, persistence, `peer_*` vs `local_*`. |
| `code/docs/analysis-linux-decrypt-failure.md` | Linux qBEAP / Reply / outbound-vs-inbound analysis. |

**Earlier related commits (same theme):** `enforcement.ts` / handshake pipeline — peer key force from accept capsule; build stamp churn — see `git log`.

---

## 4. Database Schema Changes (handshake DB)

From `apps/electron-vite-project/electron/main/handshake/db.ts` migration descriptions:

| Version | Description |
|---------|-------------|
| **v50** | `local_x25519_private_key_b64`, `local_x25519_public_key_b64`, `local_mlkem768_secret_key_b64`, `local_mlkem768_public_key_b64` on `handshakes` (local BEAP material for Electron qBEAP decrypt). |
| **v51** | `sent_beap_outbox` table + index (`sent_beap_outbox` ledger for previews/metadata). |

(Additional migrations exist for inbox, P2P, `peer_*` columns, etc. — full list in `db.ts` migration array.)

---

## 5. Known Issues

| Issue | Notes |
|-------|--------|
| **AES-GCM / qBEAP decrypt on acceptor** | Mitigation: paired `ensureKeyAgreementKeys`; **confirm** on fresh handshakes. |
| **AI-ANALYZE-STREAM infinite loop** | Reported as partially fixed; may still reproduce. |
| **Ollama errors when not installed** | Log noise; suppress/filter TBD. |
| **Extension inbox** | Reported broken in places — needs targeted QA. |
| **UI contrast** | Audit done elsewhere; fixes partial. |
| **Reply on native BEAP** | `handleReply` does not handle `direct_beap` / `email_beap` — **platform-independent** gap per analysis doc. |

---

## 6. Architecture Decisions (current)

| Decision | Rationale |
|----------|-----------|
| **Electron-side decrypt** | Vault + SQLCipher + native crypto; extension does not merge private BEAP decrypt for inbox qBEAP in the same way. |
| **Inline composers** | UX direction vs modal popups (degree of rollout varies). |
| **Outbox as separate table** | `sent_beap_outbox` (v51) for sent BEAP metadata/previews without overloading inbox schema. |
| **Always-generate paired keys in `ensureKeyAgreementKeys`** | Guarantees main process holds **both** public (for capsule) and private/secret (for DB) from the **same** keygen — fixes public-only extension path leaving NULL locals. |

---

## 7. Test Results

**Note:** Values below reflect **reported / analytical** state, not a fresh automated run on 2026-03-29.

| Test | Windows | Linux |
|------|---------|-------|
| Send qBEAP (initiator → acceptor) | Expected ✅ after key fix | **?** |
| Send qBEAP (acceptor → initiator) | **?** | **?** |
| Decrypt received message | ✅ initiator (historically); acceptor **was** ❌ before fix | ❌ acceptor reported; outbound confusion documented |
| Inline composer | ✅ reported | ✅ reported |
| PQ encapsulation | ✅ reported | ✅ reported |
| P2P delivery | ✅ reported | ✅ reported |
| Outbox / Sent tab | ✅ reported | **?** |
| Attachment display | ✅ initiator reported | ❌ acceptor reported |

**Action:** Re-run this matrix after installing a build that includes **`fb74069b`** and **new handshakes**.

---

## 8. Next Steps (Priority Order)

1. **Runtime verification:** Initiator → acceptor and acceptor → initiator **decrypt** with **new** handshakes; confirm `local_*` non-NULL in SQLite and `[qBEAP-decrypt]` success on both sides.
2. If GCM still fails with valid keys: **capture** `Key match check` logs + AAD/capsule chunk step — possible separate bug from key provisioning.
3. **AI stream loop** — finish fix + tests.
4. **Suppress Ollama** noise when service absent.
5. **UI contrast** — complete remaining tokens.
6. **Inline email composer** — as scheduled.
7. **Context document upload** — as scheduled.
8. **Extension inbox** — repair paths + regression tests.
9. **Reply** — implement `direct_beap` / `email_beap` in `handleReply` (see Linux analysis doc).

---

## References

- `docs/analysis-acceptor-key-storage.md`
- `docs/analysis-linux-decrypt-failure.md`
- `apps/extension-chromium/src/handshake/handshakeRpc.ts` — `normalizeRecord`
- `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` — qBEAP hybrid encrypt
- `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` — qBEAP decrypt
