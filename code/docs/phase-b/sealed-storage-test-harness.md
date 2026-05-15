# Sealed-Storage Test Harness

## Purpose

The `createSealedStorageTestContext` harness provides a single, correct setup
for any test that exercises sealed-storage code paths.  It replaces the
per-file boilerplate that previously caused the ~28 Gap 5b-1 failures (key
provider unbound, wrong DEK, stale HMAC seals).

**Location:** `test/harness/sealed-storage.ts`
**Self-tests:** `test/harness/sealed-storage.test.ts`

---

## Quick start

```typescript
import {
  createSealedStorageTestContext,
  type SealedStorageTestContext,
} from 'test/harness/sealed-storage'

describe('MyFeature', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('exercises a sealed-storage path', () => {
    const { seal, seal_input_json } = ctx.buildValidSealForRowId('row-1', {
      subject: 'hello',
    })
    // Use seal / seal_input_json when inserting rows into ctx.db, or when
    // asserting that sealedQuery accepts the row.
  })
})
```

---

## API

### `createSealedStorageTestContext()`

Returns a `SealedStorageTestContext` with:

| Property | Type | Description |
|---|---|---|
| `TEST_DEK` | `Buffer` | Deterministic 32-byte DEK derived via HKDF from a fixed master key. |
| `keyProvider` | `SealKeyProvider` | Synchronous provider that returns the context's DEK copy. |
| `db` | `Database \| null` | In-memory `better-sqlite3` database pre-seeded with the production schema (`inbox_messages`, `inbox_attachments`), or `null` if `better-sqlite3` is unavailable. |
| `buildValidSealForRowId(rowId, content, key?)` | function | Computes a real HMAC seal accepted by `sealedQuery`'s `verifySealAndContent`. |
| `cleanup()` | function | Unbinds the key provider, clears tamper events, closes the DB, and zeroes the DEK copy. |

### `buildValidSealForRowId(rowId, content, key?)`

Produces `{ seal: string, seal_input_json: string }` using the same
`computeSealForTest` path that production `sealedQuery` verifies.  The seal
is deterministic for a given `(rowId, content)` pair and a given DEK.

**Parameters:**

- `rowId` — string identifier used as HKDF info input (matches the production
  key-derivation for this row).
- `content` — plain object serialised as the `canonical_json` for HMAC
  computation.
- `key` — optional DEK override; defaults to the context's `TEST_DEK`.

---

## Design decisions

### Synchronous key provider

The provider returns `Buffer` synchronously.  Async providers were the root
cause of the L6/L7 bug pattern; all test harness providers are sync-only.

### Deterministic DEK

`TEST_DEK` is derived via `HKDF-SHA256` from the fixed constant
`_TEST_VAULT_MASTER_KEY`.  The same derivation is used in `test-session.ts`
so tests that import the DEK from either location get the same bytes.

### In-memory DB

The harness uses `better-sqlite3` in-memory mode (`:memory:`).  If
`better-sqlite3` is unavailable in the current environment the `db` field is
`null` — tests that need a real DB must check for `null` or skip.

### Validator mock

The harness binds the key provider via `bindKeyProvider` from the production
`sealed-storage` module.  It does **not** mock the validator — tests that need
specific validator behavior (approve / reject) should mock the validator
orchestrator themselves, on top of the harness context.

### Cleanup

`cleanup()` must be called in `afterEach`.  It:
1. Calls `unbindKeyProvider()` — prevents key leakage into subsequent tests.
2. Calls `clearTamperingEvents()` — resets the global tamper log.
3. Closes the in-memory DB if present.
4. Zeroes the DEK copy with `Buffer.fill(0)`.

Failing to call `cleanup()` will leave the key provider bound and may cause
false-positive passes in subsequent tests that don't bind their own provider.

---

## When NOT to use the harness

- Tests that **fully mock** `sealed-storage` (e.g. the pagination tests in
  `b81BeapInboxPagination.test.ts`) don't need the harness for its DB or key
  provider, but should still call `createSealedStorageTestContext()` to:
  - Ensure the mock exports include `bindKeyProvider`, `unbindKeyProvider`,
    `clearTamperingEvents`, etc.
  - Use `buildValidSealForRowId` if the test ever checks a real seal.

- End-to-end tests that run the real Electron main process should NOT use the
  harness — they should exercise the real key-provider binding flow.

---

## See also

- `test/harness/sealed-storage.test.ts` — harness self-tests
- `test/mocks/electron.ts` — Electron API mock
- `test/setup.ts` — global polyfills (`CSS.escape`, `window.innerHeight`)
- `docs/phase-b/PR-B-8-4d-iii-5b.md` — PR that introduced this harness
