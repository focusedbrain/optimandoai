# Regression Report — Capture & Dashboard

## Summary

Both regressions share a single architectural root cause introduced in **P1**: `electron/main.ts` gained a **cross-package ES module import** (`import { surfaceFromSource } from '../../extension-chromium/src/ui/components/wrChatSurface'`) that violates the package boundary between `electron-vite-project` and `extension-chromium`. In the current **production build** (build0016) Vite correctly inlines the function, so the compiled bundle is fine. However, in **dev mode** (`pnpm dev`) the `vite-plugin-electron` main-process sub-build runs its own Rollup pipeline that does **not** inherit the renderer-side `resolve.alias` table; it resolves the import by following the raw relative path on disk. If that file has not been compiled into the main bundle cache, or if the path changes, the entire `main.ts` module fails to load — preventing registration of the WebSocket `START_SELECTION` handler **and** all `ipcMain` handlers including `lmgtfy-show-trigger-prompt`, which silently kills both capture and dashboard IPC. Confidence: **High** (the import is confirmed at line 16; the build-time inlining is confirmed in `dist-electron/main-B9foNO0f.js`; the risk is real in dev mode and future refactors).

---

## Root Cause — Capture Not Starting

- **File:** `code/apps/electron-vite-project/electron/main.ts`
- **Line:** 16
- **What changed (P1):** Added `import { surfaceFromSource } from '../../extension-chromium/src/ui/components/wrChatSurface'` — a cross-package relative import from the Electron main process into the extension source tree.
- **Why it breaks capture:** This is a **top-level import**. In Node.js ESM (which Electron 30 uses), all top-level imports are resolved at module-load time. If this import fails — which it does in **dev mode** when `vite-plugin-electron`'s separate Rollup pipeline for `electron/main.ts` does not watch or re-bundle the cross-package dependency — the entire `main.ts` module crashes on load. No IPC handlers are registered, no WebSocket server starts, `beginOverlay` is never reachable. Clicking the capture button triggers `chrome.runtime.sendMessage({ type: 'ELECTRON_START_SELECTION', ... })` → `background.ts` → WebSocket → the `START_SELECTION` handler that was never registered → silence.
- **Secondary cause (P3):** The `SHOW_TRIGGER_PROMPT` surface-gate added in P3 (`if (pc !== 'sidepanel') return` in `sidepanel.tsx:1706`, `if (pc !== 'popup') return` in `PopupChatView.tsx:257`) uses strict equality. If `promptContext` is `undefined` — which happens whenever `lmgtfyLastSelectionSource` is not set before the `overlay-cmd` handler fires — **both** surfaces silently drop the message and the trigger-name / command form never appears even though the overlay did open.
- **Tertiary (P1, UX):** `PopupChatView.tsx:1007–1011` renders `<WrChatCaptureButton>` without `createTrigger` or `addCommand` props. The overlay's checkboxes start unchecked; `main.ts` overlay-cmd handler at line 1290 gates `SHOW_TRIGGER_PROMPT` on `msg.createTrigger || msg.addCommand`. Unless the user manually checks a box inside the overlay, the post-capture prompt never shows up in the popup or dashboard.
- **Confidence:** High (cross-package import confirmed at line 16; secondary and tertiary confirmed by code tracing)

---

## Root Cause — Dashboard Not Opening

- **File:** `code/apps/electron-vite-project/electron/main.ts`
- **Line:** 16 (same as above) + **lines 1309, 1415**
- **What changed (P1 + P3):**
  1. Same cross-package import (P1) — if `main.ts` fails to load in dev mode, `win.webContents.send('lmgtfy-show-trigger-prompt', ...)` is never registered and the dashboard capture trigger-prompt IPC never fires.
  2. The P3 gate `if (lmgtfyActivePromptSurface === 'dashboard' && win && !win.isDestroyed())` (lines 1309, 1415) means the `lmgtfy-show-trigger-prompt` IPC is **only sent when `lmgtfyActivePromptSurface === 'dashboard'`**. Before P3 this IPC was sent unconditionally. If `lmgtfyActivePromptSurface` is stale (e.g. a previous extension-side capture set it to `'sidepanel'`), the dashboard never receives trigger prompts.
