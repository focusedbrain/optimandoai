# X25519 Key Identity Analysis

Analysis of whether qBEAP encryption uses mismatched X25519 identities (extension **device** keypair vs Electron **handshake** `local_*` keys). Evidence is from the current codebase only.

---

## Sender (`BeapPackageBuilder`)

**DH private key source:** **Device** keypair — not the handshake row.

- `deriveSharedSecretX25519(recipient.peerX25519PublicKey!)` is called when building the package.
- `deriveSharedSecretX25519` loads the keypair via `getOrCreateDeviceKeypair()` and performs ECDH with `deviceKeypair.privateKey` (see `x25519KeyAgreement.ts`).

**Header `senderX25519PublicKeyB64` source:** **Device** public key.

- Set with `const senderX25519PublicKeyB64 = await getDeviceX25519PublicKey()`, which returns `getOrCreateDeviceKeypair().publicKey`.

**Recipient public key source:** **`peerX25519PublicKey`** on the selected recipient — mapped from the handshake record’s `peer_x25519_public_key_b64` (see extension `handshakeRpc.ts` and Electron `src/shims/handshakeRpc.ts`).

**Storage for device keys:** `beap_x25519_device_keypair` in `chrome.storage.local` (or `localStorage` fallback), constant `STORAGE_KEY` in `x25519KeyAgreement.ts`.

**Conclusion (Steps 1–2):** The sender uses **(A)** a per-device key from extension storage, **not** (B) the handshake `local_*` columns. The header carries the **same** device keypair’s public key as the private key used in ECDH — **internally consistent on the sender side.**

---

## Receiver (`decryptQBeapPackage`)

**DH private key source:** **Handshake** row — `hs.local_x25519_private_key_b64`.

**Peer (sender) public key for DH:** **`cryptoHdr.senderX25519PublicKeyB64`** from the package header — not read from `peer_*` for the X25519 step.

**Conclusion (Step 3):** The receiver uses **(A)** `local_x25519_private_key_b64` from the handshakes table, **not** a device-level vault key in this path.

---

## Handshake key generation (Electron main)

Handshake-scoped X25519 (and ML-KEM) material is produced in `ensureKeyAgreementKeys` (`electron/main/handshake/ipc.ts`). The function **always generates new random keys** in the main process. The `_params` object includes optional extension-supplied public keys, but those parameters are **not used** to select or derive the returned X25519 key material — implementation is “generate fresh X25519 + ML-KEM in main.”

That material is persisted as `local_x25519_*` / `local_mlkem768_*` on the handshake record (initiator persist, accept path, etc.). So **handshake `local_*` keys are not the extension device keys** unless some other code path explicitly aligns them (the cited `ensureKeyAgreementKeys` body does not).

---

## Match analysis

| Question | Answer |
|----------|--------|
| Sender DH private matches header public (same keypair)? | **Yes** — both come from the device keypair (`getOrCreateDeviceKeypair` / `getDeviceX25519PublicKey`). |
| Header sender public equals receiver’s `peer_x25519_public_key_b64`? | **Generally no** — `peer_*` stores the **counterparty’s** key-agreement public key from the handshake capsule (typically the **handshake-generated** sender key from the other side), while the header carries the **sender’s device** public key for this qBEAP message. Those are **different** identities for the same party unless they were explicitly made equal elsewhere. |
| Receiver DH private matches receiver `local_*` public in DB? | **Yes** — both refer to the same persisted handshake keypair on the receiving row (by design of storage). |

---

## ECDH consistency (Step 4–6)

For a message from **Alice** to **Bob**:

- **Alice (extension)** computes: `X25519(alice_device_private, bob_peer_public)` where `bob_peer_public` is `recipient.peerX25519PublicKey` from Alice’s handshake row — i.e. Bob’s published handshake public key (from `peer_x25519_public_key_b64`).
- **Bob (Electron decrypt)** computes: `X25519(bob_handshake_private, alice_public_from_header)` where `alice_public_from_header` is `senderX25519PublicKeyB64` — Alice’s **device** public key.

Standard X25519 symmetry: these two scalings yield the **same** shared secret **if** `bob_peer_public` is the public key corresponding to `bob_handshake_private`, and Alice’s header public corresponds to `alice_device_private`. So the **“device vs handshake” split across roles** (Alice uses device, Bob uses handshake local) does **not** by itself break ECDH — it mixes two keypairs on the wire in a way ECDH allows.

Where the **hypothesis would become a real failure** is different:

1. **Wrong peer key on the sender:** If `peerX25519PublicKey` did not match the receiver’s actual `local_x25519_public_key_b64` for that handshake (stale row, wrong handshake selected, corrupted sync), then Alice would mix **Alice_device** with a **wrong** Bob public key → wrong secret while Bob still uses his real handshake private key and Alice’s device public from the header → **decrypt fails.**

