# Post-Flight Report — qBEAP Decrypt Bug (One-Way / Role-Dependent)

**Date:** 2026-03-29  
**Scope:** Reproducible failure where **one party** cannot decrypt qBEAP while the **other** can, with direction determined by **handshake role** (initiator vs acceptor).  
**Analysis only** — describes observed behavior, evidence, architecture, and ranked hypotheses. Not a substitute for a single confirmed root cause without sender-side logs or DB diff.

---

## 1. The Bug (Observed)

| Direction | Decrypt |
|-----------|---------|
| **Initiator → Acceptor** | **Acceptor fails** to decrypt qBEAP (AES-GCM at capsule chunks). |
| **Acceptor → Initiator** | **Initiator succeeds**. |

Flipping who initiated the handshake flips which side fails for inbound messages. This is **role-dependent**, not “random noise.”

**Symptom location:** Pipeline reports success through **ML-KEM decapsulation**, **X25519**, **hybrid concat**, and **HKDF** (capsule key material), then **AES-GCM decrypt fails** at the capsule chunk stage (`aes-gcm-capsule-chunks` / equivalent path in `decryptQBeapPackage.ts`).

**Important nuance:** If HKDF inputs are wrong, derived keys are wrong and GCM should fail — so “everything ✅ until GCM” must be interpreted carefully: either (a) the logged steps really use the same byte pipeline as GCM, or (b) some **additional** input (AAD, nonce scope, chunk index) diverges without changing the logged hybrid summary, or (c) instrumentation logs “success” at a coarse level while a subtle mismatch exists earlier. Treat **ML-KEM peer mismatch** and **AAD / chunk binding** as competing explanations until pinned by sender logs + DB equality checks.

---

## 2. What the Evidence Says (Pipeline)

From field logs and code alignment:

| Stage | Typical status in reports |
|------|---------------------------|
| ML-KEM-768 decapsulate | Reported ✅ (32-byte secret) |
| X25519 DH | Reported ✅ (32-byte secret) |
| Hybrid secret `SS_PQ \|\| SS_X25519` | Reported ✅ (64 bytes) |
| HKDF → `capsuleKey` (and siblings) | Reported ✅ (32-byte keys) |
| AES-GCM (capsule payload / chunks) | **❌** authentication failure or bad plaintext |

So the failure is **late** in the pipeline: either the **keys are wrong but logs are misleading**, or **keys are right** and **AAD / ciphertext binding** is wrong (canonical header bytes, chunk ordering, nonce reuse assumptions).

---

## 3. Evidence Collected (2026-03-29)

### 3.1 Receiver (initiator) — `[qBEAP-decrypt] KEY IDENTITY CHECK`

Captured when the **initiator** receives (working direction — message from **acceptor**):

```text
ourLocalX25519Pub:   "qFvwysRDnwakepftKTKw7N+3"
ourLocalMlkemPub:    "s9NwKhJpazotF3ik4wlxosOb"
theirPeerX25519Pub:  "mTMw2FdT66+yXfByaMDlPkqd"
theirPeerMlkemPub:   "ucCZ4pCOFkyJThlAMUlwy3EL"
headerSenderX25519:  "i1Kk8xV/yZp89euor0/dwyjK"
ourRole:             "initiator"
```

**How to read this row**

- **`ourLocal*`** — Initiator’s **handshake** key-agreement public keys (`local_*` on the initiator’s `handshakes` row). Used only for **identity / comparison logging** here; X25519 decrypt uses **private** `local_*` + header sender pub.
- **`theirPeer*`** — On the initiator’s row, **`peer_*`** is “the counterparty” = **acceptor’s handshake public keys** (from the accept capsule / processing). So `theirPeerX25519Pub` / `theirPeerMlkemPub` are the **acceptor’s** published keys as seen by the initiator.
- **`headerSenderX25519`** — For this inbound package, the **sender** (acceptor) placed their **device** X25519 public key in `header.crypto.senderX25519PublicKeyB64` (see `BeapPackageBuilder` + `x25519KeyAgreement.ts`).

### 3.2 Handshake accept (initiator received accept capsule)

