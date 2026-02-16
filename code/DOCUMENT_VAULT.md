# Document Vault — Storage Model & Security Boundaries

## Overview

The Document Vault allows Pro+ users to store arbitrary files inside the WRVault
encrypted storage.  Documents are encrypted individually using per-record envelope
encryption (identical to vault items v2) and stored as BLOBs in the SQLCipher
database.

**Key principle**: documents are strictly *data*.  No execution path is ever
created — the vault does not load, interpret, or dispatch any stored file.

---

## Architecture

```
┌────────────────────────────┐
│   UI (vault-ui-typescript) │  Upload / Download / List
└──────────┬─────────────────┘
           │  chrome.runtime.sendMessage → background → HTTP
           ▼
┌────────────────────────────┐
│   API Routes (main.ts)     │  Capability gate (currentTier)
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────┐
│   VaultService             │  Delegates to documentService.ts
│   (service.ts)             │  Passes db + KEK (never exposed)
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────┐
│   documentService.ts       │  Core logic: import, get, list, delete
│                            │  Policy enforcement: blocked exts, size limit
└──────────┬─────────────────┘
           │  sealRecord / openRecord from envelope.ts
           ▼
┌────────────────────────────┐
│   vault_documents table    │  SQLCipher database (AES-256-CBC + HMAC)
│   (encrypted BLOBs)        │
└────────────────────────────┘
```

---

## Storage Model

### Database Table: `vault_documents`

| Column        | Type    | Description                                      |
|---------------|---------|--------------------------------------------------|
| `id`          | TEXT PK | Random 128-bit hex ID                            |
| `filename`    | TEXT    | Sanitised original filename (basename only)      |
| `mime_type`   | TEXT    | Detected MIME (from extension, never trusted)     |
| `size_bytes`  | INTEGER | Original plaintext size in bytes                 |
| `sha256`      | TEXT    | SHA-256 hex digest of original content            |
| `wrapped_dek` | BLOB    | Per-document DEK wrapped by KEK (AES-256-GCM)   |
| `ciphertext`  | BLOB    | Encrypted document content (XChaCha20-Poly1305)  |
| `notes`       | TEXT    | User-supplied notes/tags (optional)              |
| `created_at`  | INTEGER | Unix timestamp (ms)                              |
| `updated_at`  | INTEGER | Unix timestamp (ms)                              |

### Indexes

- `idx_docs_sha256` — for fast deduplication lookups.
- `idx_docs_created` — for ordered listing.

### Content Addressing

On import, a SHA-256 hash of the plaintext content is computed and stored.
If a document with the same hash already exists, the import returns the
existing record (deduplication).

### Size Limit

`MAX_DOCUMENT_SIZE = 50 MB`.  Files exceeding this are rejected at import.

---

## Encryption

Per-document encryption follows the same envelope pattern as vault items v2:

```
Plaintext → base64-encode → sealRecord(base64, KEK)
         → { wrappedDEK, ciphertext }
```

1. A fresh random 256-bit DEK is generated per document.
2. The document content (base64-encoded) is encrypted with XChaCha20-Poly1305
   using the per-document DEK.
3. The DEK is wrapped (encrypted) with the vault-level KEK using AES-256-GCM.
4. The DEK is zeroized immediately after sealing.
5. Both `wrapped_dek` and `ciphertext` are stored in the database.

On retrieval:
1. Capability check runs BEFORE any unwrap/decrypt.
2. KEK unwraps the per-document DEK.
3. DEK decrypts the ciphertext.
4. DEK is zeroized immediately.
5. Base64 content is decoded back to a binary Buffer.

---

## Security Boundaries

### 1. No Execution Paths

The Document Vault introduces zero execution paths.  Specifically:

- **No module/plugin/script loading** from document storage.
- **No `eval()`, `require()`, or `import()`** of stored content.
- **No Content-Type dispatch**: MIME types are stored for UI display only.
- **Downloads always use `application/octet-stream`** and
  `Content-Disposition: attachment`.
- **No inline rendering**: even "safe" preview types (images, PDF, text) are
  only listed as metadata.  The current implementation does not provide
  in-browser preview; if added in the future, only the `SAFE_PREVIEW_MIMES`
  set is allowed.

### 2. File Extension Block-List

The `BLOCKED_EXTENSIONS` set rejects all known executable and scripting file
types at import time.  This is the **first line of defence** and runs before
any encryption occurs.

