# Phase 1 Implementation Report: Trustworthy Local Execution Baseline

**Date:** 2026-04-01  
**Scope:** Provider identity normalization, brain resolution fix, visible error surfacing  
**Status:** Implementation complete. Ready for validation.

---

## What Changed

### 1. Created `src/constants/providers.ts` — Canonical Provider Identity Constants

**Why:** The system had no shared definition of provider identity strings. The UI stored `'Local AI'`, the runtime recognized `'ollama'`/`'local'`/`''`, and cloud provider strings were similarly inconsistent. Every provider-related fix without this file would be a one-off string patch.

**What it provides:**
- `PROVIDER_IDS` — canonical runtime strings (`'ollama'`, `'openai'`, `'anthropic'`, `'gemini'`, `'grok'`, `'image_ai'`)
- `ProviderId` type — union of all valid provider IDs
- `PROVIDER_LABELS` — UI display labels mapped to ProviderId
- `toProviderId(input)` — converts any UI label or legacy string to a ProviderId (handles `'Local AI'` → `'ollama'`, `'Claude'` → `'anthropic'`, passthrough for already-normalized values)
- `toProviderLabel(id)` — reverse mapping for display purposes
- `isLocalProvider()` / `isCloudProvider()` — classification helpers
- `PROVIDER_MAP_FOR_GRID_JS` — inlineable constant block for plain-JS grid scripts

### 2. Rewrote `resolveModelForAgent` in `processFlow.ts`

**Why:** The original function silently fell back to a default model for any unrecognized provider. `'Local AI'` (the value stored by the UI) was lowercased to `'local ai'` which was NOT in the recognized list `['ollama', 'local', '']`. Every Agent Box configured with `Local AI` silently used the wrong model. Cloud providers also silently fell back.

**What changed:**
- Introduced `BrainResolution` discriminated union type: `{ ok: true; model, isLocal, provider, note }` or `{ ok: false; model, isLocal, provider, error, errorType }`
- Uses `toProviderId()` to normalize the stored provider string before matching
- Switch-on-ProviderId instead of ad-hoc string comparisons
- `'ollama'` (and empty string) → uses configured model correctly
- All cloud providers → returns `ok: false` with clear error message and `errorType: 'cloud_not_implemented'`
- Unknown providers → returns `ok: false` with `errorType: 'unknown_provider'`
- **Never silently falls back to a different model**

### 3. Updated Agent Box Save Paths to Store ProviderId

**Why:** The provider string must be normalized at write time, not at read time. If the UI stores `'Local AI'` and the runtime converts it, there's always a risk that conversion is missed somewhere. Storing the canonical `ProviderId` eliminates the mismatch class entirely.

**Files changed:**
- `content-script.tsx` — "Add New Agent Box" dialog: `toProviderId(providerInput.value)` before save
- `content-script.tsx` — "Edit Agent Box" dialog: `toProviderId(providerInput.value)` before save
- `content-script.tsx` — Edit dialog HTML: uses `toProviderLabel()` for pre-selecting the correct `<option>` when the stored value is a ProviderId
- `content-script.tsx` — `refreshModels()` in both Add and Edit dialogs: recognizes `'ollama'` as a local provider for model fetching
- `grid-script-v2.js` — Inlined provider constants (`toProviderIdV2`, `toProviderLabelV2`), save path converts to ProviderId, display path converts back to label, `fillModelSelectV2` recognizes `'ollama'`
- `grid-script.js` — Same changes as v2 (`toProviderIdGS`, `toProviderLabelGS`)

**Backward compatibility:** `toProviderId()` handles both old-format UI labels (`'Local AI'`) and already-normalized ProviderId values (`'ollama'`) via passthrough. Existing sessions with `'Local AI'` in their box configs will be normalized on next save. `resolveModelForAgent` also handles legacy strings via `toProviderId()` at resolution time.

### 4. Surfaced Brain Resolution Failures Visibly

**Why:** Without visible error messages, test failures caused by misconfiguration are indistinguishable from bugs. When `resolveModelForAgent` returns `ok: false`, the user must see why.

**What changed in `sidepanel.tsx`:**
- `processWithAgent()` — checks `modelResolution.ok`, writes error message to Agent Box output via `updateAgentBoxOutput`, returns `{ success: false, error }` to the caller which shows it in chat
- `processScreenshotWithTrigger()` — same error handling pattern
- `handleSendMessageWithTrigger()` — same error handling pattern

**Error message format:** `"⚠️ Brain resolution failed for {agentName}:\n{detailed error}"` — appears both in the Agent Box and in the chat.

---

## Files Touched

| File | Change Type | Description |
|---|---|---|
| `src/constants/providers.ts` | **NEW** | Canonical provider identity constants |
| `src/services/processFlow.ts` | **MODIFIED** | Added import for providers; rewrote `resolveModelForAgent` with `BrainResolution` type |
| `src/content-script.tsx` | **MODIFIED** | Added import for providers; save-time ProviderId conversion in Add/Edit dialogs; label-to-id matching in Edit dialog HTML; `refreshModels` recognizes `'ollama'` |
| `src/sidepanel.tsx` | **MODIFIED** | Added `BrainResolution` type import; error handling in 3 resolve+execute paths |
| `public/grid-script.js` | **MODIFIED** | Inlined provider constants; save-time conversion; display label conversion; `fillModelSelect` recognizes `'ollama'` |
| `public/grid-script-v2.js` | **MODIFIED** | Same as grid-script.js (v2 equivalents) |

