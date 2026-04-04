# WR Desk Triage Report — Full Failure State

Generated: 2026-04-04 (read-only diagnosis; no code fixes applied in this pass)

## Failure Inventory

| Surface / Feature | Symptom | Likely cause (one line) |
|---|---|---|
| Dashboard panels | Unable to load / IPC error | `registerInboxHandlers` / `registerEmailHandlers` never ran in the running main build, or stale binary without latest startup order fix |
| Popup WRChat | Blank white render | Auth loading vs. logged-out UI should still paint ("Loading…" / sign-in); true blank suggests runtime error, wrong extension load path, or CSS/contrast — not proven from code alone |
| Docked capture | Button does nothing | `LETmeGIRAFFETHATFORYOU` undefined (preload/main issue) or WebSocket to `127.0.0.1:51247` not OPEN so `ELECTRON_START_SELECTION` branch fails |
| Dashboard WRChat LLM | Hangs in thinking | `fetch('http://127.0.0.1:51248/api/llm/chat')` never completes or `routeInput` / `runOcr` / agent loop stalls before `finally` clears loading |
| `email:listAccounts` IPC | No handler registered | Handlers live in `main/email/ipc.ts` and register only when `registerEmailHandlers()` runs successfully |
| `inbox:dashboardSnapshot` IPC | No handler registered | Same module path; registered inside `registerInboxHandlers()` |

## Root Cause Tree

### RC-1: Main-process IPC registration skipped or never reached (observed errors)
- **Files:** `apps/electron-vite-project/electron/main.ts`, `apps/electron-vite-project/electron/main/email/ipc.ts`
- **Line(s):** `main.ts` ~2275–2360 (`app.whenReady`), `ipc.ts` ~679 (`email:listAccounts`), ~3117–3132 (`inbox:dashboardSnapshot`)
- **Evidence:** Preload invokes `email:listAccounts` and `inbox:dashboardSnapshot` (`preload.ts`). Implementations are **not** `ipcMain.handle` in `main.ts` text; they are registered inside `registerEmailHandlers` / `registerInboxHandlers` imported from `./main/email/ipc`. "No handler registered" means those functions did not run successfully in the **running** process. Current `main` branch moves registration to **immediately after** `setUrlOpener`, before `setupFileLogging`, so later throws in the giant `app.whenReady` `try` block cannot skip them — **if** that build is what the user runs. Older builds placed registration later (after LLM init), where any earlier throw in the same `try` skipped all subsequent lines including registration.
- **Surfaces affected:** Analysis dashboard, Priority Inbox snapshot, `loadEmailAccounts`, any feature depending on email/inbox IPC.
- **Triggered by (P1–P4):** Aligns with historical regression: cross-package import / dev main bundle failure (REGRESSION_REPORT.md pattern) and/or **startup order** before the recent `register*` move.
- **Confidence:** **High** for "handlers not registered at runtime = registration path not executed or process is stale"; **Medium** that the user's log predates the latest `main.ts` ordering fix.

### RC-2: HTTP LLM path vs IPC (`/api/llm/chat`)
- **Files:** `electron/main.ts` (~7951 `httpApp.post('/api/llm/chat', …)`), `extension-chromium/.../PopupChatView.tsx` (`fetch` to `BASE_URL` `http://127.0.0.1:51248`)
- **Evidence:** Dashboard/extension chat uses **HTTP**, not `ipcMain.invoke('llm:chat')`. Infinite "thinking" can occur if Express is not mounted, port blocked, request hangs in handler (Ollama), or client never gets a response body. Missing **email/inbox** IPC does not by itself remove `/api/llm/chat` if HTTP server completed startup.
- **Surfaces affected:** WR Chat send in `PopupChatView` when using `fetch`.
- **Confidence:** **Medium** (orthogonal to missing inbox/email IPC unless whole `whenReady` aborted before HTTP mount).

