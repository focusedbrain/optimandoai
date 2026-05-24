# PR B-1 — Validator Subprocess Foundation

**Phase B of the Bypass-Proof Validation Pipeline**

## What landed

PR B-1 establishes the cryptographic and process-isolation foundation that
Phase B builds on.  It ships no ingestion-path migration and does not enforce
the storage gate (enforcement is PR B-2).

### Files created / modified

| File | Change |
|------|--------|
| `packages/ingestion-core/src/sealedValidation.ts` | IPC protocol types (Step C) |
| `packages/ingestion-core/src/index.ts` | Exports new types |
| `electron/main/vault/service.ts` | Adds `deriveApplicationKey(info)` (amendment) |
| `electron/main/validator-process/index.ts` | Subprocess entry point (Step A) |
| `electron/main/validator-process/orchestrator.ts` | Main-process lifecycle (Step B) |
| `electron/main/validator-process/test-session.ts` | Test bootstrap (Step F) |
| `electron/main/validator-process/__tests__/lifecycle.test.ts` | Tests L1a, L1b, L1–L10 (Step G) |
| `electron/main/sealed-storage/index.ts` | Log-only storage gate (Step D) |
| `electron/main/handshake/db.ts` | Schema migration v64 — seal columns (Step E) |
| `electron/main/vault/rpc.ts` | Hooks validator start/stop into unlock/lock |

### Architecture sections implemented

- **Section 2.1** — Validator subprocess via `child_process.fork()`.
- **Section 2.2** — HMAC-SHA256 seal: `seal_input_json` binds `content_sha256`,
  `nonce`, `row_id`, `outcome_class`, `validator_version`, `validated_at`.
- **Section 2.5** — IPC protocol: `ValidateRequest`, `ValidateResponse`,
  `SealedContent`, `SealedQuarantine`, `SubprocessControlMessage`,
  `SubprocessAckMessage`.

## How to reason about this PR

### Key lifecycle

```
vault.unlock()
  → VaultService.deriveApplicationKey('validator-seal-key-v1')
    → Buffer(32) via HKDF-SHA256(vmk, 'beap-application-key-derivation-v1', info)
  → ValidatorOrchestrator.start(vault)
    → fork(validatorProcess/index.js)
    → subprocess.send({ kind: 'startup', seal_key_b64: key.toString('base64') })
    → sealKey.fill(0)   ← key zeroized in main immediately
    → wait for startup_ack

vault.lock()
  → ValidatorOrchestrator.stop()
    → subprocess.send({ kind: 'shutdown' })
    → wait for exit (SIGKILL on timeout)
```

The HMAC key lives only in the subprocess from the point the startup message
arrives.  The main process holds it only in the brief window between
`deriveApplicationKey()` and `sealKey.fill(0)`.

### Storage gate (log-only mode)

`sealed-storage/index.ts` exports `prepareSealedInsert`, `prepareSealedUpdate`,
and `sealedQuery`.  In `SEALED_STORAGE_MODE = 'log-only'` (this PR):

- **Write path**: missing seal → console.warn with call stack, write proceeds.
  The warnings form the migration checklist for PRs B-3 through B-9.
- **Read path**: present seal → verified; mismatch → console.warn, row still
  returned.  Absent seal → logged if a verify context was provided.

PR B-2 changes `SEALED_STORAGE_MODE` to `'reject'`:
- Unsealed writes throw `SealVerificationError`.
- Tampered / missing-seal rows are filtered from reads.

### Seal structure

```json
{
  "content_sha256": "<sha256(canonical_json) hex>",
  "nonce": "<32 random bytes base64>",
  "row_id": "<target_row_id>",
  "outcome_class": "validated | rejected",
  "validator_version": "1.0.0",
  "validated_at": "<RFC 3339 UTC>"
}
```

`seal = base64(HMAC-SHA256(JSON.stringify(above), key))`

Both `seal` and `seal_input_json` are stored in the new schema columns.  The
read path recomputes the HMAC over `seal_input_json` and also independently
hashes the row's canonical JSON to detect content substitution.

## What comes next

| PR | Description |
|----|-------------|
| B-2 | Switch `SEALED_STORAGE_MODE` to `'reject'`; add structural-property tests 1–7 |
| B-3 | Migrate `beapEmailIngestion.ts` (qBEAP decrypt path) to use gate |
| B-4 | Migrate `mergeExtensionDepackaged.ts` |
| B-5 | Migrate `plainEmailIngestion.ts` |
| B-6 | Migrate `ipc.ts` AI analysis writes |
| B-7 | Migrate `messageRouter.ts` |
| B-8 | Migrate attachment writes |
| B-9 | Migrate remaining staging tables (p2p_pending_beap, plain_email_inbox) |
| B-10 | Quarantine read path + quarantine_messages table |
| B-11 | Structural-property tests full suite + final enforcement audit |

## Architecture constraint checklist (PR B-1)

| Constraint | Status |
|------------|--------|
| HMAC key never in main process long-lived state | ✓ zeroized immediately after IPC send |
| No "produce seal without validation" path | ✓ seal only emitted after validator runs |
| Subprocess does not write to disk / make network calls | ✓ no file I/O, no net in subprocess |
| Tests use real seals from real subprocess | ✓ test-session.ts forks real subprocess via tsx |
| No "synthetic seal" in production code | ✓ `computeSealForTest` is test-only export |
| Gate in log-only mode (not skip mode) | ✓ warns with call stack, does not silently skip |
| Schema migration — no backfill | ✓ NULL columns for existing rows; no UPDATE in v64 |
| `deriveApplicationKey` is the only new vault surface | ✓ one method, no other vault changes |

## Stop-and-report conditions encountered

| Condition | Resolution |
|-----------|------------|
| Vault API didn't expose "derive application key" | Resolved by amendment: `deriveApplicationKey` added to `VaultService` in this PR. |
| All other conditions from pre-implementation assessment | Cleared (see assessment report). |

## Cross-platform notes

- `child_process.fork()` works on Windows, macOS, and Linux.  The sandbox
  subprocess (`sandboxProcessBridge.ts`) already uses the same fork pattern in
  production on Windows.
- Tests run via tsx which is a devDependency available on all platforms.
- Windows-specific test run: not performed in this PR cycle (CI is Linux/macOS).
  Windows verification is noted as **not verified** per the output format
  requirements.

## What was NOT verified

- Full structural-property tests 1–7 (Section 3 of architecture) — these run
  once PR B-2 enables reject mode.
- Subprocess crash recovery under unusual OS conditions (OOM, SIGSTOP, etc.).
- Cross-platform behavior on Windows (tests not run on Windows in this cycle).
- The full structural-property test suite: deferred to PR B-2.
