# PR B-8.3 — Build Unblock and Infrastructure Fixes

## Overview

This PR is operational. It fixes four categories of infrastructure failures
surfaced by the Phase B test-infrastructure audit, unblocking an honest test
signal for the subsequent B-8.4 diagnostic PR.

The structural properties established by B-1 through B-8.2 are unchanged.
The gate, validator, seal mechanism, and reseal helpers are not modified.

---

## Audit findings addressed

| Category | Finding | Fix |
|----------|---------|-----|
| A | Duplicate `P2P_BEAP_ACCOUNT_ID` const in `beapEmailIngestion.ts` (lines 44 & 507) → TS2451 / esbuild symbol error → test collection failure for many electron-side test files | Removed the redundant second declaration at line 507 (identical value `'__p2p_beap__'` — Case 1). Left a comment referencing the module-level declaration. |
| B | `better-sqlite3` compiled for Electron ABI 123 but system Node 22 requires ABI 127 → relay-server / coordination-service tests skipped; many electron tests skip at module load | Added `postinstall` script to workspace root `package.json` that runs `prebuild-install --runtime node` in the `better-sqlite3` directory to download the correct prebuilt binary for the active Node version. Ran the repair immediately via `prebuild-install`. |
| C | Dead `usePendingPlainEmailIngestion` hook — no-op since B-3.1 — still wired into `BeapBulkInbox.tsx`, `BeapInboxView.tsx`, exported from `handshake/index.ts` | Removed all import/call sites, removed export from index, deleted the hook file. Verified no remaining production-code references. |
| C | Deprecated `SealVerifyContext` export — no consumers since B-2 | Removed the `export interface SealVerifyContext` block from `sealed-storage/index.ts`. Grepped for consumers: zero found. The one remaining mention of the name in a JSDoc comment describes its historical removal — that comment was left as accurate history. |
| E | Stale documentation in `WR_DESK_CODEBASE_ANALYSIS.md` and several analysis docs describing `plain_email_inbox`, `p2p_pending_beap`, `usePendingPlainEmailIngestion`, and `tryQbeapDecryptInbox` as live infrastructure | Surgically updated all non-historical analysis documents. PR history docs (`PR-B-*.md`) were left unchanged (intentional historical records). |

---

## Decisions recap

### Decision A — Duplicate constant: Case 1 (identical values)
Both declarations were `const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'`. The
module-level declaration at line 44 is authoritative. The second (line 507)
was a copy-paste leftover from a section written independently. Removed the
second; left a comment pointing to the canonical declaration.

Stop-and-report condition not triggered (values were identical, no ambiguity).

### Decision B — better-sqlite3 ABI: Option 1 (prebuild install)
Build-from-source failed: `node-gyp` requires Python `distutils` which is
absent in Python 3.12+ on the dev machine. Used `prebuild-install` instead,
which downloads a pre-compiled binary from the GitHub releases for the current
`node-vN-platform-arch` target.

The `postinstall` script in `package.json` now runs this automatically:
```json
"postinstall": "node -e \"try{const{execSync}=require('child_process');const bin=require.resolve('prebuild-install/bin');execSync('node '+JSON.stringify(bin)+' --runtime node',{cwd:require('path').join(__dirname,'node_modules','better-sqlite3'),stdio:'inherit'})}catch(e){console.warn('better-sqlite3 prebuild install skipped:',e.message)}\""
```

Stop-and-report condition not triggered (prebuild install succeeded).

### Decision C — Dead code removal: surgical removal confirmed safe
`usePendingPlainEmailIngestion` had no meaningful side effects since B-3.1:
- `getPendingPlainEmails` always returned `[]`
- The interval body was an immediate no-op
- No component relied on its return value

`SealVerifyContext` had no consumers (grep confirmed before removal).

Stop-and-report condition not triggered.

### Decision D — Stale documentation refresh
Updated the following files with surgical corrections:
- `WR_DESK_CODEBASE_ANALYSIS.md` — primary target (tables, beapSync description, risks/implementation order sections)
- `docs/sync-pipeline-shared-analysis.md` — `messageRouter.ts` persistence description
- `docs/imap-sync-depackaging-analysis.md` — routing table, call-chain, depackaging sections
- `docs/imap-manual-pull-call-chain.md` — writes description
- `docs/analysis-linux-decrypt-failure.md` — prepended Phase B note about `tryQbeapDecryptInbox` removal

PR history docs (`docs/phase-b/PR-B-*.md`) left unchanged (historical records).

Stop-and-report condition not triggered (scope was surgical, no broader rewrite needed).

### Decision E — Verification standard: workspace-root vitest run
See Before/After table below.

---

## Before / after test count table

| Metric | Pre-B-8.3 (audit baseline) | Post-B-8.3 | Delta | Notes |
|--------|---------------------------|------------|-------|-------|
| Total tests | 3563 | 3703 | +140 | More tests now load and run |
| Passing | 3159 | 3470 | +311 | |
| Failing | 145 | 201 | +56 | Previously-skipped tests now run and find failures → B-8.4 scope |
| Skipped | 230 | 3 | −227 | better-sqlite3 fix unmasked the skipped tests |
| Todo | 29 | 29 | 0 | |
| Test files (collected) | ~183* | 332 | +149 | Duplicate constant fix unblocked collection |

