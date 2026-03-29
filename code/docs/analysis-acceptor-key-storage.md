# Acceptor Key Storage — Analysis

**Analysis only.** Traces where the acceptor’s BEAP key-agreement material (X25519 private, ML-KEM secret) is generated, stored, sent in the accept capsule, and whether it can be overwritten—`apps/electron-vite-project/electron/main/handshake/`.

**Observed symptom:** Acceptor cannot decrypt inbound messages from the initiator; initiator can decrypt from the acceptor. That is consistent with **missing or mismatched local decrypt material** on the acceptor while the initiator still has the **public** keys from the accept capsule.

---

## Accept flow timeline

T1: `ensureKeyAgreementKeys` called with optional params (`senderX25519PublicKeyB64` / `key_agreement.*` or empty) — `ipc.ts:1070–1073`

T2: Return value `acceptKeyAgreement` passed into `buildAcceptCapsule` as `sender_x25519_public_key_b64` / `sender_mlkem768_public_key_b64`; wire capsule includes those fields — `ipc.ts:1090–1102`, `capsuleBuilder.ts:469–470`

T3: `updateHandshakeRecord` merges BEAP `local_*` from `acceptKeyAgreement` (after `updateHandshakeSigningKeys` for Ed25519) — `ipc.ts:1103–1118`

T4: Initiator ingests accept: keys extracted from capsule → `buildAcceptRecord` + `forcePeerKeysFromAcceptCapsule` update initiator `peer_*` — `enforcement.ts:348–379`, `748–750`, `84–103`

T5: `submitCapsuleViaRpc` on acceptor runs pipeline `buildAcceptRecord` — updates **`peer_*`** and other fields, **not** `local_x25519_private_key_b64` / `local_mlkem768_secret_key_b64` — `ipc.ts:1215`, `enforcement.ts:376–378`, `721–751` (**no T5 overwrite of local BEAP secrets**)

**T3 vs T2:** Capsule is **built (T2) before** BEAP locals are persisted (T3); both use the **same** `acceptKeyAgreement` object—no regeneration between wire and DB. **No `priv_B` overwrite after accept** from a second `ensureKeyAgreementKeys` on the accept path.

---

## ensureKeyAgreementKeys behavior

- **Always generates fresh:** **no** — ML-KEM keygen only if public missing or `length < 100`; X25519 keygen only if public missing or `length < 32`. (`ipc.ts:76–107`)
- **Reuses if passed existing:** **X25519:** yes, keeps caller public if `length ≥ 32` and sets **`sender_x25519_private_key_b64` to `null`**; **ML-KEM:** yes, keeps caller public if `length ≥ 100` and leaves **`sender_mlkem768_secret_key_b64` null** (no keygen).
- **Called N times during accept flow:** **1** — `ipc.ts:1070` only.

**“Double keygen mismatch” (Call 1 accept vs Call 2 elsewhere):** Not what this trace shows for `handshake.accept`: the accept handler calls `ensureKeyAgreementKeys` once. Other call sites (`initiate`, `buildForDownload`) are different operations and do not overwrite the acceptor’s row after accept.

---

## Local key storage (acceptor)

- **Written at:** `ipc.ts:1108–1118` (`case 'handshake.accept'`), `updateHandshakeRecord`.
- **Overwrite behavior:** **`UPDATE`** full row (`db.ts:1388–1418`). `local_*` private/secret: `acceptKeyAgreement ?? recBeapMerge ?? null`; `local_*` public: **always** from `acceptKeyAgreement` (`ipc.ts:1112–1117`).
- **Can be overwritten after accept:** **Not by** `submitCapsuleViaRpc` / `buildAcceptRecord` (those do not set `local_*` BEAP). **Only** by another code path that writes those columns (e.g. a future accept on same row, or initiator-only insert on a different row). **Acceptor handshake folder:** only `ipc.ts` accept merge + `db` helpers for `local_*` application writes.

---

## ALL writes to `local_x25519_private_key_b64`

| # | File | Line | Function | When called | Overwrites? |
|---|------|------|----------|-------------|-------------|
| 1 | `handshake/ipc.ts` | 1112–1113 | `handshake.accept` → `updateHandshakeRecord` | Acceptor accept | Merged: new value or keep prior via `??` |
| 2 | `handshake/initiatorPersist.ts` | 114 | `persistInitiatorHandshakeRecord` → `insertHandshakeRecord` | Initiator after initiate | Insert new row |
| 3 | `handshake/db.ts` | 1256, 1300, 1371–1384, 1414 | serialize / insert / update | Any caller | DB layer |

---

## ALL writes to `local_mlkem768_secret_key_b64`

| # | File | Line | Function | When called | Overwrites? |
|---|------|------|----------|-------------|-------------|
| 1 | `handshake/ipc.ts` | 1115–1116 | `handshake.accept` → `updateHandshakeRecord` | Acceptor accept | Merged: new value or keep prior via `??` |
| 2 | `handshake/initiatorPersist.ts` | 116 | `persistInitiatorHandshakeRecord` | Initiator after initiate | Insert new row |
| 3 | `handshake/db.ts` | 1258, 1302, 1371–1384, 1416 | serialize / insert / update | Any caller | DB layer |

