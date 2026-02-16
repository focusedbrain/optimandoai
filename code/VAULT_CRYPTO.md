# WRVault Cryptographic Architecture

## Overview

WRVault uses a **two-layer encryption** model:

1. **Database-level encryption** — SQLCipher (AES-256-CBC with HMAC-SHA512)
   encrypts the entire `.db` file at rest.
2. **Per-record envelope encryption** (schema\_version = 2) — each vault item
   has its own random 256-bit Data Encryption Key (DEK) that is wrapped
   (encrypted) with a vault-level Key Encryption Key (KEK).

Unlocking the vault produces the KEK in memory.  Individual records are
decrypted **only when accessed** (lazy decryption).

---

## Key Hierarchy

```
Master Password
      │
      ▼  scrypt (N=16384, r=8, p=1)
   ┌──────┐
   │ KEK  │  32 bytes — Key Encryption Key
   └──┬───┘
      │
      ├── Unwraps vault-level DEK (for SQLCipher access)
      │         │
      │         ▼  AES-256-GCM unwrap
      │      ┌──────┐
      │      │ DEK  │  32 bytes — used as SQLCipher key (hex)
      │      └──────┘
      │
      └── Wraps / unwraps per-record DEKs
                │
                ▼  AES-256-GCM wrap (per record)
           ┌────────────┐
           │ Record DEK │  32 bytes — unique per vault item
           └─────┬──────┘
                 │
                 ▼  XChaCha20-Poly1305 AEAD
           ┌──────────┐
           │Ciphertext │  Encrypted fields JSON blob
           └──────────┘
```

### Key Roles

| Key         | Lifetime         | Purpose                                  |
|-------------|------------------|------------------------------------------|
| KEK         | In-memory while unlocked; zeroized on lock | Wrap/unwrap per-record DEKs |
| Vault DEK   | In-memory while unlocked; zeroized on lock | SQLCipher database key + legacy HKDF root |
| Record DEK  | Ephemeral — exists only during encrypt/decrypt; zeroized immediately | Encrypt/decrypt a single record's fields |

---

## Algorithms

| Operation                | Algorithm                    | Library                  |
|--------------------------|------------------------------|--------------------------|
| KDF (password → KEK)    | scrypt (N=16384, r=8, p=1)   | Node.js `crypto.scrypt`  |
| Key wrapping (KEK → DEK)| AES-256-GCM (12-byte nonce)  | Node.js `crypto`         |
| Record encryption        | XChaCha20-Poly1305 AEAD      | `libsodium-wrappers`     |
| Database encryption      | AES-256-CBC + HMAC-SHA512    | SQLCipher via `better-sqlite3` |
| Legacy field key derivation | HKDF-SHA256              | Node.js `crypto.hkdfSync` |

---

## Schema Versions

### Version 1 (Legacy)

- Fields stored in `fields_json` column as a JSON array.
- Each field's `value` is individually encrypted using:
  `DEK → HKDF(context="field-encryption", info=itemId) → XChaCha20-Poly1305`
- Problem: Having the DEK in memory means ALL fields of ALL items can be
  derived and decrypted.

### Version 2 (Envelope)

New columns added to `vault_items` (additive migration):

| Column           | Type    | Description                                    |
|------------------|---------|------------------------------------------------|
| `wrapped_dek`    | BLOB    | AES-256-GCM wrapped per-record DEK (60 bytes)  |
| `ciphertext`     | BLOB    | XChaCha20-Poly1305 encrypted fields JSON       |
| `record_type`    | TEXT    | VaultRecordType (for capability gating)         |
| `meta`           | TEXT    | Cleartext JSON metadata (future use)            |
| `schema_version` | INTEGER | `1` = legacy, `2` = envelope                   |

For v2 records, `fields_json` is set to `'[]'` (empty) — all sensitive data
lives in `ciphertext`.

---

## Lifecycle

### Vault Creation

1. Generate random 32-byte salt and 32-byte DEK.
2. Derive KEK from master password via scrypt.
3. Wrap DEK with KEK using AES-256-GCM → `wrappedDEK`.
4. Store `{salt, wrappedDEK, kdfParams}` in metadata file.
5. Create SQLCipher database keyed with DEK (hex).
6. Store both KEK and DEK in `VaultSession`.

### Vault Unlock

