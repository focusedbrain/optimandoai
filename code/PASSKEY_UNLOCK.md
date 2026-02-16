# Passkey (WebAuthn) Vault Unlock — Architecture & Threat Model

## Overview

WRVault supports passkey-based vault unlock as a **Pro+ feature**, allowing users
to unlock their vault with a platform authenticator (fingerprint, face recognition,
or security key) via the WebAuthn PRF extension.  The master password remains
available as a fallback.

Passkeys do **not** directly encrypt the database.  Instead, they control access to
the vault KEK (Key Encryption Key) by wrapping it with a key derived from the
authenticator's PRF output.

---

## Terminology

| Term | Meaning |
|------|---------|
| **KEK** | Key Encryption Key — 32-byte key that wraps per-record DEKs. |
| **DEK** | Data Encryption Key — 32-byte key for SQLCipher + field-level encryption. |
| **PRF** | Pseudo-Random Function extension — WebAuthn extension that returns a deterministic secret tied to a credential + salt. |
| **PRF salt** | 32-byte random value generated during enrollment; stored in provider state. |
| **Wrapping key** | 32-byte AES key derived via `HKDF-SHA256(PRF output, prfSalt, "wrv-passkey-kek-wrap-v1")`. |
| **wrappedKEK** | AES-256-GCM ciphertext: the vault KEK encrypted with the wrapping key. |

---

## Enrollment Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│ Prerequisite: Vault is UNLOCKED (KEK in memory), user is Pro+       │
└───────────────────────────────────────────────────────────────────────┘

  UI (Extension Popup)                        Backend (Electron Main)
  ─────────────────────                       ──────────────────────────
  1. Click "Enable Passkey"
       │
       ├─── POST /passkey/enroll-begin ──────▶ Generate random prfSalt (32 B)
       │                                       Generate random challenge (32 B)
       │◀── { challenge, prfSalt } ───────────
       │
  2. navigator.credentials.create({
       publicKey: {
         rp: { name: "WRVault" },
         challenge,
         extensions: {
           prf: { eval: { first: prfSalt } }
         },
         authenticatorSelection: {
           authenticatorAttachment: "platform",
           userVerification: "required"
         }
       }
     })
       │
       ├─── Authenticator produces credential + PRF output
       │
  3. Extract prfOutput, credentialId
       │
       ├─── POST /passkey/enroll-complete ──▶ Derive wrappingKey:
       │    { credentialId, prfOutput,          HKDF-SHA256(prfOutput, prfSalt,
       │      rpId }                                        "wrv-passkey-kek-wrap-v1", 32)
       │                                       wrappedKEK = AES-256-GCM(KEK, wrappingKey)
       │                                       Zeroize wrappingKey, prfOutput
       │                                       Store ProviderState:
       │                                         { type: "passkey",
       │                                           data: { credentialId, prfSalt,
       │                                                   wrappedKEK, rpId } }
       │◀── { success: true } ────────────────
```

---

## Unlock Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│ Prerequisite: Vault is LOCKED, passkey provider is enrolled, Pro+    │
└───────────────────────────────────────────────────────────────────────┘

  UI (Extension Popup)                        Backend (Electron Main)
  ─────────────────────                       ──────────────────────────
  1. Click "Unlock with Passkey"
       │
       ├─── POST /passkey/unlock-begin ─────▶ Read meta file (unencrypted JSON)
       │                                       Find passkey ProviderState
       │◀── { credentialId, prfSalt,           Generate fresh challenge
       │      challenge, rpId } ───────────────
       │
  2. navigator.credentials.get({
       publicKey: {
         challenge,
         allowCredentials: [{ id: credentialId }],
         userVerification: "required",
         extensions: {
           prf: { eval: { first: prfSalt } }
         }
       }
     })
       │
       ├─── Authenticator returns PRF output (same as enrollment)
       │
  3. Extract prfOutput
       │
       ├─── POST /passkey/unlock-complete ──▶ Derive wrappingKey (HKDF)
       │    { prfOutput, vaultId }              Unwrap KEK from wrappedKEK
       │                                        (AES-256-GCM decrypt)
       │                                       Unwrap DEK from meta.wrappedDEK
       │                                        using KEK
       │                                       Open SQLCipher DB with DEK
       │                                       Create session
       │                                       Zeroize wrappingKey, prfOutput
       │◀── { success: true } ────────────────
```

