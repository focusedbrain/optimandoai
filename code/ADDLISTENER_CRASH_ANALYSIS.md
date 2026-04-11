# Add Automation Wizard — `addListener` crash analysis (read-only)

**Scope:** Tracing `TypeError: Cannot read properties of undefined (reading 'addListener')` when the Add Mode / Custom Mode wizard runs inside the **Electron** dashboard (embedded `@ext` UI), where full Chrome extension APIs are not available.

**Note on paths:** `AddModeWizardHost.tsx` lives at `apps/extension-chromium/src/ui/components/AddModeWizardHost.tsx` (not under `addModeWizard/`). `CustomModeWizard` re-exports `AddModeWizard` from `./addModeWizard`.

---

## Section 1 — Search for `addListener` / `chrome.*` / `browser.*` (listed files + direct wizard imports)

### Matches inside the listed wizard files

| File | Line | Full line(s) | Function / component | Hook / context |
|------|------|--------------|----------------------|----------------|
| `apps/extension-chromium/src/ui/components/addModeWizard/steps/StepSession.tsx` | 49 | `chrome.runtime.onMessage.addListener(onMsg as Parameters<typeof chrome.runtime.onMessage.addListener>[0])` | `StepSession` | **`useEffect`** callback (runs after paint; dependency array `[load]`) |
| `apps/extension-chromium/src/ui/components/addModeWizard/steps/StepSession.tsx` | 50 | `return () => chrome.runtime.onMessage.removeListener(onMsg as Parameters<typeof chrome.runtime.onMessage.addListener>[0])` | `StepSession` | **Effect cleanup** |

### Same files — no other matches

- `AddModeWizard.tsx` — no `addListener`, no `chrome.runtime` / `chrome.storage` / `chrome.tabs` / `browser.*`.
- `AddModeWizardHost.tsx` — no `chrome.*` listeners; uses **`window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, …)`** in `useEffect` (lines 135–139).
- `StepModel.tsx`, `StepRun.tsx`, `StepFocus.tsx`, `StepBasics.tsx`, `StepReview.tsx` — no `addListener` / `chrome.*` / `browser.*`.
- `apps/extension-chromium/src/services/localOllamaModels.ts` — no matches.
- `apps/extension-chromium/src/stores/useCustomModesStore.ts` — no matches (Zustand `persist` uses `localStorage` via `createJSONStorage(() => localStorage)`).
- `apps/electron-vite-project/src/App.tsx` — only **comments** and a guard using `globalThis.chrome?.runtime` for **`id`** (lines 88–91, 136–140); no `addListener`.

### Related imports used by wizard steps (sampled for `chrome` / `addListener`)

| Module | `addListener` / top-level `chrome`? |
|--------|-------------------------------------|
| `fetchOrchestratorSessionsList.ts` | Uses `chrome.runtime` only inside **`fetchOrchestratorSessionsForWizard`** with `typeof chrome !== 'undefined'` and optional chaining before `sendMessage` — **no `addListener`**. |
| `localOllamaModels.ts` | **`electronRpc` only** in async functions — **no `addListener`**. |
| `electronRpc.ts` | Comments + **`chrome.runtime.sendMessage`** inside functions — **no `addListener`** on module import. |
| `syncCustomModeDiffWatcher.ts` | **`chrome.runtime.sendMessage`** inside `getLaunchSecret()` — **no `addListener`**. |
| `electronPickDirectory.ts` | **`window.electronAPI` / `window.wrChat`** only — **no `chrome`**. |

---

## Section 2 — Render-time vs effect-time vs module-level (per Section 1 match)

| Location | Classification | Notes |
|----------|----------------|--------|
| `StepSession.tsx` L49–50 | **EFFECT-TIME** | The `chrome.runtime.onMessage.addListener` / `removeListener` calls are **only** inside a `useEffect` body, not in the component’s synchronous render path. |

**Important nuance:** In the **Electron dashboard**, `ensureWrdeskChromeShim()` (`apps/electron-vite-project/src/shims/wrChatDashboardChrome.ts`) installs `chrome.runtime` with **`sendMessage`**, **`id`**, **`lastError`**, but **does not define `runtime.onMessage`**. Therefore:

- `chrome.runtime` is truthy (object exists).
- `chrome.runtime.onMessage` is **`undefined`**.
- **`chrome.runtime.onMessage.addListener(...)`** throws: **`Cannot read properties of undefined (reading 'addListener')`** — matching the reported error.

**React error boundary:** In React 18, **errors thrown inside `useEffect` are generally *not* caught** by `componentDidCatch` / class error boundaries (they surface as uncaught runtime errors). If production logs show this error **inside** `AddModeWizardErrorBoundary`’s `componentDidCatch`, possible explanations include: a different throw site during render, a bundler/source-map mismatch, or additional tooling wrapping effects. The **static** crash site for `addListener` on **`undefined`** in this wizard remains **`onMessage`** missing on the shim.

---

## Section 3 — Imports in wizard entrypoints and steps (top-level side effects)

### `AddModeWizard.tsx`

Imports: `react`; `lightboxTheme`; `customModeTypes`; `./addModeWizardTypes`; `./addModeWizardValidation`; `./customModeDraftDirty`; `./AddModeWizardStepBody`.

**Top-level `chrome` / `addListener` on import:** None identified in these modules (validation/dirty/types are pure TS / React).

### `AddModeWizardHost.tsx`

