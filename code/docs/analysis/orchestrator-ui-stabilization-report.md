# Orchestrator UI stabilization pass — report

## Changed files

| File | What changed |
|------|----------------|
| `apps/extension-chromium/src/services/localOllamaModels.ts` | **New.** Canonical `fetchInstalledLocalModelNames()` using `electronRpc('llm.status')` (same contract as WR Chat / LLM Settings). Exports `escapeHtmlAttr` for safe `<option>` rendering. |
| `apps/extension-chromium/src/content-script.tsx` | (1) **`csAgentFormUi()`** — theme-aware colors for AI Instructions sections on light vs dark. (2) **Listener / Reasoning / Execution** — replaced hardcoded `#fff` / white rgba with tokens so **Standard (light)** theme is readable. (3) **Entity cleanup** — replaced corrupted `&rdquo;…` sequences with Unicode (em dash, bullets, arrows, ellipsis, ‹ ›). (4) **Agent Box add/edit** — Local AI model list loads from **`fetchInstalledLocalModelNames`**; static Ollama name list removed for that provider. (5) **`makeSelect`** — uses `csTheme().inputBg` / `inputText` / `border`. (6) Initial **`void refreshModels()`** on add dialog. |
| `apps/extension-chromium/public/grid-script.js` | **`modelOptionsStatic`**, **`fetchLocalModelNames`**, **`fillModelSelect`** via `chrome.runtime.sendMessage({ type: 'ELECTRON_RPC', method: 'llm.status' })`. Display grid Agent Box editor matches extension behavior for Local AI. |
| `apps/extension-chromium/public/grid-script-v2.js` | Same pattern as v1; **fixed missing `providers` / `currentProvider` / `displayBoxNumber` / `models`** declarations in `showV2Dialog` (were implicit/undefined). |

## What each area fixes

1. **AI Instructions readability (light theme)**  
   Sections previously used **white text** on **light panels** (`rgba(255,255,255,0.08)` backgrounds under Standard theme). `csAgentFormUi()` drives **text**, **muted**, **well**, and **ghost button** styles from `csTheme().isLight`.

2. **Encoding / entities**  
   UI showed literal `&rdquo;` because source strings contained the characters `&`, `r`, `d`, `q`, `u`, `o`, `;` (not HTML-decoded). Replaced with real Unicode punctuation at the **source** in `content-script.tsx`.

3. **Local model sync**  
   Agent Box **Local AI** provider no longer uses a **hardcoded** model name list. Lists come from **`llm.status` → `modelsInstalled`**, shared with WR Chat via the new module. Empty/error states are explicit.

## Follow-up risks

- **Saved model missing from Ollama** (e.g. pulled elsewhere): selector may pick the first returned model instead of the old id; consider appending the persisted `model` if absent from the backend list.
- **Dynamic trigger rows** in the Listener still contain many inline `color:#fff` fragments; only the **main** L/R/E shells were themed in this pass.
- **`grid-script*.js`** duplicates RPC parsing; a future refactor could inject a single shared snippet or build step—out of scope here.

## Validation checklist

### AI Instructions readability
- [ ] Set theme **Standard** (light). Open **AI Instructions** for an agent. Confirm **Listener / Reasoning / Execution** titles, helper text, and secondary buttons are readable (no white-on-white).

### Encoding / entities
- [ ] Open orchestrator UI where **quotes, bullets, arrows** appear (e.g. slide prev/next on carousel if used, agent list titles). No raw `&rdquo;` substrings.

### Local model sync
- [ ] With Electron running and Ollama showing models in **LLM Settings**, open **Add Agent Box** → **Local AI** → model dropdown lists **the same** installed models (pull a new model and re-open; it should appear without code change).
- [ ] Open **display grid** slot editor (v1 and v2 if both used) with **Local AI**; same behavior.
- [ ] Stop Ollama or use no models: dropdown shows **empty / helpful** state, not a stale static list.