---

## ALL calls to `ensureKeyAgreementKeys`

| # | File | Line | Context | Generates fresh? |
|---|------|------|---------|------------------|
| 1 | `handshake/ipc.ts` | 756 | `handshake.initiate` | Fresh unless extension supplies long-enough publics (then public-only / null secrets) |
| 2 | `handshake/ipc.ts` | 878 | `handshake.buildForDownload` | Same as initiate |
| 3 | `handshake/ipc.ts` | 1070 | `handshake.accept` | Same logic; **one call per accept IPC** |

No other call sites under `electron/main` (grep).

---

## Root cause

The acceptor’s stored **private** material for X25519/ML-KEM can be **null** or **stale** while the **public** keys in the capsule match what the initiator stores, because `ensureKeyAgreementKeys` keeps extension-supplied public keys but sets **`sender_x25519_private_key_b64` to `null`** when a long X25519 public is passed, and **no** `ensureKeyAgreementKeys` second pass overwrites the accept capsule after the fact.

---

## Fix

On **`handshake.accept`**, for native qBEAP decrypt: **always generate and persist paired local key material in the main process** for accept (ignore public-only X25519/ML-KEM from the extension for persistence), **or** require the extension to supply **private/secret** material; **and** when `sender_x25519_private_key_b64` is `null`, **do not** pair a new `local_x25519_public_key_b64` with a stale `recBeapMerge.local_x25519_private_key_b64`—clear or reject.

---

## Step-by-step trace (Steps 1–8)

### Step 1 — Accept flow: key generation (`ipc.ts`)

`case 'handshake.accept':` begins at **972**. `ensureKeyAgreementKeys` is called at **1070–1073**.

**Inputs:** `(params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64` and the ML-KEM equivalents—**may be undefined** if the client sends nothing.

**Returns:** `BeapKeyAgreementMaterial` (`sender_*` public + optional private/secret)—either freshly generated or **public-only** with null private for X25519 when a long public was supplied.

**Exact sequence through persist** (see also code citations at end of this doc):

1. `acceptKeyAgreement = await ensureKeyAgreementKeys({...})` — **1070**
2. Logs — **1075–1088**
3. `buildAcceptCapsule(session, { … sender_x25519_public_key_b64: acceptKeyAgreement.…, sender_mlkem768_public_key_b64: acceptKeyAgreement.… })` — **1090–1102**
4. `updateHandshakeSigningKeys` — **1103–1106**
5. `getHandshakeRecord` + `updateHandshakeRecord` with `local_*` merge — **1108–1118**

### Step 2 — `ensureKeyAgreementKeys` always regenerate? (`ipc.ts` **76–107**)

1. **Existing X25519 public (~44 chars, length ≥ 32):** **Keeps** it; **does not** generate a new X25519 keypair; **`x25519Priv = null`**.
2. **Nothing / short public:** **Generates** fresh X25519 (and ML-KEM if needed).
3. **Same keys twice:** **No** caching across calls; each invocation is independent. Keygen branches produce **new** random material.

---

### Step 3 — Where locals are stored

After `ensureKeyAgreementKeys`, persistence is **`updateHandshakeRecord`** at **1108–1118** with fields:

- `local_x25519_private_key_b64`, `local_x25519_public_key_b64`
- `local_mlkem768_secret_key_b64`, `local_mlkem768_public_key_b64`

**UPDATE** (not INSERT) on existing `handshake_id` via `db.updateHandshakeRecord` (`db.ts:1388–1418`).

### Step 4 — Overwrite after accept

`grep` under `handshake/` for `local_x25519_private_key_b64` / `local_mlkem768_secret_key_b64`: **ipc accept**, **initiatorPersist**, **db**, **types** (no other handshake module writers). **Accept pipeline** `buildAcceptRecord` does not include those columns—**no** post-accept overwrite from `submitCapsuleViaRpc` for local BEAP secrets.

### Step 5 — Multiple `ensureKeyAgreementKeys` calls

Only **three** sites: **initiate**, **buildForDownload**, **accept**—none is “after accept” for the same accept operation in a way that regenerates BEAP locals for that row.

### Step 6 — Wire public keys

**Same variable:** `acceptKeyAgreement` → `buildAcceptCapsule` options → `capsuleBuilder` `HandshakeCapsuleWire` **`sender_x25519_public_key_b64` / `sender_mlkem768_public_key_b64`** — no shadowing in the accept handler.

### Step 7 — Initiator stores `peer_*`