```text
senderX25519:  "mTMw2FdT66+yXfByaMDlPkqd"  (acceptor’s handshake X25519 public)
senderMlkem:   "ucCZ4pCOFkyJThlAMUlwy3EL"  (acceptor’s handshake ML-KEM public)
```

These **match** `theirPeerX25519Pub` / `theirPeerMlkemPub` on the initiator — consistent with `buildAcceptRecord` + `forcePeerKeysFromAcceptCapsule` persisting acceptor keys onto the initiator’s `peer_*` columns.

### 3.3 Key observation — two public X25519 “identities” for the acceptor

- **`theirPeerX25519Pub`** = `"mTMw2FdT66+..."` — acceptor’s **handshake** X25519 public (what the initiator stores as `peer_x25519_public_key_b64`).
- **`headerSenderX25519`** = `"i1Kk8xV/..."` — acceptor’s **device** X25519 public (what qBEAP puts in the wire header for **sending**).

These **differ by design** in the current implementation: send path uses **device** keys for ECDH + header; handshake rows store **capsule / ensureKeyAgreementKeys** keys in `local_*` / `peer_*`. That **does not violate ECDH** by itself: hybrid X25519 uses **device private × peer public** on the sender and **local handshake private × sender device public** on the receiver (see `docs/analysis-x25519-key-identity.md`).

So **“two identities”** explains confusing logs; it is **not** alone proof of broken math.

### 3.4 MISSING — sender-side `[BEAP-BUILD] KEYS`

Diagnostic was added in `BeapPackageBuilder.ts` (renderer / extension bundle). **`console.log` from the extension does not appear in the Electron main-process terminal.** It appears in:

- **Chrome DevTools** for the extension (service worker / offscreen / context where the builder runs), or  
- Embedded extension console inside Electron if that path loads the extension with devtools.

**Action:** Capture **`[BEAP-BUILD] KEYS`** from the **sender’s** DevTools when reproducing, or add a **main-process** log on the send IPC path if product allows.

---

## 4. Architecture — Where Keys Come From

### 4.1 Sender (`BeapPackageBuilder.ts` — extension / renderer)

1. **X25519:** `deriveSharedSecretX25519(recipient.peerX25519PublicKey)` uses **`getOrCreateDeviceKeypair()`** — **device** private key (`beap_x25519_device_keypair` in extension storage).
2. **Header:** `senderX25519PublicKeyB64` = **`getDeviceX25519PublicKey()`** — same device keypair’s public key.
3. **ML-KEM:** `pqEncapsulate(recipient.peerPQPublicKey)` — uses **`peer_mlkem768_public_key_b64`** projected as `peerPQPublicKey` from the **same handshake row** the UI selected (`handshakeRpc.ts` / shims).

So the sender always encrypts **to** whatever **`peer_*`** the **local** handshake projection says is the counterparty, while signing the classical leg with **device** X25519.

### 4.2 Receiver (`decryptQBeapPackage.ts` — Electron main)

1. **X25519:** `x25519.getSharedSecret(localPriv, peerPub)` with `localPriv` = **`local_x25519_private_key_b64`**, `peerPub` from **`header.crypto.senderX25519PublicKeyB64`** (sender’s **device** public).
2. **ML-KEM:** `ml_kem768.decapsulate(ciphertext, sk)` with `sk` = **`local_mlkem768_secret_key_b64`**.
3. **HKDF / AES-GCM:** Derived from hybrid secret + salt; GCM uses **`computeEnvelopeAadBytes(header)`** for AAD (`beapEnvelopeAad`).

### 4.3 Handshake key generation (`ensureKeyAgreementKeys` in `ipc.ts`)

Generates **fresh** X25519 + ML-KEM in the **main process**; persisted as **`local_*`** on the corresponding party’s row. Extension-supplied public-only hints in `_params` are **not** used to pick those bytes (by design in current code).

### 4.4 Peer keys on the initiator after accept (`enforcement.ts`)

`forcePeerKeysFromAcceptCapsule` **UPDATE**s `peer_x25519_public_key_b64` and `peer_mlkem768_public_key_b64` from the accept capsule so the initiator’s row matches the acceptor’s published keys — mitigating drift from `buildAcceptRecord` alone.

---

## 5. Gap Analysis — Why One Direction Fails

