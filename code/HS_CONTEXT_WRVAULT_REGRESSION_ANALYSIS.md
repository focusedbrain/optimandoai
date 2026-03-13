# HS Context / WRVault Regression Analysis

**Date:** 2025-03-13  
**Task:** Focused code analysis for `require is not defined` and WRVault slowdown.  
**Status:** Analysis complete — no implementation.

---

## 1. Executive Diagnosis

### Most likely root cause of `require is not defined`

**The Electron vault `service.ts` uses bare `require()` in an ESM context.** The Electron project has `"type": "module"` in `package.json`, so the main process runs as ESM. In ESM, `require` is not defined. The `service.ts` file calls `require('./hsContextProfileService')` and `require('./hsContextAccessService')` inside `listHsProfiles`, `createHsProfile`, and other HS Context methods. When any of these methods run, they throw `ReferenceError: require is not defined`. The error is caught in `main.ts` and sent back to the extension as `{ success: false, error: "require is not defined" }`.

### Most likely root cause of WRVault becoming slow to open

**Combination of:** (a) large vault-ui chunk loaded via dynamic import, (b) sequential `ensureConnected()` + `getVaultStatus()` + dashboard init, (c) possible retries or blocking when RPC/HTTP calls fail or are slow. The slowdown is **not** primarily caused by the `require` error itself (that fails fast), but the vault-ui chunk is large and the init sequence does multiple round-trips.

### Whether both issues come from the same recent change or separate problems

**Different sources, but related:**
- **`require` error:** Caused by `service.ts` using `require()` in ESM. Other vault modules (`db.ts`, `crypto.ts`, `envelope.ts`, `hsContextOcrJob.ts`) correctly use `createRequire(import.meta.url)`; `service.ts` does not. This is an environment-boundary mistake.
- **Slowdown:** Likely from vault-ui chunk size, init sequence, and possibly retries/blocking when the `require` path fails (user sees loading then error). Not directly caused by the same code, but the failing RPC may contribute to perceived slowness (loading → error instead of quick success).

### Top 5 findings (prioritized)

1. **CONFIRMED:** `apps/electron-vite-project/electron/main/vault/service.ts` uses bare `require()` in 14 places for `hsContextProfileService` and `hsContextAccessService`. In ESM (`type: "module"`), `require` is undefined → `ReferenceError: require is not defined`.
2. **CONFIRMED:** Other vault modules (`db.ts`, `crypto.ts`, `envelope.ts`, `hsContextOcrJob.ts`) use `createRequire(import.meta.url)`; `service.ts` is the outlier.
3. **CONFIRMED:** The error surfaces in the extension UI because `hsContextProfilesRpc.ts` rejects with `response.error` when `response.success === false`, and `HsContextProfileList` / `HsContextProfileEditor` display it via `setError(err?.message)`.
4. **LIKELY:** WRVault open slowness from: large vault-ui chunk (dynamic import), `ensureConnected()` + `getVaultStatus()` + `initVaultUI` sequence, and possibly retries when RPC fails.
5. **CONFIRMED:** The draft-based profile creation and direct-upload flow are not the source of the `require` error; they trigger the same failing RPC (`createHsProfile`), which fails on the Electron side before any profile logic runs.

---

## 2. Active Failing Runtime Paths

### A. HS Context Profiles overview/list page

**Exact files/components/functions:**
- `apps/extension-chromium/src/vault/vault-ui-typescript.ts`: `loadHandshakeContextList()` → `mountHsContextProfileListInListArea(container, { initialView: 'list' })`
- `apps/extension-chromium/src/vault/hsContext/HsContextProfileList.tsx`: mounts, `useEffect` → `loadProfiles()` → `listHsProfiles()`
- `apps/extension-chromium/src/vault/hsContextProfilesRpc.ts`: `listHsProfiles()` → `sendVaultRpc('vault.hsProfiles.list', ...)`
- Background: forwards to Electron via WebSocket
- Electron `main.ts`: `handleVaultRPC` → `vaultService.listHsProfiles(tier, includeArchived)`
- `apps/electron-vite-project/electron/main/vault/service.ts`: `listHsProfiles()` → `require('./hsContextProfileService')` → **throws**