1. Load metadata (salt, wrappedDEK, kdfParams) from file.
2. Derive KEK from master password via scrypt.
3. Unwrap DEK with KEK.
4. Open SQLCipher database with DEK.
5. Run additive schema migration (envelope columns).
6. Store both KEK and DEK in `VaultSession`.
7. **No records are decrypted at this point.**

### Creating a Record (Write)

1. Serialize all fields to JSON.
2. Generate random 32-byte record DEK.
3. Encrypt fields JSON with record DEK (XChaCha20-Poly1305) → `ciphertext`.
4. Wrap record DEK with KEK (AES-256-GCM) → `wrappedDEK`.
5. Zeroize record DEK.
6. INSERT row with `schema_version=2`, `wrapped_dek`, `ciphertext`, `fields_json='[]'`.

### Listing Records

- Returns **metadata only** for v2 records: `id`, `title`, `category`,
  `domain`, `favorite`, timestamps.
- `fields` array is empty (`[]`) — no cryptographic operations performed.
- Legacy v1 records still decrypt inline for backwards compatibility.

### Reading a Single Record

1. **Capability check** — verify tier can access the record's category.
   This happens BEFORE any cryptographic operation (fail-closed).
2. Check in-memory decrypt cache (TTL 60s, max 16 entries).
3. If cache miss:
   a. Load `wrapped_dek` and `ciphertext` from DB.
   b. Unwrap record DEK with KEK.
   c. Decrypt ciphertext with record DEK.
   d. Zeroize record DEK.
   e. Parse JSON → fields array.
   f. Cache the decrypted JSON (TTL 60s).
4. Return item with decrypted fields.

### Vault Lock

1. Flush decrypt cache (all entries evicted).
2. Close SQLCipher database.
3. Zeroize DEK buffer.
4. Zeroize KEK buffer.
5. Clear session.

---

## Migration Strategy

### Read-Time Migration (Automatic)

When `getItem()` reads a v1 record, the legacy HKDF decryption path is used.
There is an optional `migrateItemToV2(id)` method that:

1. Decrypts the v1 record using legacy HKDF.
2. Re-encrypts using a fresh per-record DEK (envelope).
3. Updates the row in-place (`schema_version=2`).

### Bulk Upgrade (Optional)

`upgradeVault()` iterates all v1 records and migrates them to v2.  This is
idempotent and can be triggered from a UI button or admin command.

### Write-Time Upgrade (Automatic)

Any `updateItem()` call that includes new `fields` will always write as v2,
regardless of the record's current schema version.

---

## Threat Model

| Threat                          | Mitigation                                      |
|---------------------------------|-------------------------------------------------|
| Disk theft (data at rest)       | SQLCipher AES-256 + per-record envelope          |
| Memory dump while locked        | KEK + DEK zeroized on lock; no decrypted data    |
| Memory dump while unlocked      | Only KEK + DEK in memory; records decrypted one at a time; cache limited to 16 items × 60s TTL |
| Compromise of single record DEK | Does NOT compromise other records (each has unique DEK) |
| Compromise of KEK               | Attacker can unwrap record DEKs → decrypt records. Mitigated by: memory zeroization on lock, autolock timer, rate-limited unlock |
| Tier bypass (Free accessing Pro records) | Capability check BEFORE any unwrap/decrypt; server-side enforcement in API routes |
| Tampered ciphertext / wrapped DEK | AES-256-GCM and XChaCha20-Poly1305 are both AEAD — authentication failure throws |

### Out of Scope

- Side-channel attacks on the running process.
- OS-level memory forensics while the vault is actively unlocked.
- Cryptographic zeroization is best-effort (V8/compiler may optimize away writes).

---

## Files

| File                     | Role                                              |
|--------------------------|---------------------------------------------------|
| `vault/envelope.ts`     | Per-record seal/open, DEK wrap/unwrap primitives   |
| `vault/cache.ts`        | In-memory decrypt cache with TTL and zeroization   |
| `vault/crypto.ts`       | KDF, vault-level key wrapping, legacy field crypto  |
| `vault/db.ts`           | SQLCipher management, additive schema migration     |
| `vault/service.ts`      | Core business logic — CRUD with envelope encryption |
| `vault/types.ts`        | VaultSession (kek + vmk), type definitions          |
| `vault/envelope.test.ts`| 17 unit tests for envelope crypto + cache           |
