# Vault Unlock Providers — Architecture & Lifecycle

## Overview

The vault unlock flow is abstracted behind an `UnlockProvider` interface so
that multiple authentication methods can be supported without changing the
core `VaultService` logic.  The first (and currently only) provider is
**PassphraseUnlockProvider** — identical in behaviour to the previous
hard-coded passphrase/PIN flow.

Future providers (e.g. Passkey/WebAuthn, hardware tokens, biometrics) will
implement the same interface.

---

## UnlockProvider Interface

```typescript
interface UnlockProvider {
  readonly id: UnlockProviderType   // 'passphrase' | 'passkey' | …
  readonly name: string             // Human-readable label

  isAvailable(): boolean
  enroll(password, dek, kdfParams): Promise<EnrollResult>
  unlock(credential, meta): Promise<UnlockResult>
  lock(): void
}
```

### Lifecycle

```
┌──────────────┐
│  createVault  │
│               │
│  1. generateRandomKey() → DEK
│  2. resolveProvider(type)
│  3. provider.enroll(password, DEK)
│     → { salt, wrappedDEK, kek, providerState }
│  4. createVaultDB(DEK)
│  5. saveVaultMeta(…, providerState)
│  6. session = { vmk: DEK, kek, providerType }
└──────────────┘

┌──────────────┐
│    unlock     │
│               │
│  1. loadVaultMetaRaw() → { salt, wrappedDEK, kdfParams, providerStates }
│  2. resolveProvider(activeProviderType)
│  3. provider.unlock(password, meta)
│     → { kek, dek }
│  4. openVaultDB(dek)
│  5. session = { vmk: dek, kek, providerType }
└──────────────┘

┌──────────────┐
│     lock      │
│               │
│  1. decryptCache.flush()
│  2. closeVaultDB()
│  3. zeroize(session.vmk)
│  4. zeroize(session.kek)
│  5. provider.lock()      ← provider clears its own material
│  6. session = null
└──────────────┘
```

---

## PassphraseUnlockProvider (Default)

| Operation | What it does |
|-----------|--------------|
| `isAvailable()` | Always returns `true` |
| `enroll(pw, dek)` | generateSalt → deriveKEK(pw, salt) → wrapDEK(dek, kek) → return artefacts |
| `unlock(pw, meta)` | deriveKEK(pw, meta.salt) → unwrapDEK(meta.wrappedDEK, kek) → return { kek, dek } |
| `lock()` | zeroize(cachedKEK) |

The passphrase provider's behaviour is **byte-for-byte identical** to the
previous hard-coded logic — the same scrypt parameters, the same AES-256-GCM
wrapping, the same zeroization.  Existing vaults unlock without any
migration.

---

## Provider Metadata Storage

Provider state is stored in the **vault meta file** (`vault_<id>.meta.json`)
alongside the existing fields:

```json
{
  "salt": "<base64>",
  "wrappedDEK": "<base64>",
  "kdfParams": { "memoryCost": 16384, "timeCost": 8, "parallelism": 1 },
  "unlockProviders": [
    {
      "type": "passphrase",
      "name": "Master Password",
      "enrolled_at": 1739664000000,
      "data": {}
    }
  ],
  "activeProviderType": "passphrase"
}
```

### Backwards compatibility

- **Old meta files** (without `unlockProviders` / `activeProviderType`) are
  read without error.  Missing fields default to:
  - `providerStates = []` (treated as passphrase-only)
  - `activeProviderType = 'passphrase'`
- **New meta files** are readable by old code — old code simply ignores the
  extra fields (`JSON.parse` doesn't fail on unknown keys).

---

## VaultSession Extension

```typescript
interface VaultSession {
  vmk: Buffer
  kek: Buffer
  extensionToken: string
  lastActivity: number
  providerType?: string   // ← NEW: which provider was used for this session
}
```

## VaultStatus Extension

```typescript
interface VaultStatus {
  // … existing fields …
  unlockProviders?: Array<{ id: string; name: string }>   // ← NEW
  activeProviderType?: string                              // ← NEW
}
```

---

## Provider Registry

```typescript
const PROVIDER_REGISTRY: Record<UnlockProviderType, () => UnlockProvider>
```

- `'passphrase'` → `PassphraseUnlockProvider` (always available)
- `'passkey'` → throws "not yet implemented" (placeholder)

Helper functions:
- `resolveProvider(type?)` — returns provider instance (defaults to passphrase)
- `listAvailableProviders()` — returns `[{ id, name }]` of providers that are
  currently available in the runtime environment

---

## UI Changes

The unlock screen now reads `status.unlockProviders` and
`status.activeProviderType` from the vault status response.

- **Single provider (current):** The provider selector is a hidden field.
  The unlock screen looks and behaves exactly as before.
- **Multiple providers (future):** A dropdown appears above the password
  field, allowing the user to choose between authentication methods.
  When a non-passphrase provider is selected, the UI will toggle to show
  that provider's flow (e.g. a "Use Passkey" button instead of a password
  input).

---

## Security Invariants

1. **KEK never persists to disk** — only the wrapped DEK is stored.
2. **Provider.lock() is always called** — VaultService.lock() calls
   `provider.lock()` before clearing the session reference.
3. **Zeroization is doubled** — VaultService zeroizes session.kek and
   session.vmk AND the provider zeroizes its own cachedKEK.
4. **Rate limiting is provider-agnostic** — the 5-attempts-per-minute
   limit applies regardless of which provider is used.
5. **Meta file is not encrypted** — it contains only salt, wrapped DEK,
   KDF params, and provider enumerations.  No secrets.

---

## File Inventory

| File | Role |
|------|------|
| `apps/electron-vite-project/electron/main/vault/unlockProvider.ts` | Interface + PassphraseUnlockProvider + registry |
| `apps/electron-vite-project/electron/main/vault/service.ts` | Refactored create/unlock/lock to delegate to provider |
| `apps/electron-vite-project/electron/main/vault/types.ts` | Extended VaultSession + VaultStatus with provider fields |
| `apps/extension-chromium/src/vault/types.ts` | Extended frontend VaultStatus with provider fields |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | Future-proof unlock screen with provider selector |

---

## Adding a New Provider (Future)

1. Create a class implementing `UnlockProvider` (e.g. `PasskeyUnlockProvider`)
2. Add the type to `UnlockProviderType` union
3. Register it in `PROVIDER_REGISTRY`
4. Add enrollment UI (settings page)
5. Add unlock UI toggle (provider selector → passkey button)
6. The rest of VaultService works unchanged
