# Phase 2: Display-Grid Agent Box Equivalence — Implementation Report

## What Changed

### 1. Unified Agent Box Read Path (`processFlow.ts`)

**`loadAgentBoxesFromSession`** was reading from `chrome.storage.local` only. Grid boxes are saved to SQLite only (via `SAVE_AGENT_BOX_TO_SQLITE`). Result: grid boxes were structurally invisible to the routing engine.

**Fix:** Rewrote `loadAgentBoxesFromSession` to use `GET_SESSION_FROM_SQLITE` as the primary data source (same pattern as `loadAgentsFromSession`), with `chrome.storage.local` as fallback.

**New helper: `normalizeAgentBoxes`** ensures every box has both `id` and `identifier` set. Grid boxes historically only had `identifier` (e.g., `"AB0601"`), while sidepanel boxes had `id` (UUID). The normalizer bridges this by setting `id = identifier` when `id` is missing, and vice versa. This eliminates the identity gap between surfaces.

**New helper: `loadAgentBoxesFromChromeStorage`** provides the chrome.storage.local fallback path.

### 2. Unified Agent Box Output Write Path (`processFlow.ts` + `background.ts`)

**`updateAgentBoxOutput`** was reading/writing `chrome.storage.local` to find and update boxes. Grid boxes don't exist in `chrome.storage.local`, so output delivery to grid boxes always failed silently (`boxIndex === -1`).

**Fix:** Rewrote `updateAgentBoxOutput` to send a new `UPDATE_BOX_OUTPUT_SQLITE` message to the background script. The background handler:
1. Loads the session from SQLite
2. Finds the box by `id` OR `identifier` (handles both identity conventions)
3. Updates the `output` and `lastUpdated` fields
4. Saves back to SQLite
5. Broadcasts `UPDATE_AGENT_BOX_OUTPUT` to all extension pages via `chrome.runtime.sendMessage`

This single handler serves both sidepanel and grid boxes through the same code path.

**Fallback:** If SQLite is unreachable, `updateAgentBoxOutputInChromeStorage` provides the chrome.storage.local fallback (which still works for sidepanel boxes).

### 3. Grid Box Identity Normalization (`grid-script.js`, `grid-script-v2.js`)

Grid boxes were saved without an `id` field. The routing engine and `updateAgentBoxOutput` both use `box.id` to identify output targets.

**Fix:** Added `id: identifier` to both the `newConfig` object (stored in `data-slot-config` DOM attribute) and the `agentBox` object (sent to `SAVE_AGENT_BOX_TO_SQLITE`). This ensures grid boxes are addressable by the same field the routing engine uses.

### 4. Live Output Handler for Grid Pages (`grid-script.js`, `grid-script-v2.js`)

Grid pages had no listener for `UPDATE_AGENT_BOX_OUTPUT` messages. The sidepanel had this handler (updating React state), but grid pages simply ignored the message.

**Fix:** Added `chrome.runtime.onMessage` listener in both grid scripts that:
1. Receives `UPDATE_AGENT_BOX_OUTPUT` messages (broadcast by the background after SQLite save)
2. Finds the matching grid slot by checking each slot's `data-slot-config` against `boxId` (matches by `id` or `identifier`)
3. Updates the slot's content area with the formatted output text

### 5. Persisted Output Display on Grid Load (`grid-display.js`)

Grid slots showed "Configured ✓" even if the box had previous output stored in SQLite. On page refresh, output was lost from the visual display.

**Fix:** Modified `createSlots` in `grid-display.js` to check `saved.output` when building the initial slot content. If output exists, it renders it immediately with proper formatting (pre-wrap, word-break).

## Which Store/Adapter Path is Now Authoritative

**SQLite (via Electron backend at `127.0.0.1:51248`)** is the single authoritative store for both agent boxes and their output.

- **Read path:** `loadAgentBoxesFromSession` → `GET_SESSION_FROM_SQLITE` → SQLite
- **Write path (config):** `SAVE_AGENT_BOX_TO_SQLITE` → SQLite (unchanged)
- **Write path (output):** `UPDATE_BOX_OUTPUT_SQLITE` → SQLite (new)
- **Broadcast:** Background broadcasts `UPDATE_AGENT_BOX_OUTPUT` to all extension pages after every output write
- **Fallback:** `chrome.storage.local` serves as degraded fallback if Electron is unavailable

## How Sidepanel and Grid Equivalence is Achieved

| Capability | Before | After |
|---|---|---|
| Box visible to routing engine | Sidepanel only | Both |
| Output delivery works | Sidepanel only | Both |
| Live DOM update on output | Sidepanel (React state) | Both (React + DOM listener) |
| Persisted output on reload | Sidepanel (via session load) | Both |
| Box has `id` field | Sidepanel only | Both (`id = identifier` for grid) |
| Authoritative store | Split (chrome.storage vs SQLite) | Unified (SQLite) |

Both surfaces are now equivalent for the basic output path: routing finds the box, output is delivered to SQLite, and the appropriate surface updates its display.

## Hidden Prerequisites Discovered

1. **`id` vs `identifier` split:** Grid boxes used `identifier` exclusively; sidepanel boxes used `id`. The routing engine and output delivery both rely on `id`. This required both runtime normalization (in `normalizeAgentBoxes`) and save-time normalization (in grid scripts).

2. **Background broadcast needed:** The existing `chrome.runtime.sendMessage` in the old `updateAgentBoxOutput` was sent from the sidepanel context — it reached the background but NOT back to the sidepanel itself. Moving the broadcast to the background ensures ALL extension pages (sidepanel + grid pages) receive it.