**Call chain from HS Context Profiles list render:**
```
User clicks "HS Context" in sidebar
  → loadHandshakeContextList(container)
  → mountHsContextProfileListInListArea(container, { initialView: 'list' })
  → createRoot(mountPoint).render(<HsContextProfileList initialView="list" />)
  → HsContextProfileList useEffect
  → loadProfiles()
  → listHsProfiles()
  → sendVaultRpc('vault.hsProfiles.list', { includeArchived })
  → chrome.runtime.sendMessage(VAULT_RPC)
  → Background: vault.bind (if _cachedVsbt), then ws.send(rpcMessage)
  → Electron: handleVaultRPC → vaultService.listHsProfiles(tier, false)
  → service.ts listHsProfiles: require('./hsContextProfileService') → ReferenceError
  → main.ts catch: socket.send({ success: false, error: error.message })
  → Background callback → sendResponse
  → hsContextProfilesRpc reject(new Error(response.error))
  → HsContextProfileList loadProfiles catch: setError(err?.message)
  → UI: error banner with "require is not defined"
```

**Where the runtime error surfaces to the UI:** `HsContextProfileList.tsx` lines 148–156, error banner div.

---

### B. Business Documents direct-upload preparation path

**Exact files/components/functions:**
- `HsContextProfileList` with `view === 'create'` → renders `HsContextProfileEditor` with `profileId={undefined}`
- `HsContextProfileEditor.tsx`: `useEffect` for `!profileId` → `createHsProfile({ name: 'Untitled', ... })` to create draft
- `hsContextProfilesRpc.ts`: `createHsProfile()` → `sendVaultRpc('vault.hsProfiles.create', input)`
- Electron: `vaultService.createHsProfile(tier, input)` → `require('./hsContextProfileService')` → **throws**
- `HsContextProfileEditor` catch: `setError(err?.message ?? 'Failed to prepare editor')`
- `HsContextDocumentUpload` is rendered only when `currentProfileId` is set; it never mounts if draft creation fails.

**Call chain from "New Profile" / document upload prep:**
```
User clicks "+ New Profile" or "Create First Profile"
  → setView('create'); setEditingId(undefined)
  → HsContextProfileEditor mounts with profileId=undefined
  → useEffect: _draftCreationPromise = createHsProfile({ name: 'Untitled', ... })
  → sendVaultRpc('vault.hsProfiles.create', input)
  → Background → Electron
  → service.ts createHsProfile: require('./hsContextProfileService') → ReferenceError
  → main.ts catch → socket.send({ success: false, error: "require is not defined" })
  → createHsProfile reject
  → HsContextProfileEditor catch: setError(err?.message)
  → UI: error message + Retry button; HsContextDocumentUpload never mounts (no currentProfileId)
```

**Where the runtime error surfaces to the UI:** `HsContextProfileEditor.tsx` error state (lines 126–131, 146–151, 488–492).

---

### C. WRVault opening/initialization path

**Exact files/components/functions:**
- `content-script.tsx` (or autofill popover): `import('./vault/vault-ui-typescript').then(({ openVaultLightbox }) => openVaultLightbox())`
- `vault-ui-typescript.ts`: `openVaultLightbox()` → creates overlay, `initVaultUI(mainContent)`
- `initVaultUI()`: `ensureConnected()` → `vaultAPI.getVaultStatus()` → `renderVaultDashboard` or unlock/create screen
- `renderVaultDashboard()`: `setTimeout(..., 100)` → `loadContainersIntoTree`, `addAddButtonsToTree`, `loadVaultItems(container, 'all')`

