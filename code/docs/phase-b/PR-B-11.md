# PR B-11 — Phase B Final Hardening

**Date:** 2026-05-14
**Status:** Closes Phase B.

---

## Summary

This PR closes Phase B by structurally enforcing the canon directive at the CI level,
running a final audit confirming zero bypasses, scoping TypeScript debt, and producing
canonical closure documentation.

**After B-11:**
- Raw writes to `inbox_messages` / `quarantine_messages` outside the sealed-storage gate
  are **rejected by CI** at commit time, not just detected by manual audit.
- 9 production bypasses found by the new lint rule have been migrated to
  `prepareSealedOperationalUpdate` and the relevant columns added to the allowlist.
- The test suite is honest: 4175 passing, 10 known/deferred failures, zero structural
  regressions.
- The Phase B work is documented canonically in `PHASE_B_CLOSURE.md`.

---

## Diffs

### 1. `eslint.config.mjs` — beap-canon lint plugin

Added the `beap-canon` inline ESLint plugin with two rules:

**`beap-canon/no-raw-inbox-write` (error)**
Detects raw `db.prepare(INSERT INTO inbox_messages|quarantine_messages)` and
`db.prepare(UPDATE inbox_messages|quarantine_messages SET)` in production code
outside `__tests__/`, `test/`, and `sealed-storage/`.

**`beap-canon/no-raw-inbox-select` (warn)**
Detects raw `db.prepare(SELECT … FROM inbox_messages|quarantine_messages)` in the same
scope. Warn-only because raw reads for UI display are non-propagating; migration to
`sealedQuery` is tracked in `PHASE_B_DEFERRED_ITEMS.md`.

The rules are applied via:
```js
{
  files: ['apps/electron-vite-project/electron/main/**/*.ts'],
  ignores: ['**/__tests__/**', '**/test/**', '**/sealed-storage/**'],
  rules: {
    'beap-canon/no-raw-inbox-write': 'error',
    'beap-canon/no-raw-inbox-select': 'warn',
  },
}
```

### 2. `sealed-storage/index.ts` — allowlist additions

Added 8 operational columns to `OPERATIONAL_COLUMNS_ALLOWLIST`:

| Column | File where used | Nature |
|--------|----------------|--------|
| `lifecycle_exited_review_utc` | `inboxLifecycleEngine.ts` | Timestamp: when msg left pending-review |
| `lifecycle_final_delete_queued_utc` | `inboxLifecycleEngine.ts` | Timestamp: when final delete was queued |
| `lifecycle_remote_delete_skip_reason` | `remoteDeletion.ts` | Text: why remote delete was skipped (orphan account, etc.) |
| `deleted` | `remoteDeletion.ts` | Flag: soft-deleted locally |
| `deleted_at` | `remoteDeletion.ts` | Timestamp: when soft-deleted |
| `purge_after` | `remoteDeletion.ts` | Timestamp: grace-period end for local purge |
| `remote_deleted` | `remoteDeletion.ts` | Flag: remote mailbox deletion confirmed |
| `remote_deleted_at` | `remoteDeletion.ts` | Timestamp: when remote delete executed |

All columns are operational state (not content). None appear in `seal_input_json`.

### 3. Production code migrations (9 bypasses → canonical gate)

| File | Line | Old | New |
|------|------|-----|-----|
| `inboxOrchestratorRemoteQueue.ts` | 447 | `db.prepare(UPDATE inbox_messages SET remote_orchestrator_last_error …)` | `prepareSealedOperationalUpdate(db, …)` |
| `inboxOrchestratorRemoteQueue.ts` | 646 | `db.prepare(UPDATE inbox_messages SET email_message_id, imap_remote_mailbox …).run()` | `prepareSealedOperationalUpdate(db, …).run()` |
| `mergeExtensionDepackaged.ts` | 481 | `db.prepare(UPDATE inbox_messages SET has_attachments = 1, attachment_count …)` | `prepareSealedOperationalUpdate(db, …)` |
| `mergeExtensionDepackaged.ts` | import | — | Added `prepareSealedOperationalUpdate` to import |
| `inboxLifecycleEngine.ts` | 113 | `db.prepare(UPDATE inbox_messages SET pending_delete …, lifecycle_exited_review_utc …)` | `prepareSealedOperationalUpdate(db, …)` |
| `inboxLifecycleEngine.ts` | 176 | `db.prepare(UPDATE inbox_messages SET lifecycle_final_delete_queued_utc …)` | `prepareSealedOperationalUpdate(db, …)` |
| `inboxLifecycleEngine.ts` | import | — | Added `prepareSealedOperationalUpdate` to import |
| `remoteDeletion.ts` | 191 | `db.prepare(UPDATE inbox_messages SET lifecycle_remote_delete_skip_reason …)` | `prepareSealedOperationalUpdate(db, …)` |
| `remoteDeletion.ts` | 213 | `db.prepare(UPDATE inbox_messages SET deleted = 1, deleted_at, purge_after …)` | `prepareSealedOperationalUpdate(db, …)` |
| `remoteDeletion.ts` | 243 | `db.prepare(UPDATE inbox_messages SET deleted = 0, deleted_at = NULL, purge_after = NULL …)` | `prepareSealedOperationalUpdate(db, …)` |
| `remoteDeletion.ts` | 288 | `db.prepare(UPDATE inbox_messages SET remote_deleted = 1, remote_deleted_at …)` | `prepareSealedOperationalUpdate(db, …)` |
| `remoteDeletion.ts` | import | — | Added `prepareSealedOperationalUpdate` to import |

### 4. Test adaptation

`inboxLifecycleEngine.tick.test.ts`: Updated mock `db.prepare` returns to include
`{ changes: 1, lastInsertRowid: 0 }` from `.run()`. Required because
`SealedOperationalStatement.run()` destructures the `changes` field from the SQLite
result; the previous mock returned `undefined`.

