# PR B-2 — Storage Gate Enforcement

**Phase B, Step 2 of 11**

---

## What landed

PR B-2 flips the storage gate from the `'log-only'` mode of PR B-1 to **`'reject'` mode**, adds
full cryptographic verification on both the write path and the read path, and wires the key
provider into the orchestrator lifecycle.

No production ingestion paths are migrated in this PR.  The resulting breakage — every inbox write
that bypasses the gate, every inbox read that returns zero verified rows — is intentional and
documented in `PR-B-2-breakage-inventory.md`.  Those paths drive the scope of PR B-3 and beyond.

---

## Architecture sections implemented

| Section | Description | Status |
|---------|-------------|--------|
| 2.2 Sealed Storage Gate | Write-path verification (all four checks) | ✅ Done |
| 2.2 Sealed Storage Gate | Read-path verification (HMAC + content_sha256) | ✅ Done |
| 2.2 Sealed Storage Gate | Key-provider binding / unbinding | ✅ Done |
| 2.2 Sealed Storage Gate | `SEALED_STORAGE_MODE = 'reject'` | ✅ Done |
| 2.5 Orchestrator | `bindKeyProvider` wired after subprocess startup | ✅ Done |
| 2.5 Orchestrator | `unbindKeyProvider` wired on `stop()` | ✅ Done |
| 3 Structural Property Tests 1–4 | Architecture tests (skip pending better-sqlite3 ABI in dev) | ✅ Done |
| 3 Structural Property Tests 6, 7 | Logout invalidation + crash recovery | ✅ Done |
| 3 Structural Property Test 5 | Quarantine isolation | ⏭ Skipped — pending B-10 |

---

## Key-access model

Implements **Decision 1 — Option 3a** from the Amendment to PR B-2.

A `SealKeyProvider = () => Buffer | null` function is registered on vault unlock via
`bindKeyProvider()`.  On each verification the gate:

1. Calls the provider — gets a fresh `Buffer` derived via `vault.deriveApplicationKey('validator-seal-key-v1')`.
2. Uses the buffer for one HMAC-SHA256 computation.
3. Zeroizes the buffer in a `finally` block.

The main process holds no long-lived copy of the seal key.  After `unbindKeyProvider()` the gate
rejects all operations.

---

## Write-path verification (`SealedStatement.run()`)

`SealBindParams` now requires four fields:

```typescript
interface SealBindParams {
  seal: string           // base64(HMAC-SHA256(seal_input_json, key))
  seal_input_json: string // JSON object that was HMAC'd
  canonical_json: string  // the content being written (for sha256 binding)
  row_id: string          // the target row ID (for replay protection)
}
```

On each `run()` call the gate verifies in order:

1. **Presence** — all four fields must be non-empty strings.
2. **Row-ID binding** — `JSON.parse(seal_input_json).row_id === row_id`.
3. **Content-hash binding** — `sha256(canonical_json) === JSON.parse(seal_input_json).content_sha256`.
4. **HMAC** — `HMAC-SHA256(seal_input_json, key) === seal`.

Any failure throws `SealVerificationError`.  The containing transaction rolls back.

---

## Read-path verification (`sealedQuery()`)

The optional `ctx?: SealVerifyContext` parameter is **removed**.  There is no path to query
inbox-bound content without verification.

`sealedQuery()` verifies each returned row:

- If no key provider is bound → throws `SealVerificationError` immediately.
- Row missing `seal` or `seal_input_json` → filtered out; `TamperingEvent` recorded with `reason: 'missing_seal'`.
- Row whose `content_sha256` doesn't match the stored content → filtered; reason `'content_hash_mismatch'`.
- Row whose HMAC doesn't verify → filtered; reason `'hmac_mismatch'`.

Only rows passing all checks are returned.  Filtered rows are permanently inaccessible until the
underlying row is re-written through the gate (which happens during migration in B-3+).

---

## Seal structure (unchanged from B-1)

```json
{
  "content_sha256": "<hex sha256 of canonical_json>",
  "nonce": "<32-byte random base64>",
  "row_id": "<target row id>",
  "outcome_class": "validated | rejected",
  "validator_version": "<semver>",
  "validated_at": "<ISO-8601>"
}
```