\*Pre-fix collection count is estimated from the audit's file count minus observed
collection failures.

**TypeScript error counts** (pre-existing, unchanged by this PR's scope):

| Package | Before | After | Notes |
|---------|--------|-------|-------|
| `apps/electron-vite-project` | ~329 | 327 | −2 from TS2451 removal |
| `apps/extension-chromium` | 153 | 153 | Unchanged |

---

## Diffs summary

### 1. `beapEmailIngestion.ts` — duplicate constant removed
```
-/** Sentinel account_id for P2P-ingested rows (no email account). */
-const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'
+// P2P_BEAP_ACCOUNT_ID is declared at module scope (line 44); no re-declaration needed here.
```

### 2. `package.json` (workspace root) — postinstall added
```json
+"postinstall": "node -e \"try{...prebuild-install --runtime node...}catch(e){...}\""
```

### 3. Dead code removed
- `apps/extension-chromium/src/handshake/usePendingPlainEmailIngestion.ts` — **deleted**
- `BeapBulkInbox.tsx` — removed import + bare hook call
- `BeapInboxView.tsx` — removed import + bare hook call
- `handshake/index.ts` — removed `export { usePendingPlainEmailIngestion }`
- `sealed-storage/index.ts` — removed `export interface SealVerifyContext { readonly key: Buffer }`

### 4. Documentation updated
- `WR_DESK_CODEBASE_ANALYSIS.md` — table list, beapSync description, risks/implementation order
- `docs/sync-pipeline-shared-analysis.md` — messageRouter persistence note
- `docs/imap-sync-depackaging-analysis.md` — three stale sections
- `docs/imap-manual-pull-call-chain.md` — writes description
- `docs/analysis-linux-decrypt-failure.md` — Phase B header note

---

## Stop-and-report conditions encountered

None. All four items resolved cleanly within the defined decision tree.

---

## Verification log

### Pre-conditions verified
- `rg "usePendingPlainEmailIngestion" -n` → zero matches in production code ✓
- `rg "SealVerifyContext" -n` → one match in a JSDoc comment describing historical removal (not a consumer) ✓
- `rg "plain_email_inbox" -n docs/` → remaining matches are in PR history docs (historical records) or updated text that correctly describes the removal ✓

### TypeScript
- `pnpm exec tsc --noEmit` in `apps/electron-vite-project` → 0 matches for `TS2451`/`P2P_BEAP_ACCOUNT_ID` ✓
- Error count: 327 (was 329; −2 from duplicate constant fix)

### Test collection (electron-vite-project)
- `pnpm exec vitest run` in `apps/electron-vite-project`: 249 test files collected (0 collection errors from duplicate constant)
- Previously, test collection was blocked by the esbuild duplicate-symbol error

### better-sqlite3 verification
- `node -e "require('better-sqlite3'); console.log('OK')"` → `OK` ✓
- `pnpm exec vitest run packages/relay-server packages/coordination-service` post-fix:
  - Previously: 95 skipped, 34 passed (ABI mismatch)
  - After fix: 125 passed, 4 failed (no skips, no ABI error)
  - The 4 failures are pre-existing test failures in relay-server → B-8.4 scope

### Workspace-root final run
```
Test Files  87 failed | 245 passed (332)
     Tests  201 failed | 3470 passed | 3 skipped | 29 todo (3703)
  Duration  11.47s
```

---

## What was not verified

1. **The 201 failing tests' root causes.** These are B-8.4's scope. The increase from 145 to 201 is expected: previously-skipped tests (relay-server, coordination-service, and newly-collecting electron tests) now run and find failures. B-8.4 will classify each failure as: (a) test needs updating for Phase B changes, (b) real Phase B regression, (c) legacy pre-Phase-B failure, or (d) test of removed functionality.

2. **TypeScript error counts.** 327 errors remain in `electron-vite-project`, 153 in `extension-chromium`. These are pre-existing debt, not introduced by this PR. Cleanup is a separate ongoing effort.

3. **Electron runtime (production) behaviour.** The better-sqlite3 prebuilt binary installed here is for system Node 22. The Electron production build uses the Electron-ABI binary managed by `pnpm install` / `onlyBuiltDependencies`. Those two binaries are separate; this fix applies to the Vitest/Node test runner only.

4. **The `postinstall` script on non-Windows platforms.** The script uses `require.resolve` + `execSync` which should be cross-platform, but was only tested on Windows. On macOS/Linux with Node 22 the prebuild should also download successfully since `better-sqlite3 v11.10.0` publishes `node-v127-*` binaries for all three platforms.

---

## After this PR

B-8.4 investigates the 201 failing tests, classifying each into:
- Test that needs updating for legitimate Phase B changes
- Test that found a real Phase B regression
- Test that was failing pre-Phase-B (legacy issue)
- Test that needs deletion (testing removed functionality)

After B-8.4 produces its categorization, fix PR(s) address actual failures,
and the structural sequence resumes at B-9 (sandbox clone outbound).