**Call chain from WRVault open → active render path:**
```
User triggers vault open (click, shortcut, etc.)
  → import('./vault/vault-ui-typescript')  [dynamic import — loads large chunk]
  → openVaultLightbox()
  → create overlay DOM, applyVaultTheme, initVaultUI(mainContent)
  → initVaultUI: ensureConnected() [WebSocket]
  → vaultAPI.getVaultStatus() [HTTP VAULT_HTTP_API]
  → renderVaultDashboard(container) or renderUnlockScreen / renderCreateVaultScreen
  → renderVaultDashboard: setTimeout 100ms
  → loadContainersIntoTree(container), addAddButtonsToTree(container), loadVaultItems(container, 'all')
  → User clicks "HS Context" → loadHandshakeContextList → (path A above)
```

**Exact call chain:** Content script → dynamic import vault-ui-typescript → openVaultLightbox → initVaultUI → ensureConnected + getVaultStatus → render dashboard → loadContainersIntoTree + loadVaultItems.

---

## 3. `require is not defined` Root-Cause Analysis

### Exact line/file where `require(...)` is used

**File:** `apps/electron-vite-project/electron/main/vault/service.ts`  
**Lines:** 1212, 1219, 1226, 1233, 1240, 1247, 1254, 1270, 1281, 1288, 1295, 1307, 1318

**Pattern:** Each HS Context method uses:
```ts
const { listProfiles } = require('./hsContextProfileService') as typeof import('./hsContextProfileService')
```

### Any helper that itself uses `require`

No. The `require` is used directly in `service.ts`. The `hsContextProfileService` and `hsContextAccessService` modules do not use `require`; they are ESM.

### Node/CommonJS-only dependency now imported into browser-rendered code

**None.** The extension/vault UI code does not use `require`. The error originates in the **Electron main process**, not the extension. The extension receives the error string in the RPC response.

### Pattern that works in Electron main/preload but not in extension/browser UI

The Electron main runs as ESM (`"type": "module"`). In ESM, `require` is not a global. Other vault modules use:
```ts
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
```
`service.ts` does **not** use this; it uses bare `require()`.

### Whether the error is thrown during module evaluation, component mount, or user action

**User action (indirectly).** The error is thrown when the Electron handler runs `vaultService.listHsProfiles()` or `vaultService.createHsProfile()`, which happens when the user:
1. Opens HS Context Profiles list (triggers `listHsProfiles`)
2. Clicks "New Profile" or "Create First Profile" (triggers `createHsProfile`)

### Confirmed root cause(s)

| Item | Details |
|------|---------|
| **Root cause** | `service.ts` uses bare `require()` in ESM context |
| **Exact file** | `apps/electron-vite-project/electron/main/vault/service.ts` |
| **Exact lines** | 1212, 1219, 1226, 1233, 1240, 1247, 1254, 1270, 1281, 1288, 1295, 1307, 1318 |
| **One source or multiple** | One source (service.ts); all 14 `require` calls fail |
| **UI surfaces affected** | HS Context Profiles list page, Business Documents / New Profile flow |

---

## 4. WRVault Performance Slowdown Analysis

### Suspected hotspots

| Hotspot | File/Function | Notes |
|---------|--------------|-------|
| Dynamic import of vault-ui | `import('./vault/vault-ui-typescript')` | Large chunk: React, vault-ui-typescript (~5k lines), HsContextProfileList, HsContextProfileEditor, HsContextDocumentUpload, api, types |
| ensureConnected | `vault-ui-typescript.ts` initVaultUI | Waits for WebSocket; may block if connection slow |
| getVaultStatus | vaultAPI | HTTP round-trip |
| loadContainersIntoTree + loadVaultItems | renderVaultDashboard | Additional API calls after 100ms delay |
| RPC failure cascade | When list/create fails | User sees loading → error; perceived as slow |

### Exact files/functions/effects