---

## Lock Flow

When the vault is locked (manually or via autolock):

1. `VaultService.lock()` calls `provider.lock()` on the active provider.
2. `PasskeyUnlockProvider.lock()` zeroizes its cached KEK buffer.
3. `VaultService` zeroizes the session's KEK and DEK buffers.
4. The database connection is closed.

---

## Stored Metadata

All passkey data is stored in the vault's `vault_<id>.meta.json` file under
`unlockProviders[]`:

```json
{
  "salt": "...",
  "wrappedDEK": "...",
  "kdfParams": { "memoryCost": 16384, "timeCost": 8, "parallelism": 1 },
  "unlockProviders": [
    {
      "type": "passphrase",
      "name": "Master Password",
      "enrolled_at": 1700000000000,
      "data": {}
    },
    {
      "type": "passkey",
      "name": "Passkey (WebAuthn)",
      "enrolled_at": 1700100000000,
      "data": {
        "credentialId": "<base64url>",
        "prfSalt": "<base64, 32 bytes>",
        "wrappedKEK": "<base64, 60 bytes — nonce+ciphertext+tag>",
        "rpId": "chrome-extension://..."
      }
    }
  ],
  "activeProviderType": "passphrase"
}
```

### What is stored

| Field | Sensitive? | Purpose |
|-------|-----------|---------|
| `credentialId` | No | Identifies which authenticator credential to use |
| `prfSalt` | No | Input to PRF extension during ceremonies |
| `wrappedKEK` | Ciphertext | KEK encrypted with the PRF-derived wrapping key |
| `rpId` | No | RP ID for the assertion ceremony |

### What is NOT stored

- Plaintext KEK / VMK
- PRF output (only used transiently)
- Wrapping key (derived, used, zeroized)
- Authenticator private keys

---

## Threat Model

### What passkey protects against

| Threat | Mitigation |
|--------|-----------|
| **Stolen vault file on disk** | Without the authenticator, the wrappedKEK cannot be unwrapped. The PRF output is unique to the credential and cannot be brute-forced offline. |
| **Shoulder surfing / password capture** | User never types a password when using passkey unlock. |
| **Weak master password** | Passkey enrollment wraps the same KEK with a cryptographically random PRF output — not password-derived. |
| **Remote attack** | WebAuthn requires `userVerification: "required"` — physical presence at the device is mandatory. |

### What passkey does NOT protect against

| Threat | Explanation |
|--------|-----------|
| **Full device compromise** | If the attacker has kernel-level access, they can intercept the PRF output or read the KEK from memory. |
| **Stolen authenticator** | If the physical device (e.g., YubiKey, laptop with Windows Hello) is stolen and unlocked, the attacker can perform the WebAuthn ceremony. |
| **PRF extension unavailable** | Older browsers/authenticators may not support PRF. Enrollment fails gracefully with a clear error message. |

### Trust boundaries

```
┌─────────────────────────────────┐
│ Extension UI (untrusted origin) │──── WebAuthn ceremony happens here
│  └── PRF output in JS memory    │     (browser-mediated, not spoofable)
└──────────────┬──────────────────┘
               │ HTTP (localhost)
┌──────────────▼──────────────────┐
│ Electron Main Process           │──── KEK wrapping/unwrapping
│  └── In-memory KEK/DEK          │     (Node.js, no DOM access)
└──────────────┬──────────────────┘
               │ SQLCipher
┌──────────────▼──────────────────┐
│ Encrypted SQLite Database       │──── Data at rest
└─────────────────────────────────┘
```

---

## Recovery / Fallback