### RC-3: Docked capture — bridge vs WebSocket
- **Files:** `wrChatCaptureDispatch.ts`, `background.ts` (`ELECTRON_START_SELECTION` ~2769+)
- **Evidence:** `startWrChatScreenCapture` uses preload `LETmeGIRAFFETHATFORYOU.selectScreenshot` when present; else `chrome.runtime.sendMessage({ type: 'ELECTRON_START_SELECTION', … })`. Background forwards to WebSocket `START_SELECTION` when `ws.readyState === WebSocket.OPEN`, else attempts on-demand connect to `ws://127.0.0.1:51247/`. If Electron main failed partially, preload APIs may be missing; if WS never connects, selection never starts.
- **Confidence:** **Medium**

### RC-4: Popup "blank" — auth gate vs runtime failure
- **Files:** `popup-chat.tsx` (`PopupChatApp`, `isLoggedIn === null` → "Loading…", `!isLoggedIn` → sign-in UI)
- **Evidence:** There is **no** unconditional `return null` for the whole app; loading state renders centered "Loading…". A **pure white** window with no text suggests either (a) crash before React paint, (b) extension HTML/CSS not loading, (c) user perception vs. "Loading…" on white background, or (d) different entry/HTML than assumed. Not confirmed without popup DevTools.
- **Confidence:** **Low** without runtime stack / network.

### RC-5: TypeScript / build hygiene (extension)
- **Files:** Multiple under `apps/extension-chromium/src/` (see TypeScript section)
- **Evidence:** `pnpm exec tsc --noEmit` reports **116** `error TS` lines in extension-chromium. Vite may still emit bundles; errors do not automatically explain IPC (Electron main is separate). They can still indicate fragile shared types and WRChat-adjacent files (`popup-chat.tsx`, `sidepanel.tsx` lines in error list).
- **Confidence:** **Medium** as contributor to subtle bugs, **Low** as sole cause of Electron IPC missing.

## Are all failures the same root cause?

**PARTIAL.** Missing `email:listAccounts` and `inbox:dashboardSnapshot` share one mechanism (inbox/email IPC registration). Docked capture and HTTP LLM depend on WebSocket/HTTP/preload and can fail independently. Popup blank is not proven to be the same IPC issue.

## Cross-Package Import Violations Found

Commands (adapted for this workspace):

- `grep -rn "extension-chromium/src" apps/electron-vite-project/electron/` (under `code/code`): **No matches in `.ts` sources.** Only comments in `electron/wrChatSurface.ts` and `electron/main/beap/beapEnvelopeAad.ts` reference paths as documentation.

- `grep -rn "electron-vite-project" apps/extension-chromium/src/`: **Comment / path-reference only**, e.g. `ui/components/wrChatSurface.ts` (comment pointing to Electron copy), `shared/email/connectEmailFlow.tsx`, `shared/components/EmailConnectWizard.tsx` (triple-slash reference).

**Note:** `main.ts` imports `surfaceFromSource` from **`./wrChatSurface`** (local Electron file), not from `extension-chromium/src`. Vite `resolve.alias` `@ext/...` in `vite.config.ts` maps extension sources for the **renderer** bundle; that is not the same as a raw `import from '../../extension-chromium/src/...'` in main.

## IPC Handlers Missing (runtime vs source)

| Channel (from errors) | In `main.ts` as `ipcMain.handle('…')`? | Where defined |
|---|---|---|
| `email:listAccounts` | **No** (not in `main.ts` grep) | `main/email/ipc.ts` via `registerEmailHandlers` |
| `inbox:dashboardSnapshot` | **No** | `main/email/ipc.ts` via `registerInboxHandlers` |

**Check C — `ipcMain.handle` / `ipcMain.on` in `main.ts`:** dozens of direct registrations (representative line numbers from grep: 1047–4291, 8873, …). **Additional** handlers: `main/email/ipc.ts` (~106 matches), `main/llm/ipc.ts` (e.g. `llm:chat` at ~218), `main/ocr/ipc.ts`, `lmgtfy/ipc.ts`, `ipc/db.ts` — invoked from `main.ts` via `register*()` or `createWindow` paths.