Blocked categories:
- **Windows executables**: `.exe`, `.dll`, `.bat`, `.cmd`, `.com`, `.msi`, `.scr`, `.pif`
- **Unix scripts**: `.sh`, `.bash`, `.zsh`
- **PowerShell**: `.ps1`, `.psm1`
- **JavaScript/TypeScript**: `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`
- **Python**: `.py`, `.pyc`, `.pyo`
- **Ruby/Perl/PHP**: `.rb`, `.pl`, `.php`
- **Java**: `.jar`, `.class`, `.war`, `.ear`
- **macOS**: `.app`, `.action`, `.command`, `.workflow`
- **Windows scripting**: `.vbs`, `.vbe`, `.wsf`, `.wsh`, `.hta`
- **Shortcuts/config**: `.lnk`, `.inf`, `.reg`, `.cpl`

### 3. Filename Sanitisation

All filenames are sanitised on import:
- Path separators are stripped (only basename is kept).
- Whitespace is collapsed.
- Empty filenames default to `"document"`.

This prevents path traversal attacks and ensures filenames are safe for display.

### 4. MIME Type Detection

MIME types are detected **from the file extension only** — never from user
input or magic-byte sniffing.  Unknown extensions default to
`application/octet-stream`.  MIME types are stored for informational display
and are **never used to dispatch handlers or executors**.

### 5. Capability Gating

All document operations require `canAccessRecordType(tier, 'document', action)`:

| Tier         | Access |
|--------------|--------|
| Free         | ❌     |
| Private      | ❌     |
| Pro          | ✅     |
| Publisher    | ✅     |
| Enterprise   | ✅     |

Capability checks run **before** any cryptographic operation (fail-closed).

### 6. Safe Preview MIME Set

If preview functionality is added in the future, only these MIME types are
permitted for inline display:

- `text/plain`
- `application/pdf`
- `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`

All other types must be download-only.

---

## API Endpoints

| Endpoint                       | Method | Description                    |
|--------------------------------|--------|--------------------------------|
| `/api/vault/documents`         | POST   | List documents (metadata only) |
| `/api/vault/document/upload`   | POST   | Upload and encrypt a document  |
| `/api/vault/document/get`      | POST   | Retrieve and decrypt a document|
| `/api/vault/document/delete`   | POST   | Delete a document              |
| `/api/vault/document/update`   | POST   | Update document metadata       |

### Upload Request Body

```json
{
  "filename": "report.pdf",
  "data": "<base64-encoded file content>",
  "notes": "Q4 financial report"
}
```

### Upload Response

```json
{
  "success": true,
  "data": {
    "document": {
      "id": "a1b2c3...",
      "filename": "report.pdf",
      "mime_type": "application/pdf",
      "size_bytes": 1234567,
      "sha256": "e3b0c44...",
      "notes": "Q4 financial report",
      "created_at": 1708000000000,
      "updated_at": 1708000000000
    },
    "deduplicated": false
  }
}
```

---

## Files

| File | Purpose |
|------|---------|
| `apps/electron-vite-project/electron/main/vault/documentService.ts` | Core document storage logic + policy enforcement |
| `apps/electron-vite-project/electron/main/vault/documentService.test.ts` | Unit tests (19 tests) |
| `apps/electron-vite-project/electron/main/vault/types.ts` | `VaultDocument`, `MAX_DOCUMENT_SIZE`, `BLOCKED_EXTENSIONS`, `SAFE_PREVIEW_MIMES` |
| `apps/electron-vite-project/electron/main/vault/db.ts` | `vault_documents` table migration |
| `apps/electron-vite-project/electron/main/vault/service.ts` | Document method wrappers on VaultService |
| `apps/electron-vite-project/electron/main.ts` | HTTP API routes for document CRUD |
| `apps/extension-chromium/src/vault/api.ts` | Frontend API functions |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | Document list, upload dialog, download |
| `packages/shared/src/vault/vaultCapabilities.ts` | `document` category + tier gating |

---

## Integrity Guarantee

The Document Vault maintains orchestrator integrity by design:

1. **No new execution surface**: No code path exists that would load, parse,
   or execute stored document content.
2. **Extension block-list**: Known executable formats are rejected at the gate.
3. **Opaque storage**: Documents are encrypted BLOBs with no semantic
   interpretation by the runtime.
4. **Download-only export**: All retrievals force `application/octet-stream`
   with `Content-Disposition: attachment`.
5. **Capability-gated**: Even encrypted BLOBs are inaccessible to
   unauthorised tiers — the KEK unwrap is gated by the capability check.