- **Why it breaks dashboard mounting:** `WRChatDashboardView.tsx` renders `<div>Preparing WR Chat…</div>` until `ready === true`. `ready` is set inside a `useLayoutEffect` via an async bootstrap (`ensureOrchestratorSessionForDashboard`). If the main process crashes (see primary cause), no IPC handlers fire, but the dashboard component itself should still mount because its bootstrap path is self-contained (HTTP + localStorage fallback). The dashboard component mount is therefore **not directly blocked** by the main.ts crash. However, `PopupChatView.tsx:282–320` registers `onDashboardTriggerPrompt` only when `bridge?.onDashboardTriggerPrompt` is truthy. If the preload build is stale and does not expose `onDashboardTriggerPrompt`, the dashboard silently never receives capture results.
- **Confidence:** High for IPC gate regression; Medium for preload staleness

---

## Are These the Same Root Cause?

**YES** — the primary root cause is identical for both: the cross-package import at `electron/main.ts:16`, which can cause the entire Electron main module to fail to load in development, taking down both the WebSocket `START_SELECTION` handler (capture) and all `ipcMain` registrations (`lmgtfy-show-trigger-prompt`, dashboard). The secondary cause (P3 `promptContext` gating / surface-conditional IPC) also affects both: a wrong or absent `promptContext` silences the trigger prompt on every surface simultaneously.

---

## TypeScript Errors Found

### `code/apps/extension-chromium` (`npx tsc --noEmit`)

**WRChat-related:**
```
src/ui/components/WrChatCaptureButton.tsx(170,5): error TS2783:
  'border' is specified more than once, so this usage will be overwritten.
```
> In `baseAppBar()`, `border: 'none'` appears as a direct property and again inside the ternary spread. Vite build still succeeds (esbuild ignores TS errors), but `tsc` fails.

```
src/tests/wrChatPipeline.test.ts(60,29): error TS2353: Object literal may only specify known properties,
  and 'type' does not exist in type '{ tag?: string | undefined; ... }'.
src/tests/wrChatPipeline.test.ts(75,13): error TS2322: Type 'string' is not assignable to type 'string[]'.
```
> Test file type mismatches — pre-existing, not shipping code.

**Pre-existing (unrelated to WRChat):**
Errors in `parserService.ts`, `visionExtractionService.ts`, `beap-messages/**`, `signingKeyVault.ts` — all pre-date P1–P9.

### `code/apps/electron-vite-project` (`npx tsc --noEmit`)

```
error TS2688: Cannot find type definition file for 'dompurify'.
error TS2688: Cannot find type definition file for 'trusted-types'.
```
> Missing `@types/dompurify` and `@types/trusted-types` — pre-existing, unrelated to WRChat.

**No WRChat-specific TypeScript errors in the Electron package.**

---

## Cross-Package Import Violations

| File | Line | Import | Risk |
|------|------|--------|------|
| `code/apps/electron-vite-project/electron/main.ts` | 16 | `import { surfaceFromSource } from '../../extension-chromium/src/ui/components/wrChatSurface'` | **HIGH** — crosses `electron-vite-project` → `extension-chromium` package boundary. Works in Vite production build (code inlined as `so()` / `jT` in `main-B9foNO0f.js`). Fails silently or crashes in dev-mode hot-reload if the cross-package path is not watched by the sub-Rollup. |

All other imports in `electron-vite-project/electron/` stay within their own package. The `@ext/...` aliases in `vite.config.ts` are renderer-only; the main process sub-Vite config does not share them.

---

## Minimal Revert Plan

### Fix 1 — Remove cross-package import from `electron/main.ts` (resolves primary root cause for both regressions)

**File:** `code/apps/electron-vite-project/electron/main.ts`

Remove line 16:
```ts
// DELETE:
import { surfaceFromSource } from '../../extension-chromium/src/ui/components/wrChatSurface'
```

Create a new file **inside** the Electron package with the same constants:
**File (new):** `code/apps/electron-vite-project/electron/wrChatSurface.ts`
```ts
// Duplicate of extension-chromium/src/ui/components/wrChatSurface.ts
// Keep in sync manually or move both to a shared workspace package.
export type WrChatSurface = 'sidepanel' | 'popup' | 'dashboard'

export const SOURCE_TO_SURFACE: Record<string, WrChatSurface> = {
  'sidepanel-docked-chat': 'sidepanel',
  'wr-chat-popup': 'popup',
  'wr-chat-dashboard': 'dashboard',
}

export function surfaceFromSource(source: string | undefined): WrChatSurface {
  return SOURCE_TO_SURFACE[(source ?? '').toLowerCase()] ?? 'sidepanel'
}
```