**Conclusion:** The two missing channels are **not** expected to appear as string literals in `main.ts`; they must appear after successful `registerEmailHandlers` / `registerInboxHandlers` in the live process.

## TypeScript Errors

### `apps/electron-vite-project` (`pnpm exec tsc --noEmit`)

```
error TS2688: Cannot find type definition file for 'dompurify'.
error TS2688: Cannot find type definition file for 'trusted-types'.
```

### `apps/extension-chromium` (`pnpm exec tsc --noEmit`)

**116** lines containing `error TS` (full listing is long; every line is one compiler diagnostic). Representative paths include:

`src/beap-builder/parserService.ts`, `visionExtractionService.ts`, `src/beap-messages/...`, `src/components/P2pOutboundDebugModal.tsx`, `src/popup-chat.tsx` (e.g. ~436 `Property 'ok' does not exist on type '{}'`), `src/sidepanel.tsx` (similar), `vite.config.ts`, and others.

**WRChat-related lines explicitly present in the compiler output:**

- `src/popup-chat.tsx(436,79)` / `(436,120)`: Property `ok` / `data` on `{}`
- `src/popup-chat.tsx(1872,13)` / `(1927,13)`: `Promise<boolean>` vs `Promise<void>` mismatch
- `src/sidepanel.tsx(1069,79)` / `(1069,120)` / `(1102,81)` / `(1102,122)`: same `ok`/`data` pattern
- `src/tests/wrChatPipeline.test.ts` (test typing)
- `vite.config.ts` (plugin / import extension issues)

For the **verbatim compiler transcript** (includes multi-line diagnostics), see **Appendix A** below (captured 2026-04-04).

Re-run:

`cd code/code/apps/extension-chromium && pnpm exec tsc --noEmit 2>&1`

## Git Diff Summary (Check D)

**Command:** `git diff HEAD~1 HEAD -- code/apps/electron-vite-project/electron/main.ts` (and other paths — **no diff** for `background.ts`, `PopupChatView.tsx`, etc. in the last commit).

**Latest commit:** `2933c94c` — `fix(main): register inbox/email IPC at start of app.whenReady; chore(build02011) stamp outputs`

### `main.ts` (only file with substantive diff vs `HEAD~1`)

- **(c) Wraps / moves code:** **Adds** a block immediately after `setUrlOpener` that dynamically imports `./main/email/ipc`, calls `registerInboxHandlers`, `setBeapInboxDashboardNotifier`, `registerEmailHandlers`, with nested `try/catch` and FATAL logs on import/register failure.
- **(a) Removes registration:** **Deletes** the duplicate email/inbox registration block that previously sat **after** the LLM `try/catch` (before OCR init).
- **Not in this diff:** No deletion of `ipcMain.handle('email:listAccounts')` from `main.ts` (it was never inlined there).

### `background.ts`, `PopupChatView.tsx`, `sidepanel.tsx`, `WrChatCaptureButton.tsx`, `wrChatCaptureDispatch.ts`

**Empty diff** vs `HEAD~1` — last commit did not touch these files.

**Flags for triage:** The regression symptoms in the user prompt may include **uncommitted local changes** or **earlier commits** than `2933c94c`; compare against the build the user actually runs.

---

### Paste of `main.ts` diff (from `HEAD~1` → `HEAD`, commit `2933c94c`)

See `git show 2933c94c -- code/apps/electron-vite-project/electron/main.ts`. Summary:

- **Inserts** after `setUrlOpener`: dynamic `import('./main/email/ipc')`, `registerInboxHandlers`, `setBeapInboxDashboardNotifier`, `registerEmailHandlers`, nested try/catch with `[MAIN] FATAL` logs on failure.
- **Inserts** `await setupFileLogging()` immediately after that block (unchanged relative position vs. before, but email block now precedes it).
- **Deletes** the former duplicate email/inbox registration block that lived after the LLM `try/catch` (before OCR init).