- **Master password always remains as fallback** unless the user explicitly
  deletes the passphrase provider (not supported in the current UI).
- If a user's authenticator is lost/broken, they can:
  1. Unlock with master password
  2. Remove the passkey (Settings → Remove Passkey)
  3. Re-enroll a new passkey
- If the user's tier drops below Pro, passkey unlock routes return HTTP 500
  with "Passkey requires Pro+ tier".  The user can still unlock with the
  master password (passphrase unlock has no tier requirement).

---

## Capability Gating

| Operation | Required Tier | Check Location |
|-----------|--------------|----------------|
| Enroll passkey | Pro+ | `VaultService.beginPasskeyEnroll()` + HTTP route |
| Complete enrollment | Pro+ | `VaultService.completePasskeyEnroll()` + HTTP route |
| Unlock with passkey | Pro+ | `VaultService.completePasskeyUnlock()` + HTTP route |
| Remove passkey | Pro+ | `VaultService.removePasskeyProvider()` + HTTP route |
| See passkey UI (settings) | Pro+ | Extension UI tier check |
| See passkey button (unlock) | Any* | Shown if enrolled (functional only for Pro+) |

\* The "Unlock with Passkey" button is shown if the provider is enrolled,
regardless of current tier, so users aren't confused by its disappearance.
The backend enforces the tier check and returns an error if the tier has dropped.

---

## Cryptographic Details

### Key Derivation

```
PRF output (≥32 bytes, from authenticator)
    │
    ▼
HKDF-SHA256(
  ikm:  PRF output,
  salt: prfSalt (32 bytes, random, stored),
  info: "wrv-passkey-kek-wrap-v1",
  len:  32
)
    │
    ▼
wrapping_key (32 bytes AES-256)
```

### KEK Wrapping

```
AES-256-GCM(
  key:       wrapping_key,
  plaintext: KEK (32 bytes),
  nonce:     random 12 bytes
)
    │
    ▼
wrappedKEK = nonce (12) || ciphertext (32) || authTag (16) = 60 bytes
```

### Security Properties

- **Deterministic PRF**: Same (credential, prfSalt) always produces the same output.
- **No offline attack**: Without the authenticator, no amount of computation can
  recover the PRF output from the stored prfSalt or wrappedKEK.
- **Forward secrecy on removal**: When passkey is removed, the wrappedKEK is
  deleted from the meta file.  The authenticator's credential still exists on the
  device but is useless without the wrappedKEK.
- **Zeroization**: wrappingKey and prfOutput buffers are zeroized immediately
  after use on the backend.

---

## API Routes

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| POST | `/api/vault/passkey/enroll-begin` | Vault unlocked, Pro+ | — | `{ challenge, prfSalt }` |
| POST | `/api/vault/passkey/enroll-complete` | Vault unlocked, Pro+ | `{ credentialId, prfOutput, rpId }` | `{ success }` |
| POST | `/api/vault/passkey/remove` | Vault unlocked, Pro+ | — | `{ success }` |
| POST | `/api/vault/passkey/unlock-begin` | Vault locked | `{ vaultId? }` | `{ challenge, credentialId, prfSalt, rpId }` |
| POST | `/api/vault/passkey/unlock-complete` | Pro+ | `{ prfOutput, vaultId? }` | `{ success }` |

---

## Future Considerations

1. **Step-up authentication**: Certain record types (documents, handshake contexts)
   could require a passkey assertion even when the vault is already open.
2. **Multiple passkeys**: The current design stores one passkey credential per vault.
   Extending to multiple is straightforward (array of passkey ProviderStates).
3. **Cross-context portability**: The credential is bound to the WebAuthn RP ID
   (extension origin).  To share between Electron renderer and extension, a common
   RP ID (e.g., a domain) would be needed.
4. **Synced passkeys**: Platform authenticators may sync credentials across devices
   (e.g., iCloud Keychain, Google Password Manager).  The PRF output should remain
   consistent for synced credentials, but this depends on the platform implementation.
