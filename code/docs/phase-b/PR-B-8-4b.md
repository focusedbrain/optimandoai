# PR B-8.4b — b51ExtensionMergeBypass Mock Fix

**Type:** Test-harness fix (no production code changes).  
**Scope:** `b51ExtensionMergeBypass.test.ts` mocks only.  
**Authority:** Phase B Architecture canon directive, B-5.1. No structural changes.

---

## Investigation finding recap (B-8.4a)

The B-8.4a investigation classified the three `b51ExtensionMergeBypass.test.ts`
failures as **stale test mocks**, not real regressions:

- `encryptForQuarantine` mock returned `{ ciphertext, nonce, ephemeralPublicKey }`
  (an older API shape); production returns `{ ok: true; blob: QuarantineBlobFile }
  | { ok: false; error: string }`.
- Production guards with `if (!encResult.ok)` — the missing `ok` field caused the
  quarantine path to abort before reaching the sealed insert.
- B-5.1's "no failure-path inbox write" property was NOT violated; the error
  occurred before any sealed gate call.

This PR makes those three tests runnable so they confirm the canon-directive
property by passing, not just by analysis.

---

## Production shapes confirmed (Step A)

### `encryptForQuarantine` — `electron/main/quarantine-encrypt/index.ts`

```typescript
export type QuarantineEncryptResult =
  | { ok: true; blob: QuarantineBlobFile }
  | { ok: false; error: string }

export interface QuarantineBlobFile {
  version: 'quarantine-v1'
  sender_ephemeral_x25519_pub_b64: string
  salt_b64: string
  nonce_b64: string
  ciphertext_b64: string
}
```

Matches investigation description. No stop-and-report condition.

### `writeQuarantineBlob` — `electron/main/quarantine-blob-storage/index.ts`

```typescript
export interface QuarantineWriteResult {
  storage_id: string
  storage_path: string
  blob_sha256: string
  blob_size_bytes: number
}
```

Investigation mentioned `storage_path` was absent from its description but that
field is not used in any assertion; the fix adds it to be complete. No
stop-and-report condition.

---

## Full diff summary

File: `electron/main/email/__tests__/b51ExtensionMergeBypass.test.ts`

### 1. `crypto` import — add `createHash`, `createHmac`

Required for the `makeQuarantineSuccessOutcome` helper that computes live seals.

### 2. `encryptForQuarantine` mock — shape corrected

Before:
```typescript
vi.mock('../../quarantine-encrypt/index', () => ({
  encryptForQuarantine: vi.fn(() => ({
    ciphertext: 'mock-ct',
    nonce: 'mock-nonce',
    ephemeralPublicKey: 'mock-epk',
  })),
}))
```

After:
```typescript
vi.mock('../../quarantine-encrypt/index', () => ({
  encryptForQuarantine: vi.fn(() => ({
    ok: true,
    blob: {
      version: 'quarantine-v1' as const,
      sender_ephemeral_x25519_pub_b64: 'bW9jay1lcGhlbWVyYWwtcHViLWI2NA==',
      salt_b64: 'bW9jay1zYWx0AAAAAAAAAA==',
      nonce_b64: 'bW9jay1ub25jZQ==',
      ciphertext_b64: 'bW9jay1jaXBoZXJ0ZXh0',
    },
  })),
}))
```

### 3. `writeQuarantineBlob` mock — field names corrected

Before:
```typescript
vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: vi.fn(() => ({
    storageId: `blob-${randomUUID()}`,
    sha256: 'a'.repeat(64),
  })),
}))
```

After:
```typescript
vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: vi.fn(() => ({
    storage_id: 'mock-storage-id',
    storage_path: '/tmp/inbox-quarantine-blobs/mock-storage-id',
    blob_sha256: 'a'.repeat(64),
    blob_size_bytes: 100,
  })),
}))
```

### 4. `bindKeyProvider` — synchronous provider (both `§2` and `§3` `beforeEach`)

Before:
```typescript
bindKeyProvider(() => Promise.resolve(TEST_DEK))
```

After:
```typescript
bindKeyProvider(() => TEST_DEK)
```

`SealKeyProvider = () => Buffer | null` is synchronous. The async provider was a
latent type mismatch hidden by the earlier mock failures — once the `row_id`
check was reached, `verifyHmacWithProvider` would call `key.fill(0)` on a
Promise in the `finally` block.