### 5. New documentation

- `docs/phase-b/PHASE_B_CLOSURE.md` — canonical Phase B record.
- `docs/phase-b/PHASE_B_DEFERRED_ITEMS.md` — tracking document for all deferred work.
- `docs/phase-b/PHASE_B_COMPLETENESS_AUDIT.md` — updated audit prompt (incorporates
  B-7.3 attachment hash checks, B-7.1 allowlist enforcement, B-8 renderer-as-mirror,
  B-9 outbound clone coverage, B-11 CI lint verification).

---

## PR description

### Lint rule details

The `beap-canon` plugin is defined inline in `eslint.config.mjs` (no external package).
It analyzes static `db.prepare()` call expressions. Rules match:
- Argument is a string literal or a no-expression template literal.
- The SQL (uppercased, whitespace-normalized) matches the target pattern.

**Limitation (documented in "What was not verified"):** dynamic SQL (template literals
with expressions, SQL strings stored in variables before `prepare()` is called) is not
caught. The rule targets the most common pattern. Adversarial dynamic SQL requires a
separate approach (e.g., TypeScript branded-type wrapper or ESLint type-aware rules).

### Audit re-run result

**Section 2 (real bypasses): EMPTY.**

All 9 bypasses found by the write rule were in operational columns (soft-delete state,
lifecycle timestamps, IMAP UID updates) and have been migrated. The inbound path
(IMAP, P2P, extension), content update path, and outbound clone path were confirmed
clean by both lint and code review.

### TypeScript categorization

| Package | Errors | Classification |
|---------|--------|----------------|
| `electron-vite-project` | 327 | Pre-existing legacy (baseline unchanged from B-8.3) |
| `extension-chromium` | 153 | Pre-existing legacy (baseline unchanged from B-8.3) |

Phase B residue: **0** — no new errors introduced or left unfixed by Phase B PRs.
All mechanical residue was fixed inline during the relevant PRs.

---

## Verification log

### Lint pass (B-11 clean run)

```
$ pnpm lint 2>&1 | grep "no-raw-inbox-write" | wc -l
0   ← zero write errors

$ pnpm lint 2>&1 | grep "no-raw-inbox-select" | wc -l
41  ← SELECT warnings (non-critical, tracked)
```

### Deliberate bypass test

```
Appended to beapEmailIngestion.ts (temp):
  db.prepare('INSERT INTO inbox_messages (id) VALUES (?)').run('x')

$ npx eslint beapEmailIngestion.bypass-test.ts | grep "no-raw-inbox-write"
  1245:1  error  Raw db.prepare() write on a sealed-storage table is forbidden…
                 beap-canon/no-raw-inbox-write

Temp file removed. Clean run confirms zero errors on original file.
```

### Test suite

```
$ pnpm exec vitest run
Test Files: 4 failed | 326 passed (330)
Tests:      10 failed | 4175 passed | 9 skipped | 29 todo (4223)

Known failures (all pre-existing or deferred):
  outboundQueue.backoff.test.ts       — QB_09 retry diagnostic deferred
  hostAiRoutingCorrectness (2)        — Cat 3 pre-Phase-B
  internalInferenceService (5)        — Cat 3 pre-Phase-B
  internalInference.directHost (1)    — Cat 3 pre-Phase-B
  hostAiRoutingCorrectness (1 dup)    — Cat 3 pre-Phase-B
```

### TypeScript

```
$ cd apps/electron-vite-project && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
327  (unchanged from B-8.3 baseline)

$ cd apps/extension-chromium && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
153  (unchanged from B-8.3 baseline)
```

---

## Stop-and-report conditions — disposition

| Condition | Status |
|-----------|--------|
| No lint infrastructure | NOT triggered — ESLint v9 flat config already present |
| Audit Section 2 not empty | NOT triggered — Section 2 empty after 9 bypass fixes |
| Phase B residue TS errors substantial | NOT triggered — 0 Phase B residue errors |
| Deliberate bypass test shows rule doesn't catch | NOT triggered — bypass correctly caught |

---

## What was not verified

1. **Dynamic SQL bypass variants** — `db.prepare(buildSql(table))` or SQL built via
   string concatenation before `prepare()` is called. The lint rule only catches static
   string literals and no-expression template literals. A TypeScript branded-type wrapper
   around `db.prepare` would close this gap but is out of B-11 scope.

2. **Completeness of audit prompt coverage** — the `PHASE_B_COMPLETENESS_AUDIT.md`
   covers all Phase B concerns as of B-11. New structural surfaces introduced after
   B-11 are not automatically included; the audit must be updated when new surfaces
   are added.

3. **TypeScript categorization accuracy** — attribution of errors to "pre-existing
   legacy" vs "Phase A residue" vs "Phase B residue" is heuristic for files not clearly
   in Phase B scope. Exact attribution requires `git bisect` which was out of scope.

4. **Sandbox-side structural property** — the sandbox's handling of host-cloned payloads
   (quarantine receive, sandbox validation, sandbox inbox write) was not subjected to a
   Phase-B-depth structural audit. Existing tests cover the happy path.

5. **Select rule exhaustiveness** — the `beap-canon/no-raw-inbox-select` warnings cover
   known sites but may miss raw reads added via patterns the rule doesn't yet detect
   (e.g., parameterized table name in template literal). These would not cause structural
   bypasses (reads don't propagate content into sealed rows) but would bypass seal
   verification for UI delivery.

6. **Closure document completeness** — `PHASE_B_CLOSURE.md` captures the architectural
   decisions and PR sequence as understood at B-11. Decisions made informally during
   review discussions and not written to a PR document may not be reflected.