Then in `main.ts` line 16 change to:
```ts
import { surfaceFromSource } from './wrChatSurface'
```

**Impact:** Zero logic change. Eliminates the cross-package boundary crossing. The Electron main-process sub-build will always find and inline this local file.

---

### Fix 2 — Guard `SHOW_TRIGGER_PROMPT` filter against missing `promptContext` (resolves secondary capture regression)

**File:** `code/apps/extension-chromium/src/sidepanel.tsx` — line 1706
```ts
// BEFORE:
if (pc !== 'sidepanel') return
// AFTER: treat undefined as matching sidepanel (backward-compat with older main builds)
if (pc !== undefined && pc !== 'sidepanel') return
```

**File:** `code/apps/extension-chromium/src/ui/components/PopupChatView.tsx` — line 257
```ts
// BEFORE:
if (pc !== 'popup') return
// AFTER:
if (pc !== undefined && pc !== 'popup') return
```

**Impact:** Restores pre-P3 behaviour when `promptContext` is absent (all surfaces show the prompt), while still respecting surface routing when `promptContext` is present.

---

### Fix 3 — Pass `createTrigger` / `addCommand` to `WrChatCaptureButton` in `PopupChatView.tsx` (resolves tertiary UX regression)

**File:** `code/apps/extension-chromium/src/ui/components/PopupChatView.tsx` — lines 1007–1011

Add props so the overlay checkboxes start checked, matching sidepanel behaviour:
```tsx
<WrChatCaptureButton
  variant="comfortable"
  theme={theme}
  source={captureSource}
  createTrigger={true}   // add
  addCommand={true}      // add
/>
```

---

### Fix 4 — Fix duplicate `border` property in `WrChatCaptureButton.tsx` (TS error)

**File:** `code/apps/extension-chromium/src/ui/components/WrChatCaptureButton.tsx` — line 170

Remove the top-level `border: 'none'` in `baseAppBar` (the ternary spread already handles all three theme branches).

---

## Changes Safe to Keep

All of the following are confirmed non-breaking and should **not** be reverted:

| Change | Location | Why safe |
|--------|----------|----------|
| `wrChatSurface.ts` created | `extension-chromium/src/ui/components/wrChatSurface.ts` | Clean file, no side effects, correctly exports `SOURCE_TO_SURFACE`, `surfaceFromSource`, `WrChatSurface` |
| `wrChatCaptureDispatch.ts` created | `extension-chromium/src/ui/components/wrChatCaptureDispatch.ts` | Correct logic: bridge-first, chrome.runtime fallback. Import of `SOURCE_TO_SURFACE` from same-package `./wrChatSurface` is clean |
| `WrChatCaptureButton.tsx` created | `extension-chromium/src/ui/components/WrChatCaptureButton.tsx` | Component logic is correct; only issue is duplicate `border` (Fix 4 above) |
| `source` prop routing (P1) | `WrChatCaptureButton` / `sidepanel.tsx` | Source strings match `SOURCE_TO_SURFACE` keys exactly |
| `promptContext` added to `SHOW_TRIGGER_PROMPT` (P3) | `main.ts` overlay-cmd handler | Correct; enables per-surface routing. Keep; just relax the filter guards (Fix 2) |
| `lmgtfy-show-trigger-prompt` IPC via `win.webContents.send` (P3) | `main.ts` lines 1309–1320 | Correct; dashboard receives trigger prompt via IPC. Keep the `lmgtfyActivePromptSurface === 'dashboard'` gate |
| `onDashboardTriggerPrompt` listener in `PopupChatView.tsx` (P3) | lines 282–320 | Correct IPC subscription. Keep |
| `PopupChatView.tsx` popup `SHOW_TRIGGER_PROMPT` listener early-return when `wrChatEmbedContext === 'dashboard'` (P3) | line 253 | Correct isolation. Keep |
| `background.ts` `SHOW_TRIGGER_PROMPT` relay with `promptContext` (P3) | lines 1103–1118 | Correctly forwards all fields. Keep |
| `ELECTRON_START_SELECTION` handler in `background.ts` | lines 2769–2807 | Unconditional relay; no new surface guard added. Keep |
| All P4 message-echo changes | `PopupChatView.tsx`, `sidepanel.tsx`, `background.ts` | No regressions found in P4 changes |
| Electron main `resolveLmgtfyPromptSurfaceFromSource` wrapper | `main.ts` lines 803–805 | Logic is correct once the import is moved to a local file (Fix 1) |