**Read path:** `extractAcceptCapsuleSenderKeyMaterial` or `capsuleObj.sender_*` (`enforcement.ts:62–77`, `348–369`) → **`buildAcceptRecord`** sets `peer_x25519_public_key_b64` / `peer_mlkem768_public_key_b64` (`748–750`) → **`forcePeerKeysFromAcceptCapsule`** direct UPDATE (`84–103`). **Trim** and optional nested keys (`capsule` / `payload`); **no** re-encoding beyond that.

### Step 8 — Timeline clarification

- **T3 after T2** — capsule built, then DB updated; **same** `acceptKeyAgreement`.
- **No T5** that replaces `priv_A` with `priv_B` from a second keygen on the accept IPC path.

---

## Reference: code excerpts

```1070:1118:apps/electron-vite-project/electron/main/handshake/ipc.ts
      const acceptKeyAgreement = await ensureKeyAgreementKeys({
        sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
        sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
      })

      console.log('[HANDSHAKE-ACCEPT] Key agreement for accept capsule:', {
        handshake_id,
        hasX25519: !!acceptKeyAgreement.sender_x25519_public_key_b64?.trim(),
        x25519Len: acceptKeyAgreement.sender_x25519_public_key_b64?.length ?? 0,
        hasMlkem: !!acceptKeyAgreement.sender_mlkem768_public_key_b64?.trim(),
        mlkemLen: acceptKeyAgreement.sender_mlkem768_public_key_b64?.length ?? 0,
      })

      console.log('[HANDSHAKE-ACCEPT-BUILD] Keys going into accept capsule:', {
        x25519: acceptKeyAgreement.sender_x25519_public_key_b64?.substring(0, 20) || 'MISSING',
        x25519Len: acceptKeyAgreement.sender_x25519_public_key_b64?.length || 0,
        mlkem: acceptKeyAgreement.sender_mlkem768_public_key_b64?.substring(0, 20) || 'MISSING',
        mlkemLen: acceptKeyAgreement.sender_mlkem768_public_key_b64?.length || 0,
      })

      const { capsule, keypair } = buildAcceptCapsule(session, {
        handshake_id,
        initiatorUserId,
        initiatorEmail,
        sharing_mode,
        context_blocks: acceptContextBlocks,
        context_commitment: acceptContextCommitment,
        initiator_capsule_hash: record.last_capsule_hash_received,
        ...(p2pEndpoint ? { p2p_endpoint: p2pEndpoint } : {}),
        ...(p2pAuthToken ? { p2p_auth_token: p2pAuthToken } : {}),
        sender_x25519_public_key_b64: acceptKeyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: acceptKeyAgreement.sender_mlkem768_public_key_b64,
      })
      updateHandshakeSigningKeys(db, handshake_id, {
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
      })

      const recBeapMerge = getHandshakeRecord(db, handshake_id)
      if (recBeapMerge) {
        updateHandshakeRecord(db, {
          ...recBeapMerge,
          local_x25519_private_key_b64:
            acceptKeyAgreement.sender_x25519_private_key_b64 ?? recBeapMerge.local_x25519_private_key_b64 ?? null,
          local_x25519_public_key_b64: acceptKeyAgreement.sender_x25519_public_key_b64,
          local_mlkem768_secret_key_b64:
            acceptKeyAgreement.sender_mlkem768_secret_key_b64 ?? recBeapMerge.local_mlkem768_secret_key_b64 ?? null,
          local_mlkem768_public_key_b64: acceptKeyAgreement.sender_mlkem768_public_key_b64,
        })
      }
```

```76:107:apps/electron-vite-project/electron/main/handshake/ipc.ts
async function ensureKeyAgreementKeys(params: {
  sender_x25519_public_key_b64?: string | null
  sender_mlkem768_public_key_b64?: string | null
}): Promise<BeapKeyAgreementMaterial> {
  let mlkemPub = params.sender_mlkem768_public_key_b64?.trim()
  let mlkemSecret: string | null = null
  if (!mlkemPub || mlkemPub.length < 100) {
    const pq = await import('@noble/post-quantum/ml-kem')
    const keypair = pq.ml_kem768.keygen()
    mlkemPub = Buffer.from(keypair.publicKey).toString('base64')
    mlkemSecret = Buffer.from(keypair.secretKey).toString('base64')
  }

  let x25519Pub = params.sender_x25519_public_key_b64?.trim()
  let x25519Priv: string | null = null
  if (!x25519Pub || x25519Pub.length < 32) {
    const priv = x25519.utils.randomPrivateKey()
    const pub = x25519.getPublicKey(priv)
    x25519Priv = Buffer.from(priv).toString('base64')
    x25519Pub = Buffer.from(pub).toString('base64')
  } else {
    // Caller supplied public only (e.g. extension) — no local private for Electron qBEAP decrypt
    x25519Priv = null
  }

  return {
    sender_x25519_public_key_b64: x25519Pub,
    sender_mlkem768_public_key_b64: mlkemPub,
    sender_x25519_private_key_b64: x25519Priv,
    sender_mlkem768_secret_key_b64: mlkemSecret,
  }
}
```