---

## Hidden Prerequisites Discovered

1. **Three separate LLM execution paths in sidepanel.tsx**: Besides `processWithAgent()`, there are two additional agent execution paths — `processScreenshotWithTrigger()` and `handleSendMessageWithTrigger()`. All three independently call `resolveModelForAgent`. All three needed the brain resolution error handling. The analysis documents mentioned `processWithAgent` but did not enumerate all three paths with equal emphasis. All three are now fixed.

2. **Grid script `fillModelSelect` functions**: These use `provider.toLowerCase() === 'local ai'` to decide whether to fetch models from Ollama. With ProviderId now being `'ollama'`, the check needed to also match `'ollama'`. This was not called out in the analysis but would have silently broken model fetching in grid box editors after the save-time conversion.

3. **Edit dialog pre-selection**: When reopening an edit dialog for a box whose provider is now stored as `'ollama'` instead of `'Local AI'`, the `<option>` elements still use UI labels as values. The `selected` attribute comparison needed `toProviderLabel()` to map `'ollama'` back to `'Local AI'` for correct pre-selection.

---

## What Remains Intentionally Deferred

| Item | Why Deferred |
|---|---|
| Cloud provider execution | Separate phase — requires Electron dispatch + API key sync |
| Grid box persistence unification | Separate phase — `loadAgentBoxesFromSession` still reads `chrome.storage.local` only |
| Grid live output handler | Separate phase — grid pages still lack `UPDATE_AGENT_BOX_OUTPUT` handler |
| OCR before routing | Separate phase — `handleSendMessage` OCR sequencing unchanged |
| `CanonicalAgentBoxConfig.provider` type update | The canonical type still declares `AgentBoxProvider` with UI labels. Updating the type would require migration logic for existing sessions. The runtime now handles both formats via `toProviderId()` |
| API key store unification | Separate phase — extension still saves to localStorage |
| `EnrichedInput` type definition | Separate phase — prerequisite for OCR resequencing |
| Routing authority unification | Separate phase — `routeInput` still drives execution |

---

## Validation Checklist

### V1: Configured model name appears in LLM request path
1. Create or edit an Agent Box with provider `Local AI` and a specific model (e.g., `llama3.2:3b`)
2. Assign the box to an agent with a trigger keyword
3. Type the trigger keyword in WR Chat
4. Open browser DevTools → Network tab
5. Find the POST to `/api/llm/chat`
6. **Expected:** Request body contains `"modelId": "llama3.2:3b"` — NOT a different/fallback model name

### V2: Wrong or unavailable local model produces visible warning
1. Configure a box with `Local AI` and a model name that is NOT installed (e.g., `nonexistent-model:latest`)
2. Trigger the agent from WR Chat
3. **Expected:** The LLM call is attempted with the configured model name. If Ollama returns an error, the error surfaces in the Agent Box output or chat — not a silent empty box

### V3: Cloud provider produces visible error (not silent Ollama fallback)
1. Configure a box with `OpenAI` and model `gpt-4o`
2. Trigger the agent from WR Chat
3. **Expected:** Agent Box shows a message like "OpenAI cloud execution is not yet connected. Configure a Local AI model to test..." — NOT a response from Ollama

### V4: Provider identity stored consistently
1. Create a new Agent Box with `Local AI` provider
2. Open DevTools → Application → Storage → check the session blob
3. **Expected:** The box's `provider` field is `"ollama"`, not `"Local AI"`
4. Close and reopen the edit dialog
5. **Expected:** The provider dropdown correctly shows "Local AI" as selected

### V5: Sidepanel Agent Box output still works
1. Configure an agent with a trigger and a sidepanel box with `Local AI` + installed model
2. Type the trigger in WR Chat
3. **Expected:** Box populates with LLM output. Chat shows confirmation. No errors.

### V6: Edit dialog model fetching works with stored ProviderId
1. Create a box with `Local AI` → save → close
2. Reopen the edit dialog
3. **Expected:** Provider shows "Local AI" selected; Model dropdown loads and shows installed Ollama models

---

## Risk After This Phase

### Resolved
- `'Local AI'` provider string mismatch — **fixed**
- Silent wrong-model execution — **fixed** (errors are now visible)
- Provider identity drift across UI/storage/runtime — **fixed** (shared constants file)

### Remaining (by design — these are later phases)
- **Grid boxes still invisible to routing**: `loadAgentBoxesFromSession` reads `chrome.storage.local`. Grid boxes saved to SQLite are not found. No grid box will produce output yet.
- **OCR still runs after routing**: Image-triggered agents still won't activate from OCR text. The routing decision is made on pre-OCR text.
- **Cloud providers don't execute**: Brain resolution correctly reports the error now, but no cloud API call is made.
- **API keys still split**: Extension saves to `localStorage`; Electron reads from SQLite. Cloud execution (when built) will need key store unification first.
- **Legacy session data**: Existing sessions have `'Local AI'` as the stored provider. These are handled by `toProviderId()` at resolution time. They will be permanently normalized on the next edit+save cycle.

### New risk introduced
- **Grid script provider constant duplication**: The provider constants are inlined in plain JS because grid scripts cannot import TypeScript modules. If a new provider is added to `providers.ts`, the grid script inline blocks must be manually updated. A shared JSON constants file or build-time injection would eliminate this, but is out of scope for this phase.
