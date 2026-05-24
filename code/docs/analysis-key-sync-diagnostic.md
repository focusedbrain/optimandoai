# Key Sync Diagnostic (Windows ↔ Linux qBEAP)

**Priority:** CRITICAL  
**Type:** Analysis and runbook only (no code changes required to use this document).

## Symptom

Same codebase, same logical handshake pair (e.g. `id@wrdesk.com` ↔ `info@optimando.ai`). **Windows** decrypts qBEAP successfully; **Linux** fails at **`aes-gcm-capsule-chunks`**. Earlier steps report success (ML-KEM decapsulate 32 bytes, X25519 DH 32 bytes, hybrid 64 bytes, HKDF → 32-byte keys). **AES-GCM failure implies the derived `capsuleKey` does not match what the sender used** — i.e. key material agreement is broken somewhere above AES.

## Why AES-GCM fails last

If ML-KEM, X25519, hybrid, and HKDF all “succeed” in the sense of producing non-empty buffers, but **GCM still fails**, the usual explanation is:

- The **receiver** derived keys using **its** stored `local_*` / `peer_*` handshake keys and the **incoming ciphertext’s** encapsulated/ephemeral material.
- The **sender** derived keys using **its** stored keys when encrypting.

Those two views must describe the **same** long-term public keys for each party. If **sender’s idea of recipient public keys ≠ recipient’s actual local keys**, hybrid input to HKDF differs → **`capsuleKey` differs** → GCM fails even when every intermediate step “runs.”

Plausible causes (not mutually exclusive):

1. **Peer vs local mismatch** — Sender encrypts to **stale or wrong** `peer_*_public_key_b64` (recipient rotated keys; re-handshake only on one side; wrong row selected).
2. **HKDF salt/info mismatch** — Same codebase makes this less likely unless one side runs a different build or branch.
3. **Hybrid byte order** — Same codebase: unlikely if versions match; still verify identical app/extension builds on both machines.
4. **ML-KEM decapsulate** — Wrong ciphertext or wrong secret key yields wrong shared secret (would often show up as length/step logs; still compare keys in §1).
5. **X25519** — Same as (4) for ECDH side.
6. **Different `handshake_id`** — Two different DB rows; “same pair” in email UI is not the same as identical `handshake_id` on both disks.

---

## Step 1: Dump handshake keys on BOTH machines

### Data locations

| OS      | Typical userData / DB area |
|---------|-----------------------------|
| Windows | `C:\Users\<user>\.opengiraffe\electron-data\` — look for `*.db` (handshake data is tied to the app’s DB path; vault may be SQLCipher). |
| Linux   | `~/.opengiraffe/electron-data/` — same idea. |

The **`handshakes`** table lives in the handshake DB schema (`electron/main/handshake/db.ts`). Important: column is **`state`**, not `status`. Allowed states include `PENDING_ACCEPT`, `ACCEPTED`, `ACTIVE`, etc.

### Option A — Temporary IPC handler (recommended)

Wire this in **`electron/main/handshake/ipc.ts`** or next to other `ipcMain.handle` registrations in **`electron/main.ts`**, using the same DB accessor the main process already uses. In this codebase, **`getHandshakeDb()` is `async`** (see `main.ts`); the handler must **`await` it**.

```ts
ipcMain.handle('debug:dumpHandshakeKeys', async () => {
  const db = await getHandshakeDb()
  if (!db) return { error: 'no_db' }
  const rows = db.prepare(`
    SELECT
      handshake_id,
      state,
      substr(local_x25519_public_key_b64, 1, 20) AS local_x25519_pub_start,
      length(local_x25519_public_key_b64) AS local_x25519_pub_len,
      substr(local_x25519_private_key_b64, 1, 20) AS local_x25519_priv_start,
      length(local_x25519_private_key_b64) AS local_x25519_priv_len,
      substr(local_mlkem768_public_key_b64, 1, 20) AS local_mlkem_pub_start,
      length(local_mlkem768_public_key_b64) AS local_mlkem_pub_len,
      substr(local_mlkem768_secret_key_b64, 1, 20) AS local_mlkem_sec_start,
      length(local_mlkem768_secret_key_b64) AS local_mlkem_sec_len,
      substr(peer_x25519_public_key_b64, 1, 20) AS peer_x25519_pub_start,
      length(peer_x25519_public_key_b64) AS peer_x25519_pub_len,
      substr(peer_mlkem768_public_key_b64, 1, 20) AS peer_mlkem_pub_start,
      length(peer_mlkem768_public_key_b64) AS peer_mlkem_pub_len
    FROM handshakes
    WHERE state IN ('ACTIVE', 'ACCEPTED', 'PENDING_ACCEPT')
    ORDER BY created_at DESC
  `).all()
  console.log('[DEBUG] Handshake keys:', JSON.stringify(rows, null, 2))
  return rows
})
```

Expose from **`electron/preload.ts`** (pattern must match your existing preload API):

```ts
dumpHandshakeKeys: () => ipcRenderer.invoke('debug:dumpHandshakeKeys'),
```

Call from the **renderer** DevTools console on **each** machine (adjust API surface to your actual `window.*` exposure):

```js
// Example — replace with your real bridge name
window.electron?.dumpHandshakeKeys?.().then((r) => console.log(JSON.stringify(r, null, 2)))
```

### Option B — Log during decrypt

In **`electron/main/beap/decryptQBeapPackage.ts`**, existing logs include lengths. For a pairwise compare without full keys, add **first 20 characters** of base64 for each stored handshake public key (only in a **temporary debug build**):

```ts
console.log('[qBEAP-decrypt] Key material (detail):', {
  localX25519PubStart: hs.local_x25519_public_key_b64?.substring(0, 20),
  localMlkemPubStart: hs.local_mlkem768_public_key_b64?.substring(0, 20),
  peerX25519PubStart: hs.peer_x25519_public_key_b64?.substring(0, 20),
  peerMlkemPubStart: hs.peer_mlkem768_public_key_b64?.substring(0, 20),
})
```

Also enable hex previews for one failing message:

```bash
WR_QBEAP_DECRYPT_DEBUG=1
```

(See `decryptQBeapPackage.ts` and `code/docs/native-beap-post-flight-report.md`.)

---

## Step 2: Cross-check the key relationship

For messages **from Windows (sender) → Linux (receiver)**:

| Windows (sender) DB field | Must equal | Linux (receiver) DB field |
|----------------------------|------------|---------------------------|
| `peer_x25519_public_key_b64` | = | `local_x25519_public_key_b64` |
| `peer_mlkem768_public_key_b64` | = | `local_mlkem768_public_key_b64` |

For messages **Linux → Windows**, swap roles:

| Linux (sender) | Must equal | Windows (receiver) |
|----------------|------------|---------------------|
| `peer_x25519_public_key_b64` | = | `local_x25519_public_key_b64` |
| `peer_mlkem768_public_key_b64` | = | `local_mlkem768_public_key_b64` |

Compare **full base64 strings** (or secure hashes) in production; first-20-char prefixes are only a quick sanity check.

---

## Step 3: When keys were generated vs exchanged

Expected handshake flow:

1. **Initiator** generates local keypairs → sends **public** keys in the initiate capsule.
2. **Acceptor** stores initiator’s keys as **`peer_*`**, generates **local** keys → sends **public** keys in accept.
3. **Initiator** stores acceptor’s keys as **`peer_*`**.

Failure modes:

- One side **re-handshook** and has a **new** `handshake_id` / new local keys, while the other still has **old** `peer_*` → encrypt/decrypt mismatch.
- Capsules with new public keys **never applied** on the peer (sync/email delivery issue).
- UI shows “the same contact” but DB row is **stale** or **wrong handshake** selected.

**Action:** Record **`handshake_id`** on both machines for the relationship. They must refer to the **same** logical handshake for the keys to be comparable.

---

## Step 4: Sender-side package construction

The sender’s builder uses **recipient** public keys from **sender’s** DB (`peer_*` columns). Inspect call sites and field names:

```bash
grep -nE "recipientX25519|recipientMlkem|peerX25519|peerMlkem|peer_x25519|peer_mlkem" \
  code/apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts | head -40
