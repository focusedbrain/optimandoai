# IMAP sync: debugging summary and fix

## 1. Problem statement

An IMAP account could appear **connected and healthy** while the inbox stayed **empty** or failed to show expected mail. Manual “reset sync state” often helped, which pointed at **sync cursor / incremental window** behavior rather than raw authentication.

## 2. Confirmed root cause

After the first successful sync (`last_sync_at` set), **incremental** pulls use `fromDate: last_sync_at`. On a run where the provider **listed zero messages** and **zero messages were ingested**, the orchestrator still **advanced `last_sync_at` to “now”**.

Only **bootstrap** had a guard for “0 listed / 0 new” (do not set the anchor). **Incremental** did not, so a bad or empty **list** step (e.g. IMAP SEARCH, folder path, transient failure that returned an empty set without throwing) could **move the anchor forward** and **shrink the next query window**, making the account look fine while mail never re-entered the incremental range.

## 3. Why `testConnection` still passed

Connection checks typically validate **login**, **capability**, and sometimes **folder select** — not the full **list + SEARCH/SINCE + fetch + ingest** path used by Smart Sync. An account can be **authenticated** and **select INBOX** while incremental listing still returns **no rows** (wrong folder, SEARCH semantics, window, or bugs in list code). Those are separate layers.

## 4. What code was changed

| Area | Change |
|------|--------|
| **Anchor policy** | For any sync that is **not** Pull More, **`last_sync_at` is not advanced** when **`listedFromProvider === 0`** and **`newIngestedCount === 0`**. Pull More keeps advancing on an empty page so **older-mail pagination** can complete. |
| **Implementation** | Logic lives in `shouldSkipAdvancingLastSyncAt()` (`electron/main/email/domain/syncLastSyncAnchorPolicy.ts`) and is used from `syncAccountEmailsImpl` in `syncOrchestrator.ts`. |
| **Regression tests** | `syncLastSyncAnchorPolicy.test.ts` (included in root `pnpm test:email-lifecycle`). |
| **Diagnostics** | IMAP-only one-line summary: **`[IMAP-SYNC-SUMMARY]`** (JSON: folders, mode, window, listed, deduped, fetch_ok/miss, inserted, errors, `advance_last_sync_at`). |
| **Docs / comments** | Module header and `[SYNC-DEBUG]` messaging updated so behavior matches “bootstrap **or** incremental empty list,” not bootstrap only. |

## 5. Why OAuth was largely “unaffected”

Gmail / Microsoft paths share the **same** orchestrator and **same** anchor rule. In practice, when there is **no new mail**, APIs often still **return recent messages** that **dedupe out** (`listed > 0`, `newIngestedCount === 0`), so **`last_sync_at` still advances** — unchanged and desirable.

The bug was specific to the case **`listed === 0` and `new === 0`** on a non–pull-more run. That showed up most clearly on **IMAP** when listing failed “softly,” but the **fix is provider-agnostic** and **safer for OAuth** if an API ever returned an empty list without error.

## 6. How to verify manually

1. Use an IMAP account that previously showed **empty inbox** with **active** status.
2. Pull / auto-sync with a build that includes the fix.
3. Confirm mail appears when the server has messages in the expected folder, **without** needing reset for a **transient empty list**.
4. Optional: inspect `email_sync_state` — after an **empty** incremental-style pull, **`last_sync_at` should not move** (same value as before the run when listed/new were both 0).
5. Run **`pnpm exec vitest run apps/electron-vite-project/electron/main/email/domain/syncLastSyncAnchorPolicy.test.ts`** (or **`pnpm test:email-lifecycle`**) in the repo `code` root.

## 7. What logs to inspect if it happens again

Search the **Electron main** log for:

- **`[IMAP-SYNC-SUMMARY]`** — single JSON line per completed IMAP sync: use **`listed`**, **`syncMode`**, **`fromDate` / `last_sync_at_before`**, **`advance_last_sync_at`**, **`fetch_miss`**, **`errorCount`** to separate list vs fetch vs routing.
- **`[SYNC-DEBUG]`** (enable with **`EMAIL_DEBUG=1`** or dev build) — list options, resolved folders, “0 listed” hints, stuck-detection warnings.
- Existing lines: **`SYNC_LIST_RESULT`**, **`SYNC_LIST_CALL`**, **`[SyncOrchestrator] IMAP folder list failed`**, **`Message processing error`**.

Interpretation sketch: **`listed: 0`** + **`advance_last_sync_at: false`** after the fix means the anchor was preserved (retry same window). If **`listed > 0`** but **`inserted: 0`** and **`deduped` high**, behavior is likely **normal dedupe**, not this drift case.

## 8. Remaining limitations / technical debt

- **Pull More** still **advances `last_sync_at`** on **0 listed / 0 new** by design; revisit only if product wants a different contract for history pagination.
- **Partial failures** (e.g. some folders error, merged list empty) are not modeled separately from “empty list”; **`errorCount`** may be non-zero while **`listed === 0`** — worth a future policy pass if that case matters.
- **`inbox:resetSyncState`** still does **not** clear **`last_uid`** / **`sync_cursor`** (see `docs/email-sync-state-audit.md`); low impact today if `sync_cursor` is unused for IMAP listing.
- **testConnection** does not replace an end-to-end **list + ingest** check; consider a dedicated “sync probe” if false greens remain an issue.

---

*Related: `docs/email-sync-state-audit.md`, `docs/imap-pipeline-analysis.md`.*