2. **Confusing identity checks:** Logging that compares `receiverX25519PublicKeyB64` in the header to `local_x25519_public_key_b64` is checking **receiver binding** in the header, not whether the **sender’s** header key matches `peer_*` — a **string mismatch** between sender **device** pub and sender **handshake** pub stored as peer on the other side is **expected** if those were never unified.

---

## Initiator vs acceptor asymmetry (Step 5)

Asymmetry in success/failure is **not** explained solely by “one side uses device, one uses handshake” — that pairing is **symmetric in ECDH** when peer/header keys are correct.

Asymmetry **is** explained if **one direction** has correct `peer_x25519_public_key_b64` for the counterparty’s handshake public key and the **other direction** does not, or if eligibility / AAD / handshake selection differs. That is a **data / routing** issue, not “ECDH cannot mix device and handshake keys.”

---

## Root cause (one sentence)

**The codebase uses the extension device X25519 keypair for qBEAP send (and header) and handshake-persisted `local_*` keys for native decrypt; that split does not inherently break X25519 ECDH, but the sender’s `peerX25519PublicKey` must be the counterparty’s handshake public key matching their `local_x25519_private_key_b64`, and the header must remain the device public key matching `deriveSharedSecretX25519` — failure modes are inconsistent peer material or broken handshake identity alignment, not merely “two keypairs exist.”**

---

## Fix (directional)

1. **Product/crypto alignment:** If the intended design is “qBEAP uses the same key-agreement material as the handshake capsule,” the extension should derive ECDH using the **handshake-scoped** private key (persisted or securely provided for that `handshake_id`), not only `beap_x25519_device_keypair`, and put the matching public key in the header — **or** persist and use **device** keys in the handshake row so `local_*` and extension behavior match.

2. **Operational:** Ensure `peer_x25519_public_key_b64` on the sender’s selected handshake always equals the receiver’s `local_x25519_public_key_b64` for that handshake (correct RPC normalization and DB updates).

3. **Electron:** `ensureKeyAgreementKeys` currently ignores extension-supplied X25519 material; if the goal is a single source of truth with the extension device key, that function would need to **use** those params (or another agreed channel) instead of always generating new keys — today it **cannot** match the extension device key by construction.

---

## Code references

**Sender — device public in header + ECDH:**

```1105:1110:apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
  // Get sender's X25519 public key for inclusion in header
  // Per canon A.3.054.10: receiver needs this for ECDH key agreement
  const senderX25519PublicKeyB64 = await getDeviceX25519PublicKey()
  
  // Step 1: X25519 ECDH (classical component)
  const ecdhResult = await deriveSharedSecretX25519(recipient.peerX25519PublicKey!)
```

**`deriveSharedSecretX25519` — always device private:**

```224:237:apps/extension-chromium/src/beap-messages/services/x25519KeyAgreement.ts
export async function deriveSharedSecretX25519(
  peerPublicKeyBase64: string,
  _localKeypairId?: string // Unused for now, always uses device keypair
): Promise<X25519KeyAgreementResult> {
  // ...
  // Get our device keypair
  const deviceKeypair = await getOrCreateDeviceKeypair()
  
  // Perform ECDH
  const sharedSecret = x25519ECDH(peerPublicKeyBase64, deviceKeypair.privateKey)
```

**Receiver — handshake local private + header sender public:**

```237:329:apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts
  const localX25519PrivB64 = hs.local_x25519_private_key_b64?.trim()
  // ...
  const senderX25519PubB64 =
    typeof cryptoHdr.senderX25519PublicKeyB64 === 'string' ? cryptoHdr.senderX25519PublicKeyB64.trim() : ''
  // ...
    const peerPub = fromBase64(senderX25519PubB64)
    const localPriv = fromBase64(localX25519PrivB64)
    // ...
    const x25519Secret = x25519.getSharedSecret(localPriv, peerPub)
```

**Handshake keys — fresh random in main (params unused for X25519 selection):**

```74:95:apps/electron-vite-project/electron/main/handshake/ipc.ts
// Key Agreement: always generate paired keys in main process (qBEAP decrypt requires local secrets) ──

async function ensureKeyAgreementKeys(_params: {
  sender_x25519_public_key_b64?: string | null
  sender_mlkem768_public_key_b64?: string | null
}): Promise<BeapKeyAgreementMaterial> {
  const pq = await import('@noble/post-quantum/ml-kem')
  const mlkemKeypair = pq.ml_kem768.keygen()
  // ...
  const x25519PrivKey = x25519.utils.randomPrivateKey()
  const x25519PubKey = x25519.getPublicKey(x25519PrivKey)
  // ...
  return {
    sender_x25519_public_key_b64: x25519Pub,
    // ...
  }
}
```
