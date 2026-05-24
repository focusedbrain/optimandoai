# PR B-8.4d-iii-5a — Simple Test Infrastructure Mocks and Polyfills

## Authority

Phase B Architecture canon: every BEAP message type passes Ingestor and
Validator no matter where it lands; any bypass is a defect.

This PR is **purely test infrastructure**. No production code is modified.
No structural properties are changed. All changes are test-side: Vitest
config, a new mock file, and import migrations in three test files.

## What this PR fixes

The B-8.4d triage found that `pnpm exec vitest run` reported 147 failing
assertions across 73 suites, **plus 39 entire suites that failed at
collection time** with zero assertions running inside them. These blocked
suites held ~500 previously-hidden tests.

Root causes of the 39 collection-time failures:

| Group | Count | Cause |
|-------|------:|-------|
| `app.getPath` undefined | 25 | Electron `app` not present in Node/Vitest env |
| `describe is not defined` | 6 | Vitest globals not enabled in root config |
| `beforeEach is not defined` | 1 | Same — `beforeEach` used without import |
| `@jest/globals` not resolved | 2 | Mixed test framework imports |
| Playwright `@playwright/test` | 4 | Playwright e2e specs inadvertently in Vitest run |
| `../ingestion/distributionGate` not found | 1 | Stale import path in `invariants.test.ts` |
| **Total** | **39** | |

## Changes

### Decision A — Global Electron mock via Vitest alias

**New file: `test/mocks/electron.ts`**

Comprehensive no-op mock for all commonly-used Electron APIs (`app`,
`safeStorage`, `ipcMain`, `ipcRenderer`, `BrowserWindow`, `shell`,
`dialog`, `nativeTheme`, `powerMonitor`, `screen`, `clipboard`,
`nativeImage`, `contextBridge`, `Menu`, `Tray`, `Notification`, `session`,
`powerSaveBlocker`, `net`).

`app.getPath(name)` returns `os.tmpdir()/vitest-electron-mock/<name>` — a
deterministic, always-existent path that doesn't require real filesystem
setup.

**`vitest.config.ts` change:**

```ts
{ find: 'electron', replacement: path.resolve(repoRoot, 'test/mocks/electron.ts') }
```

Tests that already have `vi.mock('electron', factory)` are unaffected —
`vi.mock` in test files takes precedence over resolver aliases. All 48+
tests with local electron mocks continue to use their own factories.

**Unblocks:** 25 `getPath` suite-load failures (handshake e2e, ingestion
e2e, p2p transport, email beapSync, executeToolRequest, rpcAuth, etc.).

### Decision B — `globals: true` in root vitest config

Added `globals: true` to `vitest.config.ts` `test` block.

**Unblocks:** 7 extension-chromium suites (`automation/__tests__/` ×5,
`nlp/__tests__/NlpClassifier.test.ts`, `beap-messages/services/__tests__/beapCrypto.test.ts`)
that use `describe`, `beforeEach`, `it`, `expect` without importing them.

The `extension-chromium/vitest.config.ts` already had `globals: true` for
its own run; this aligns the workspace-root run. Tests that already import
from `'vitest'` are unaffected (explicit imports take precedence over
globals).

### Decision C — Playwright spec files excluded

Added to `test.exclude`:

```
'apps/extension-chromium/src/vault/autofill/__tests__/e2e-*.spec.ts'
```

The 4 files (`e2e-autofill.spec.ts`, `e2e-security-regression.spec.ts`,
`e2e-webmcp-no-write.spec.ts`, `e2e-webmcp-preview.spec.ts`) import
`@playwright/test` and require the Playwright runner, not Vitest.

**Removes:** 4 suite-load failures from the Vitest output.

### Decision D — `@jest/globals` → `vitest` imports

**`apps/electron-vite-project/electron/main/llm/__tests__/hardware-capability.test.ts`**