### 5.1 What must be true for decrypt to succeed

For party **R** decrypting a message from party **S**:

1. **ML-KEM:** `encapsulate(peer_mlkem_public_on_S_sender_machine)` must use the **same** ML-KEM **public** key as **R**’s **`local_mlkem768_public_key_b64`** on **R**’s machine. Otherwise decapsulate yields a different shared secret.
2. **X25519:** **S** uses **device** private × **R**’s public from **S**’s `peer_x25519_public_key_b64`. **R** uses **handshake** private × **S**’s device public from header. This matches **iff** **S**’s `peer_x25519` for **R** equals **R**’s **`local_x25519_public_key_b64`** on **R**’s DB (see X25519 analysis doc).
3. **AAD / chunks:** Builder and decrypt must agree on **canonical header bytes** and **chunk indices / nonces** for the same package version.

### 5.2 Asymmetry of the data path

- **Initiator → Acceptor (fails on acceptor):**  
  **Sender** = initiator (extension on initiator). Sender reads **`peer_*` from the initiator’s Electron DB** (counterparty = acceptor).  
  **Receiver** = acceptor (decrypt on acceptor). Receiver uses **`local_*` from the acceptor’s DB**.

  For this to work, **initiator’s `peer_*`** must equal **acceptor’s `local_*` public keys** (same keygen event as stored on acceptor). If the initiator’s row has **stale or wrong** `peer_mlkem768_public_key_b64` / `peer_x25519_public_key_b64` for the acceptor while the acceptor’s **`local_*`** were **rotated** or **never synced** to the initiator’s view, **only this direction breaks**: the initiator encapsulates to the **wrong** ML-KEM public key → wrong hybrid → GCM fails on acceptor.

- **Acceptor → Initiator (works on initiator):**  
  **Sender** = acceptor; **`peer_*`** on **acceptor’s** row must match **initiator’s `local_*` public** keys. If that row stayed consistent (e.g. initiator keys stable, accept path wrote peer keys correctly), decrypt succeeds.

So **one-way failure** is exactly what you expect when **`peer_*` on side A’s machine ≠ `local_*` public on side B’s machine**, while the **reverse** mapping is still correct. The bug is often **stale or asymmetric DB projection**, not necessarily “device vs handshake” in isolation.

### 5.3 Why “device vs handshake” still matters for debugging

Logs will show **different strings** for the same person (device pub in header vs handshake pub in `peer_*`). That is **expected** with current sender code. **Do not** treat inequality of `headerSenderX25519` vs `theirPeerX25519Pub` as proof of broken ECDH; **do** compare:

- **Sender’s** `recipPeerMlkem` / `recipPeerX25519` (**`[BEAP-BUILD] KEYS`**) to **receiver’s** `ourLocalMlkemPub` / `ourLocalX25519Pub` on the **receiver** machine for the **same** `handshake_id`.

### 5.4 Alternative — AAD / envelope parity

If keys are verified equal but GCM still fails, next suspects are:

- **`computeEnvelopeAadBytes`** differing between extension builder and main decrypt (field ordering, optional sections, version flags).
- **Chunking:** index sorting, combined AAD per chunk vs single envelope AAD.
- **Eligibility / inner envelope** if additional MAC layers exist on the payload path.

These tend to be **symmetric** unless builder emits different header shapes per role — less likely than **peer/local mismatch**, but keep in the checklist.

---

## 6. Root Cause Hypotheses (Ranked)

| Rank | Hypothesis | Falsify / confirm |
|------|------------|-------------------|
| 1 | **Initiator’s `peer_*` for the acceptor does not match acceptor’s current `local_*` public keys** (especially ML-KEM). Causes wrong encapsulation from initiator extension → wrong hybrid on acceptor. | Compare **`[BEAP-BUILD] KEYS`** on initiator send to **`ourLocal*`** on acceptor decrypt; SQL on both DBs for same `handshake_id`. |
| 2 | **Stale handshake RPC / cached extension record** so UI send uses old `peerPQPublicKey`. | Hard-refresh extension, re-fetch handshakes, compare RPC payload to SQLite. |
| 3 | **Second key rotation** on acceptor (re-accept, repair) without initiator ingesting new peer keys. | Audit logs for `ensureKeyAgreementKeys` / accept replay; compare `forcePeerKeysFromAcceptCapsule` runs. |
| 4 | **AAD / chunk / header parity** bug (less likely if strictly one-way with same code version). | Binary diff of `computeEnvelopeAadBytes` input on both sides; enable verbose builder validation if present. |