```

Confirm logs (if you add them) show the same **`peer_*`** prefixes as Step 1 on the sender.

---

## Step 5: Map findings to root cause

| Finding | Meaning | Typical fix |
|--------|---------|-------------|
| `Windows.peer_x25519` ≠ `Linux.local_x25519` | Sender encrypts to wrong X25519 peer key | Re-establish handshake on **both** sides; verify capsule delivery |
| `Windows.peer_mlkem` ≠ `Linux.local_mlkem` | ML-KEM peer key mismatch | Same |
| Keys line up but decrypt fails | Non-key issue: nonce, AAD, chunk layout, separate GCM tag encoding | `WR_QBEAP_DECRYPT_DEBUG=1` + compare `aes-gcm-capsule-chunks` inputs to `electron-qbeap-decryption-design.md` |
| Different `handshake_id` | Not the same handshake row | Align on one handshake; retire stale rows |
| NULL `peer_*` on sender | Never stored peer keys from accept/initiate | Complete handshake; fix ingest |
| NULL `local_*` on receiver | Keys not persisted | Migration / re-handshake |

---

## Output template (fill in after measurements)

```markdown
# Key Sync Diagnostic

## Machine A (Windows — id@wrdesk.com)
- Handshake ID: [value]
- local_x25519_pub (first 20): [value]
- local_mlkem_pub (first 20): [value]
- peer_x25519_pub (first 20): [value]
- peer_mlkem_pub (first 20): [value]
- All key lengths: [x25519 pub/priv, mlkem pub/sec — note lengths from query]

## Machine B (Linux — info@optimando.ai)
- Handshake ID: [value]
- local_x25519_pub (first 20): [value]
- local_mlkem_pub (first 20): [value]
- peer_x25519_pub (first 20): [value]
- peer_mlkem_pub (first 20): [value]
- All key lengths: [same]

## Cross-check
- Windows.peer_x25519 == Linux.local_x25519? [yes/no]
- Windows.peer_mlkem == Linux.local_mlkem? [yes/no]
- Linux.peer_x25519 == Windows.local_x25519? [yes/no]
- Linux.peer_mlkem == Windows.local_mlkem? [yes/no]
- Same handshake_id? [yes/no]

## Root cause
[One sentence: what is mismatched and why]

## Fix
[Specific steps — e.g. revoke old handshake, new initiate/accept, reload extension, confirm both apps same version/build]
```

---

## Related docs

- `code/docs/electron-qbeap-decryption-design.md` — decrypt pipeline and steps.
- `code/docs/native-beap-post-flight-report.md` — `WR_QBEAP_DECRYPT_DEBUG`, `[qBEAP-decrypt]` logging.
- `code/docs/HANDSHAKE_SECURITY.md` — handshake security model.