3. **Grid-display.js output rendering:** The grid display created content areas with placeholder text but never checked for existing output. Without this fix, output would only appear for live updates, not on page reload.

4. **Dual matching in background handler:** The `UPDATE_BOX_OUTPUT_SQLITE` handler matches by `id` OR `identifier` because existing boxes in SQLite (saved before this fix) may only have `identifier`. This backward compatibility is essential for a non-breaking deployment.

## Files Touched

| File | Change |
|---|---|
| `src/services/processFlow.ts` | Rewrote `loadAgentBoxesFromSession` (SQLite primary), rewrote `updateAgentBoxOutput` (SQLite primary), added `normalizeAgentBoxes`, `loadAgentBoxesFromChromeStorage`, `updateAgentBoxOutputInChromeStorage` |
| `src/background.ts` | Added `UPDATE_BOX_OUTPUT_SQLITE` handler |
| `public/grid-script.js` | Added `id` to `newConfig` and `agentBox`, added `UPDATE_AGENT_BOX_OUTPUT` listener |
| `public/grid-script-v2.js` | Added `id` to `newConfig` and `agentBox`, added `UPDATE_AGENT_BOX_OUTPUT` listener |
| `public/grid-display.js` | Added output rendering on initial load |

## What Remains Intentionally Deferred

- **`grid-display-v2.html` initial load path:** V2 loads saved config from `chrome.storage.local` (not SQLite). V2 will receive live output updates (via the new listener in `grid-script-v2.js`), but may not show saved configs on reload. This is a V2-specific issue that doesn't block first E2E testing with V1.
- **Grid box rendering in sidepanel box list:** The sidepanel's `UPDATE_AGENT_BOX_OUTPUT` handler receives `allBoxes` from SQLite, which now includes grid boxes. The sidepanel may display grid boxes in its list. Filtering by `source` can be added later if visually confusing.
- **Streaming output:** Output is delivered as complete text, not streamed. Streaming can be added later without changing the architecture.
- **Cloud execution:** Still returns `ok: false` from `resolveModelForAgent` (Phase 1 contract). Grid boxes configured for cloud providers will show an error — this is correct behavior.
- **OCR routing order:** Not touched in this phase.

---

## Validation Checklist

### Test 1: Grid Box Visible to Routing
1. Open WR Chat (sidepanel)
2. Open a display grid and configure an Agent Box (e.g., slot 6) with:
   - Agent Number: 1
   - Provider: Local AI
   - Model: (your installed Ollama model)
3. Create/ensure Agent 01 exists with a trigger (e.g., `#test`)
4. Type `#test hello` in WR Chat
5. **Expected:** Console shows `[ProcessFlow] AgentBox X: { id: 'AB0601', source: 'display_grid', ... }` — the grid box was found by the routing engine

### Test 2: Output Reaches Grid Box
1. After Test 1, the LLM processes the request
2. **Expected:** The grid slot in the display grid shows the agent's output text (not "Configured ✓")
3. **Expected:** Console shows `[GridScript] Updated output in slot 6`

### Test 3: Grid Output Persists Across Reload
1. After Test 2, refresh the display grid page
2. **Expected:** The grid slot still shows the previous output text (rendered from `saved.output`)

### Test 4: Sidepanel Boxes Still Work
1. Configure a sidepanel Agent Box with Agent 02 and a local model
2. Type a message that triggers Agent 02
3. **Expected:** Output appears in the sidepanel Agent Box (no regression)

### Test 5: Wrong/Missing Model Shows Error in Grid Box
1. Configure a grid Agent Box with Provider: Local AI, Model: `nonexistent-model-xyz`
2. Trigger the agent
3. **Expected:** The grid slot shows `⚠️ Brain resolution failed...` error message (visible, not silent)

### Test 6: Session Reload Preserves Both Surfaces
1. Configure boxes in both sidepanel and grid
2. Reload the extension or restart the browser
3. **Expected:** Both sidepanel and grid boxes retain their configuration and any previous output

---

## Equivalence Status After This Phase

### Now Equivalent
- Routing can find boxes from both surfaces
- Output delivery works for both surfaces
- Live output updates reach both surfaces
- Box identity is consistent (`id` available on both)
- Both read from the same authoritative store (SQLite)

### Not Yet Fully Equivalent
- Grid boxes don't support delete/edit from the sidepanel (expected — they have their own edit UI)
- Grid-display-v2.html has a separate initial load path from chrome.storage.local (live updates work, reload config may not)
- Streaming output not implemented (complete text only)
- Grid boxes may appear in sidepanel box list (cosmetic, not functional)

---

## Risk After This Phase

### Resolved
- Grid boxes are no longer invisible to routing (was: complete blindness)
- Output delivery no longer fails silently for grid boxes (was: `boxIndex === -1`, resolve false)
- Grid pages now receive output updates (was: no listener)
- Box identity is bridged between surfaces (was: `id` vs `identifier` mismatch)

### Remaining
- **V2 grid reload:** V2 grid display may not load saved configs from SQLite on refresh (live updates work)
- **All-boxes in sidepanel:** `allBoxes` broadcast includes grid boxes in sidepanel state — may cause visual noise
- **Race condition on output save:** Two rapid output writes could theoretically conflict (load-modify-save is not atomic). Unlikely for first E2E testing.
- **Electron dependency:** If Electron is down, fallback to chrome.storage.local won't find grid boxes. Electron availability is assumed for local model execution anyway.