---

## 7. What To Do Next (Operational)

1. **Sender log (renderer):** Open **Chrome extension DevTools** (or Electron’s extension debugger) and capture **`[BEAP-BUILD] KEYS`** when **initiator sends** to acceptor.
2. **Receiver log (main):** Keep **`[qBEAP-decrypt] KEY IDENTITY CHECK`** on acceptor when decrypt fails.
3. **Compare (same handshake):**
   - `recipPeerX25519` ↔ acceptor `ourLocalX25519Pub`
   - `recipPeerMlkem` ↔ acceptor `ourLocalMlkemPub`
   - `devicePub` ↔ `headerSenderX25519` (when acceptor is sender; when initiator is sender, same pattern with roles swapped)
4. **SQL snapshot (both machines if possible):**

```sql
SELECT handshake_id, state, local_role,
  substr(peer_x25519_public_key_b64, 1, 24) AS peer_x25519,
  substr(peer_mlkem768_public_key_b64, 1, 24) AS peer_mlkem,
  substr(local_x25519_public_key_b64, 1, 24) AS local_x25519,
  substr(local_mlkem768_public_key_b64, 1, 24) AS local_mlkem
FROM handshakes
WHERE handshake_id = '<id>';
```

5. **If peer ≠ counterparty local public:** Trace why initiator’s row did not update after accept; confirm `forcePeerKeysFromAcceptCapsule` and handshake RPC normalization.

---

## 8. Files (Reference)

| File | Role |
|------|------|
| `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` | qBEAP encrypt; `[BEAP-BUILD] KEYS` |
| `apps/extension-chromium/src/beap-messages/services/x25519KeyAgreement.ts` | Device X25519 ECDH |
| `apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts` | qBEAP decrypt; KEY IDENTITY CHECK |
| `apps/electron-vite-project/electron/main/beap/beapEnvelopeAad.ts` | AAD bytes for GCM |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` | `ensureKeyAgreementKeys`, accept path |
| `apps/electron-vite-project/electron/main/handshake/enforcement.ts` | `forcePeerKeysFromAcceptCapsule`, `buildAcceptRecord` |
| `apps/extension-chromium/src/handshake/handshakeRpc.ts` | Maps DB `peer_*` → extension `peerX25519` / `peerPQ` |
| `docs/analysis-x25519-key-identity.md` | Device vs handshake ECDH analysis |

---

## 9. Commits (Referenced in Investigation)

- `fb74069b` — `ensureKeyAgreementKeys` always generates paired keys in main (addresses NULL `local_*` on acceptor).
- `95a07271` — outbound qBEAP detection + Reply-related behavior (context from history).
- `3d7d3e96` / `950b8abc` — `forcePeerKeysFromAcceptCapsule` and accept-path peer key alignment.

---

## 10. Session Inventory (Brief)

Earlier session notes also tracked: inline composer, outbox v51, PQ auth, P2P limits, Linux decrypt / Reply gaps — see previous sections of this file’s history and `docs/analysis-linux-decrypt-failure.md`. They are **orthogonal** to the one-way qBEAP key-direction bug unless outbound routing picks the wrong handshake or message type.

---

## 11. Summary

The **role-dependent** decrypt failure is consistent with **asymmetric wrong `peer_*` on the sender’s machine relative to the receiver’s `local_*` public keys**, especially **ML-KEM**, while the **reverse direction** still has a consistent peer/local pair. **Device X25519 in the header vs handshake X25519 in `peer_*`** is a **red herring** for ECDH correctness if the math and peer publics align; it **does** explain confusing logs. **Confirm with sender-side `[BEAP-BUILD] KEYS`** and cross-DB equality checks before changing crypto primitives.

---

## References

- `docs/analysis-x25519-key-identity.md`
- `docs/analysis-acceptor-key-storage.md`
- `docs/analysis-linux-decrypt-failure.md`