- `vault-ui-typescript.ts`: `openVaultLightbox()` → `initVaultUI()` → `ensureConnected()`, `getVaultStatus()`
- `vault-ui-typescript.ts`: `renderVaultDashboard()` → `setTimeout(..., 100)` → `loadContainersIntoTree`, `addAddButtonsToTree`, `loadVaultItems`
- `content-script.tsx`: `import('./vault/vault-ui-typescript')` — no code-splitting for vault-ui beyond this dynamic import

### Whether slowdown is caused by

| Cause | Contribution |
|-------|--------------|
| (a) Repeated async calls | Possible: ensureConnected + getVaultStatus + loadContainers + loadVaultItems |
| (b) Unnecessary initialization on vault open | Possible: full dashboard init even if user only needs HS Context |
| (c) Runtime error loops/retries | Unlikely: RPC fails once, no retry loop in hsContextProfilesRpc |
| (d) Duplicated mount logic | Unlikely: React Strict Mode double-mount is guarded by `_draftCreationPromise` |
| (e) Heavy data loading | Possible: loadContainersIntoTree, loadVaultItems |
| (f) Combination | **Yes** — chunk size + init sequence + possible blocking on ensureConnected |

---

## 5. Draft Creation / Direct-Upload Lifecycle Analysis

### Findings

- **Draft creation does NOT run on the list page.** Only when `view === 'create'` does `HsContextProfileEditor` mount and run `createHsProfile()`.
- **Draft creation is NOT triggered when no editor is active.** The list view does not mount the editor.
- **List/overview pages do NOT trigger document upload prep.** Document upload is inside `HsContextDocumentUpload`, which requires `currentProfileId`. Draft creation must succeed first.
- **"New Profile" and list page share `HsContextProfileList`** but the list view does not mount the editor; they are correctly separated by `view` state.
- **Draft creation imports/helpers are not leaking into non-editor paths.** `hsContextDraftLogic` is only imported by `HsContextProfileEditor`.
- **No module-level side effects** that would run on list mount.
- **Duplicate draft creation protection** via `_draftCreationPromise` is correct; it does not add meaningful cost.

### Conclusion

- **Draft-based approach:** OK.
- **Implementation:** Not mounted too broadly; editor-only logic is correctly scoped.
- **The `require` error:** Occurs when `createHsProfile` runs on the Electron side, before any draft logic. The regression is in Electron `service.ts`, not in the draft/upload flow.

---

## 6. Module-Boundary / Environment Analysis

### Whether the regression is caused by environment-boundary leakage

**Yes.** The Electron main process is ESM (`"type": "module"`). `require` is a CommonJS/Node global and is not defined in ESM. `service.ts` uses `require()` as if it were in a CommonJS context.

### Exact files/helpers crossing the wrong boundary

| File | Issue |
|------|-------|
| `apps/electron-vite-project/electron/main/vault/service.ts` | Uses bare `require()` in ESM. Should use `createRequire(import.meta.url)` or dynamic `import()`. |

**Correct pattern (used elsewhere in vault):**
- `db.ts`, `crypto.ts`, `envelope.ts`, `hsContextOcrJob.ts`: `const require = createRequire(import.meta.url)`

### Whether the same mistake explains the vault slowdown

**No.** The slowdown is from chunk size and init sequence. The `require` error causes RPC failure, which can make the UX feel slow (loading → error), but the primary slowdown is not the same bug.

---

## 7. HS Context Profiles Overview/List Regression Analysis

### What the list page now imports or initializes that it did not before

The list page mounts `HsContextProfileList`, which imports `HsContextProfileEditor` (for when `view === 'create'` or `'edit'`). Both use `hsContextProfilesRpc`, which sends `vault.hsProfiles.list` on mount. The list page does not initialize editor-only logic; it only calls `listHsProfiles()`.

### Whether Business Documents/draft-upload code leaked into the list page path

**No.** The list page does not mount `HsContextProfileEditor` or `HsContextDocumentUpload` when `view === 'list'`. The error on the list page is from `listHsProfiles()` failing, not from draft/upload code.

### Whether the list page is paying the cost of editor-only logic