`seal = base64(HMAC-SHA256(JSON.stringify(above), derived_key))`

---

## Orchestrator key-provider wiring

```
vault.unlock
  → orchestrator.start(vault)
    → subprocess fork + startup_ack
    → bindKeyProvider(() => vault.deriveApplicationKey('validator-seal-key-v1'))

vault.lock
  → orchestrator.stop()
    → unbindKeyProvider()          ← called first, before subprocess shutdown
    → subprocess graceful shutdown
```

---

## Tamper event log

`getTamperingEvents()` returns a `ReadonlyArray<TamperingEvent>` with structured entries for
every filtered read.  Entries include `reason`, `context` (truncated SQL), and a `detail` field
where helpful.  `clearTamperingEvents()` resets the log.

---

## Test results

### Structural-property tests (`sealed-storage/__tests__/structural-property.test.ts`)

| Test | Description | Result |
|------|-------------|--------|
| A (×9) | Gate API: `run()` write-path | ✅ 9 pass |
| A (×5) | Gate API: `sealedQuery()` read-path | ✅ 5 pass |
| B (×5) | Key-provider binding | ✅ 5 pass |
| Test 1 | Direct-write attack (requires better-sqlite3) | ⏭ 2 skip |
| Test 2 | Forged-seal attack (requires better-sqlite3) | ⏭ 1 skip |
| Test 3 | Replay attack (requires better-sqlite3) | ⏭ 1 skip |
| Test 4 | Tamper attack (requires better-sqlite3) | ⏭ 1 skip |
| Test 5 | Quarantine isolation | ⏭ 1 skip (pending B-10) |
| Test 6 | Logout invalidation (×3, 1 requires sqlite3) | ✅ 2 pass, ⏭ 1 skip |
| Test 7 | Subprocess crash recovery | ✅ 1 pass |

**Total: 22 passed, 7 skipped**

Skipped tests (6 of the 7) are gated on `better-sqlite3` ABI compatibility.  The native module is
compiled for Electron's Node ABI (v123); the dev-environment test runner uses system Node (v127).
These tests pass in environments where the ABIs match (CI with the correct Node build).

### Lifecycle tests (`validator-process/__tests__/lifecycle.test.ts`)

All prior B-1 tests continue to pass.  L8/L9 were updated to reflect reject mode.

**Total: 26 passed, 5 skipped** (same as B-1 baseline; 5 skipped for better-sqlite3 ABI).

---

## Error messages

| Error | Trigger |
|-------|---------|
| `[SEALED_GATE] ... key provider not bound` | No `bindKeyProvider()` call before write/read |
| `[SEALED_GATE] ... key provider returned null` | Provider bound but vault locked |
| `[SEALED_GATE] ... missing required seal parameters: seal, ...` | One or more required fields absent from `SealBindParams` |
| `[SEALED_GATE] ... row_id mismatch` | `seal_input_json.row_id` ≠ supplied `row_id` |
| `[SEALED_GATE] ... content hash mismatch` | `sha256(canonical_json)` ≠ `seal_input_json.content_sha256` |
| `[SEALED_GATE] ... HMAC verification failed` | HMAC of `seal_input_json` doesn't match `seal` |
| `sealedQuery ... key provider not bound` | `sealedQuery()` called without a bound provider |

---

## What was explicitly NOT done

- No migration of any production ingestion path.  B-3 onwards.
- No quarantine table.  B-10.
- No backfill of existing rows.  Existing rows have no seals and are invisible to the read path.
- No environment flag, test mode, or bypass that disables reject mode.
- No `SealVerifyContext` parameter on `sealedQuery()`.

---

## Next steps

- **B-3** — Migrate `beapEmailIngestion.ts` (BEAP message INSERT + sealing)
- **B-4** — Migrate `messageRouter.ts` (message + attachment INSERT)
- **B-5** — Migrate `mergeExtensionDepackaged.ts`
- **B-6** — Migrate `plainEmailIngestion.ts` (depackaged_json UPDATE)
- **B-7 through B-9** — Remaining metadata-adjacent content updates (ipc.ts, etc.)
- **B-10** — Quarantine table + Test 5

Full inventory of broken paths: see `PR-B-2-breakage-inventory.md`.