### 5. New helper — `makeQuarantineSuccessOutcome`

```typescript
function makeQuarantineSuccessOutcome(canonicalJson: string, rowId: string) {
  const content_sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const validated_at = new Date().toISOString()
  const seal_input_json = JSON.stringify({ content_sha256, row_id: rowId, validated_at })
  const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
  return {
    outcome: {
      ok: true,
      sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at, validator_version: 'b51-test' },
    },
  } as any
}
```

The sealed gate in `reject` mode verifies all of: row_id binding, content hash,
and HMAC. This helper computes the real HMAC with `TEST_DEK` so the gate accepts
the quarantine insert. The `makeSuccessOutcome` static helper (with `row_id: 'r'`)
is left unchanged — it is not used on any quarantine path.

### 6. Quarantine-path validator mock setup — three locations (§2.4, §3.2, §3.5)

Before (all three):
```typescript
validateMock.mockResolvedValue(makeSuccessOutcome('{"content_type":"host_quarantine"}'))
```

After (all three):
```typescript
validateMock.mockImplementation(async ({ plaintext_or_encrypted, target_row_id }: any) =>
  makeQuarantineSuccessOutcome(plaintext_or_encrypted.content as string, target_row_id as string),
)
```

This captures the dynamic `quarantineId` (a `randomUUID()` generated inside
`attemptQuarantineWrite`) so the seal's `row_id` field matches the row being
inserted. The sealed gate is satisfied.

---

## Canon-directive property verified by passing tests

All three previously-failing tests now pass and exercise their intended
canon-directive assertions:

### §2.4 — quarantine row written on failure with paired sandbox

```
qRows.length === 1               // quarantine row exists
qRows[0].rejection_reason === 'MISSING_REQUIRED_FIELD'
qRows[0].seal is truthy          // sealed gate accepted the insert
getPendingMergeCount() === 0     // retry buffer is empty (quarantine path handled it)
shellRow.seal is falsy           // inbox shell row has NO content written
```

**Canon-directive property proved:** Validation failure with paired sandbox →
sealed quarantine row written → inbox row NOT touched. No bypass.

### §3.2 — drain loop processes buffer entry via quarantine write

```
processed === 1                  // entry was processed
getPendingMergeCount() === 0     // entry removed from buffer
qRows.length === 1               // quarantine row written by drain
```

**Canon-directive property proved:** Retry buffer entries drain correctly via
quarantine write when a sandbox becomes available. Pending messages do not
accumulate indefinitely.

### §3.5 — drain clears buffer and notifies UI with pendingCount: 0

```
notifies.length > 0                          // at least one UI event fired
last.data.pendingCount === 0                 // count cleared after successful drain
```

**Canon-directive property proved:** After drain, the renderer receives
`inbox:mergePendingNoSandbox` with `pendingCount: 0`, confirming the pending
state is correctly cleared in the UI.

---

## Verification log

```
Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  18:50:30
   Duration  503ms
```

Stdout confirmation (sample):
```
[MERGE] Quarantine row written: f84b2d14-... for inbox row: msg-1   ← §2.4
[MERGE] Quarantine row written: 4206e35a-... for inbox row: msg-2   ← §3.2
[MERGE] Quarantine row written: e7038762-... for inbox row: msg-2   ← §3.5
```

The `[MERGE] Quarantine row written:` log line is emitted only when the full
quarantine path completes: encrypt → blob write → quarantine validator → sealed
insert. Its presence confirms the entire path executed.

Previously passing tests (10 of 13) continue to pass — the mock updates did not
break any working test.

---

## What was not verified

*(Empty — this PR's scope was fully verifiable without end-to-end runs.)*

The mock changes are local to the test file and do not touch production code.
The sealed gate is the same gate production uses; the HMAC is computed with
`TEST_DEK` which the test explicitly binds. There are no environmental gaps.

---

## After this PR

Three ambiguous questions from B-8.4a remain open (Section 4 of the
investigation report). Those decisions gate the follow-on:

- **B-8.4c** (bulk cleanup — Categories 1 + 4 + ambiguous-now-resolved): can
  proceed once canon-owner answers A, B, C.
- **B-8.4d** (test environment fixes — Category 5, ~79 failures): separate track.
- **B-9** (structural sequence resumes): blocked only on any confirmed regression;
  there is none.