## Minimal Recovery Plan

1. **Inbox/email IPC:** Confirm the running binary matches commit `2933c94c` (or later) and that `~/.opengiraffe/logs/main.log` contains `[MAIN] Inbox IPC handlers registered` and `[MAIN] Email Gateway IPC handlers registered` early in startup. If FATAL import logs appear, fix the **dynamic import** failure of `./main/email/ipc` (dependency/native) — restores dashboard snapshot + email accounts IPC.

2. **HTTP LLM hang:** Verify `http://127.0.0.1:51248/api/health` and POST `/api/llm/chat` with `X-Launch-Secret` from extension; trace `main.ts` Express mount and Ollama handler — restores dashboard/extension chat completion.

3. **Docked capture:** Verify WebSocket `51247` and preload `LETmeGIRAFFETHATFORYOU` in dashboard renderer — restores capture.

4. **Popup blank:** Open popup DevTools, confirm `AUTH_STATUS` responses and absence of red errors; verify loaded extension folder is current `build*` — restores popup UX.

5. **Extension `tsc`:** Optionally reduce the 116 TS errors starting with `popup-chat.tsx` / `sidepanel.tsx` / shared RPC typings — long-term maintainability.

## What to Preserve

- Local **`electron/wrChatSurface.ts`** with `WrChatSurface`, `SOURCE_TO_SURFACE`, `surfaceFromSource` — avoids cross-package import in main.
- **`wrChatCaptureDispatch.ts`** dual path (preload bridge vs `ELECTRON_START_SELECTION`).
- **`main.ts` early `registerInboxHandlers` / `registerEmailHandlers`** placement (post-`setUrlOpener`, pre-`setupFileLogging`) — addresses skipped registration when later startup throws.

## What to Revert Completely

- **None identified in this read-only pass** from `HEAD~1` alone; reverting `2933c94c` would **reintroduce** late registration and worsen IPC skip risk. Any revert should be targeted only if a specific regression is **proven** with logs.

---

## Supplement: `main.ts` structural answers (prompt checklist)

| Question | Answer |
|---|---|
| `try/catch` / early exit before handler registration? | Outer `try` from ~2277 encompasses most of `whenReady`; uncaught throw jumps to ~9505 catch and **skips** everything after the throw, including any code after the throw point. **Early inbox/email registration** mitigates late throws. |
| Where are `email:listAccounts` / `inbox:dashboardSnapshot` registered? | **`main/email/ipc.ts`** inside `registerEmailHandlers` / `registerInboxHandlers` — not as raw strings in `main.ts`. |
| `./wrChatSurface` exists? | **Yes:** `apps/electron-vite-project/electron/wrChatSurface.ts` exports `WrChatSurface`, `SOURCE_TO_SURFACE`, `surfaceFromSource`. |
| `ipcMain.handle` / `on` count in `main.ts`? | **87** matching lines in current file (grep). Many more across imported modules. |
| `registerLlmHandlers` | Imported from `./main/llm/ipc` in `main.ts` (~4483+); separate from email/inbox registration order in current tree. |

---

## Appendix A — Full `extension-chromium` `tsc --noEmit` transcript

**Every compiler line** from `pnpm exec tsc --noEmit` (run from `code/code/apps/extension-chromium`, 2026-04-04) is in **`code/extension-tsc-errors.txt`** next to this report (245 lines; paths in that file are relative to `apps/extension-chromium/`). **116** distinct `error TS` codes appear (multi-line messages expand line count).

**Electron app `tsc` (same session):** only:

```
error TS2688: Cannot find type definition file for 'dompurify'.
error TS2688: Cannot find type definition file for 'trusted-types'.
```

*End of report.*