**No.** The editor is only mounted when `view === 'create'` or `'edit'`. The list page only runs `loadProfiles()` → `listHsProfiles()`.

### Whether "Create First Profile" triggers the wrong code too early

**No.** "Create First Profile" correctly sets `view='create'`, which mounts the editor. The editor then creates a draft. The failure is in the Electron `createHsProfile` handler, not in the UX flow.

### Exact reason the list page is broken

The list page calls `listHsProfiles()` which uses `vault.hsProfiles.list` RPC. The Electron handler runs `vaultService.listHsProfiles()`, which does `require('./hsContextProfileService')` and throws. The RPC returns `{ success: false, error: "require is not defined" }`, and the list page displays it.

### Exact component boundary that should separate list view from editor/init logic

**Already correct.** `HsContextProfileList` renders either the list UI or `HsContextProfileEditor` based on `view`. The list view only runs `loadProfiles()`; the editor is not mounted. The fix is in Electron `service.ts`, not in component boundaries.

---

## 8. Data-Loading and Effect Analysis

### Effects with missing dependency guards

- `HsContextProfileList`: `useEffect(() => loadProfiles(), [loadProfiles])` — `loadProfiles` is stable (useCallback with []). OK.
- `HsContextProfileEditor`: Draft creation effect runs when `!profileId`; guarded by `mountedRef` and `_draftCreationPromise`. OK.

### Effects running in list view when they should run only in editor mode

**None.** The list view only runs `loadProfiles()`.

### State initializers doing async work too early

**None.** No async work in state initializers.

### Module-scope promises or singleton state causing unintended cross-view behavior

- `_draftCreationPromise` in `HsContextProfileEditor.tsx`: Shared across mounts to prevent duplicate draft creation in Strict Mode. Correct; does not affect list view.

### Repeated reloads of profiles/documents on mount

- `loadProfiles()` runs once on list mount. OK.
- Editor loads profile or creates draft once. OK.

### Expensive derived computations without memoization

None identified as primary slowdown.

### Exact effects/initializers to watch

| Effect | File | Risk |
|--------|------|------|
| `useEffect(() => loadProfiles(), [loadProfiles])` | HsContextProfileList | Low; runs once on mount |
| Draft creation useEffect | HsContextProfileEditor | Low; only when `!profileId` |

### Whether any are likely causing both breakage and slowness

**No.** The breakage is from Electron `require`; the slowness is from chunk size and init sequence. No single effect causes both.

---

## 9. Confirm Intended Fix Boundaries

### What should probably change

| Area | Change |
|------|--------|
| **Electron service.ts** | Replace `require('./hsContextProfileService')` and `require('./hsContextAccessService')` with `createRequire(import.meta.url)` or static/dynamic ESM imports. |
| **WRVault open (optional)** | Consider lazy-loading HS Context components only when user navigates to HS Context, to reduce initial chunk size. |

### What should NOT change

| Area | Reason |
|------|--------|
| **Direct-upload UX** | Keep Business Documents near top, direct upload during creation. |
| **Draft-based profile creation** | Keep; flow is correct. |
| **HsContextProfileList / HsContextProfileEditor structure** | Boundaries are correct. |
| **hsContextProfilesRpc** | No change needed. |
| **vault-ui-typescript init sequence** | No structural change for the `require` fix. |

### Whether WRVault open should avoid loading editor/draft logic until needed

**Optional optimization.** Currently, `vault-ui-typescript` imports `HsContextProfileList` at top level, which pulls in `HsContextProfileEditor` and `HsContextDocumentUpload`. Lazy-loading the HS Context subtree when the user clicks "HS Context" could reduce initial chunk size. Not required to fix the `require` error.

### Whether the runtime fix is isolated to import/env issues or tied to lifecycle issues too

**Isolated to import/env.** Fixing `service.ts` to use `createRequire` or ESM imports will resolve the error. No lifecycle changes needed.

---

## 10. Implementation Anchors for the Follow-Up Fix