Imports: `react`; `lightboxTheme`; `useCustomModesStore`; `useUIStore`; `customModeTypes`; `syncCustomModeDiffWatcher`; `CustomModeWizard`; `WrMultiTriggerBar` events.

**`useCustomModesStore`:** Zustand `persist` — storage factory runs when store is used, not inherently `chrome` API.

**`syncCustomModeDiffWatcher`:** No module-level listener; async `sendMessage` only when functions run.

### `AddModeWizardStepBody.tsx`

Imports step components + types. **No** top-level chrome.

### `StepBasics.tsx`

Imports: `react`, `customModeTypes`, `lightboxTheme`, `safeDraftString`, validation types, `wizardConstants`, `wizardStyles`, `WizardFieldError`.

**`WizardFieldError.tsx`:** Presentational only — **no** `chrome`.

### `StepModel.tsx`

Imports: `react`, `customModeTypes`, `localOllamaModels`, `lightboxTheme`, validation, `wizardConstants`, `wizardStyles`, `WizardFieldError`.

**`localOllamaModels.ts`:** No top-level chrome execution.

### `StepSession.tsx`

Imports: `react`, `customModeTypes`, **`fetchOrchestratorSessionsList`**, `lightboxTheme`, `wizardStyles`.

**`fetchOrchestratorSessionsList.ts`:** No `addListener`; guarded `chrome.runtime` usage in async API.

### `StepFocus.tsx`

Imports: `react`, `customModeTypes`, `lightboxTheme`, `wizardStyles`, `WizardFieldError`, **`electronPickDirectory`**, **`parseWrExpertMarkdown`**, **`sha256HexUtf8`**.

**Spot-check:** `electronPickDirectory.ts` — window bridges only. `parseWrExpertMarkdown.ts` — **no** `chrome` (grep).

### `StepRun.tsx` / `StepReview.tsx`

Imports are types + UI + presets + `customModeTypes` helpers — **no** chrome listeners at import time.

---

## Section 4 — Custom hooks used by wizard steps

| Step / host | `use*` hooks | Definition file | `chrome` / `addListener` in hook body (non-`useEffect`)? |
|-------------|--------------|-----------------|-----------------------------------------------------------|
| `StepModel` | `useDebounced` (local) | Same file | **`useEffect` only** for debounce timer — no chrome. |
| `StepModel` | `useState`, `useCallback`, `useEffect`, `useMemo` | React | N/A |
| `StepSession` | `useState`, `useCallback`, `useEffect` | React | **`useEffect` contains** `chrome.runtime.onMessage.addListener` (see Section 1). |
| `StepFocus` | `useMemo`, `useRef` | React | **Render-time:** `getElectronPickDirectory()` is **called during render** to set `canBrowse` — returns `window` bridges only, **no** `chrome` / `addListener`. |
| `AddModeWizard` | `useMemo`, `useState`, `useEffect`, `useRef`, `useCallback` | React | No chrome APIs. |
| `AddModeWizardHost` | `useCustomModesStore`, `useUIStore`, `useMemo`, `useEffect`, `useCallback`, `useState` | Zustand stores | Store persistence uses **`localStorage`**, not `chrome.storage` listeners in this path. |

---

## Section 5 — Likely wizard step from minified stack (`w7`, `S7`, `k7`, `j7`, `C7`)

From `AddModeWizardStepBody`:

| `stepIndex` | Step component |
|-------------|----------------|
| 0 | `StepBasics` |
| 1 | `StepModel` |
| 2 | **`StepSession`** |
| 3 | `StepFocus` |
| 4 | `StepRun` |
| 5 | `StepReview` |

**Flow:** After **model selection**, the user advances from **step 1 (`StepModel`)** to **step 2 (`StepSession`)**.

**Conclusion:** The stack frame **`S7`** (minified child under the wizard) most likely corresponds to **`StepSession`** — the first step that registers a **`chrome.runtime.onMessage`** listener. That aligns with the crash appearing right after completing the model step, when **`StepSession` mounts** and its `useEffect` runs.

---

## Section 6 — Existing guard patterns (Electron vs extension)

Examples in-repo:

| Pattern | File (example) |
|---------|----------------|
| `typeof chrome !== 'undefined'` + optional chain | `fetchOrchestratorSessionsList.ts` (`chrome.runtime`), `modeRunExecution.ts`, `grid-integration-default-badge.js` (storage) |
| `typeof chrome?.runtime?.sendMessage !== 'function'` | `processFlow.ts` |
| `globalThis` / `window` cast for `chrome?.runtime` | `App.tsx` (checks `rt?.id` to skip extension-only setup) |
| Shim installs partial `chrome` when **`!w.chrome?.runtime?.id`** | `ensureWrdeskChromeShim()` in `wrChatDashboardChrome.ts` — **`sendMessage` present**, **`onMessage` absent** |

**Recommendation (for a future fix, not done in this doc):** Guard **`chrome.runtime.onMessage?.addListener`** before subscribing, or add a no-op **`onMessage: { addListener, removeListener }`** to the dashboard shim so `StepSession`’s effect does not throw in Electron.

---

## Manual verification checklist (post-fix, when implemented)

1. Open Electron app → Analysis → **+ Add Automation** → advance past **Model** to **Session** — wizard should not throw.
2. Same flow in **Chromium extension** — session list still refreshes on `SESSION_DISPLAY_NAME_UPDATED` if background sends that message.
3. With shim extended: ensure **no duplicate** listeners on repeated mount/unmount (cleanup `removeListener` still runs).

---

*Analysis only — no source files were modified for this document.*