```ts
// Before
import { describe, it, expect, jest } from '@jest/globals'
// After
import { describe, it, expect, vi as jest } from 'vitest'
```

`vi as jest` preserves any `jest.fn()` usage; the file uses `jest` only as
an import and does not call `jest.fn()` in practice, so this is a safe
rename alias.

**`apps/electron-vite-project/electron/main/llm/__tests__/diagnostics.test.ts`**

```ts
// Before
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
// After
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
```

**Unblocks:** 2 llm test suite load failures.

### Decision E — CSS.escape

CSS.escape errors appear as **assertion failures** (tests load, then
`TypeError: Cannot read properties of undefined (reading 'escape')` during
test execution). They are **not** suite load failures. Classification: the
11 CSS.escape assertion failures are **Category 5** but already included in
the 147 baseline count. Fix is in B-8.4d-iii-5b scope (setup file
polyfill), not this PR.

### Decision F — `invariants.test.ts` distributionGate path

**`apps/electron-vite-project/electron/main/__tests__/invariants.test.ts`**

```ts
// Before (stale path — file never existed)
import { routeValidatedCapsule } from '../ingestion/distributionGate'
// After (correct re-export path)
import { routeValidatedCapsule } from '../ingestion'
```

`routeValidatedCapsule` is exported from `@repo/ingestion-core` and
re-exported via `../ingestion/index.ts`. The `distributionGate` file only
exists as a test file (`distributionGate.test.ts`), not as a production
module.

**Unblocks:** 1 suite load failure.

## Before / After

| Metric | Pre B-8.4d-iii-5a | Post B-8.4d-iii-5a | Delta |
|--------|-------------------|--------------------|-------|
| Suite load failures (0 assertions) | **39** | **0** | −39 |
| Total tests in suite | 3697 | **4197** | +500 |
| Failing assertions | 147 | **228** | +81 |
| Passing assertions | 3518 | **3931** | +413 |
| Playwright specs excluded | — | 4 | — |

**The +81 increase in failures is the expected diagnostic finding**: those
assertions were previously hidden because their suites couldn't load. They
are now running and failing. The majority are Category 1 (stale fixture)
and Category 5 (harness) per the B-8.4d triage, and are B-8.4d-i's scope.

## Stop-and-report findings

None encountered.

- No production code has `NODE_ENV === 'test'` branches that interact
  with the mock (Decision A).
- Globals conventions are consistent: extension-chromium already used
  globals, root config was missing it — straightforward Decision B1
  resolution.
- All misc load failures were mechanical and did not require structural
  changes.
- After fixes, zero suites remain failing at collection time (confirmed
  by `suiteLoadFails: 0`).

## What was not verified

1. Whether `app.getPath` mock values (`os.tmpdir()/vitest-electron-mock/<name>`)
   satisfy test expectations that compare against specific filesystem paths.
   Tests that need exact paths can override with local `vi.mock('electron')`.

2. The specific assertions in the 81 newly-unmasked failures: classification
   (Category 1 vs 5) is B-8.4d-i's scope.

3. Whether `hardware-capability.test.ts` or `diagnostics.test.ts` (formerly
   `@jest/globals` users) now pass their assertions — they may have other
   test-environment requirements (Ollama, hardware APIs). These are expected
   to remain in the failing set at B-8.4d-i.

4. Windows-only path separators in `app.getPath` mock return values — the
   mock uses `path.join(os.tmpdir(), ...)` which respects platform conventions.

## After this PR

Honest baseline for B-8.4d-i: **4197 total, 228 failing, 3931 passing**.

Next steps:
- **B-8.4d-i**: Category 1 stale-test cleanup (the 90 visible before +
  newly-unmasked Category 1 failures from the 81).
- **B-8.4d-iii-5b**: Architectural test infrastructure (validator subprocess,
  WRVault write canary seam, CSS.escape polyfill in setup file, autofill
  fingerprint mock).
- **QB_09 diagnostic**: separate.