### Exact files likely needing change

1. **`apps/electron-vite-project/electron/main/vault/service.ts`** — Add `createRequire` or replace `require` with ESM imports.

### Exact components/effects/imports to adjust

- **service.ts:** Add at top:
  ```ts
  import { createRequire } from 'module'
  const require = createRequire(import.meta.url)
  ```
  Or replace each `require('./hsContextProfileService')` with a static import at top and use the imported functions directly.

### Exact places where editor-only logic should be deferred/lazy-mounted

- **Optional:** `vault-ui-typescript.ts` — Use `React.lazy` + `Suspense` for `HsContextProfileList` when `loadHandshakeContextList` runs, instead of top-level import. Reduces initial chunk.

### Exact places where Node/CommonJS usage must be removed from browser paths

- **Extension:** No `require` in extension source (confirmed). The `autofillOrchestrator.ts` fix (ESM import for quickSelect) is already in place.

### Exact places where performance guards should be added

- **Optional:** `initVaultUI` — Consider parallelizing `ensureConnected()` and `getVaultStatus()` if they are independent, or showing a minimal UI before status is ready.

### Exact tests that should be added/updated

- **Regression:** `apps/extension-chromium/src/vault/__tests__/browser-safe-imports.test.ts` — Already guards against `require` in extension. Keep.
- **Electron:** Add test that `vaultService.listHsProfiles` and `vaultService.createHsProfile` do not throw `ReferenceError: require is not defined` when called in ESM context.

---

## 11. Most Likely Root Cause

### Single most likely source of `require is not defined`

**`apps/electron-vite-project/electron/main/vault/service.ts`** uses bare `require()` in an ESM main process. In ESM, `require` is not defined. The fix is to use `createRequire(import.meta.url)` (as in `db.ts`, `crypto.ts`, `envelope.ts`) or to switch to ESM imports.

### Single most likely source of WRVault slowdown

**Large vault-ui chunk** loaded via `import('./vault/vault-ui-typescript')` plus the **init sequence** (`ensureConnected` + `getVaultStatus` + dashboard load). The failing RPC can make the UX feel slower (loading → error) but is not the main cause.

### Whether they are linked

**Partially.** The `require` error causes RPC failure, so the user sees loading then an error instead of quick success. Fixing the `require` error will improve perceived speed for HS Context flows. The underlying chunk/init slowness is separate and can be optimized later.

---

## 12. Minimal Safe Fix Direction

### Smallest safe way to remove the runtime error

**In `apps/electron-vite-project/electron/main/vault/service.ts`:** Add at the top (after existing imports):
```ts
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
```
This restores `require` in the ESM context for that module. All 14 `require()` calls will then work. No other changes needed.

**Alternative:** Replace the dynamic `require()` calls with static imports:
```ts
import * as hsContextProfileService from './hsContextProfileService'
import * as hsContextAccessService from './hsContextAccessService'
```
Then use `hsContextProfileService.listProfiles`, etc. This avoids `require` entirely.

### Smallest safe way to stop WRVault from doing too much work on open

1. **Defer HS Context load:** Lazy-import `HsContextProfileList` only when the user clicks "HS Context" (e.g. `import('./hsContext/HsContextProfileList')` inside `loadHandshakeContextList`). Reduces initial vault-ui chunk.
2. **Parallelize init:** If `ensureConnected` and `getVaultStatus` can run in parallel, do so.
3. **Avoid redundant work:** Ensure `loadContainersIntoTree` and `loadVaultItems` are not called multiple times unnecessarily.

### How to preserve direct-upload HS Context UX while fixing both

- **No change to direct-upload UX.** Fixing `service.ts` will allow `createHsProfile` to succeed, so the draft is created and `HsContextDocumentUpload` mounts. The flow remains: New Profile → draft creation → Business Documents section with "+ Add PDF" → direct upload.
- **Optional chunk optimization** (lazy HS Context) does not change the UX; it only defers loading until the user navigates to HS Context.
