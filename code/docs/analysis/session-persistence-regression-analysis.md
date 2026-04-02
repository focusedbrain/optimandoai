# Session Persistence Regression Analysis

**Date:** 2026-04-02  
**Scope:** Extension Chromium — session persistence, agent box registration, sessions history rendering  
**Evidence basis:** Full static code inspection of `content-script.tsx`, `background.ts`, `storageWrapper.ts`, `processFlow.ts`, `InputCoordinator.ts`, `OrchestratorSQLiteAdapter.ts`, `agent-manager-v2.ts`

---

## 1. Executive Summary

The session persistence system has three independent, compounding failure points:

1. **Agent boxes are persisted via a separate async SQLite path** (`SAVE_AGENT_BOX_TO_SQLITE`) that bypasses the canonical `ensureSessionInHistory` function used by all other session fields. This creates a divergence: `agentBoxes` may exist in SQLite from the background handler, or only in `localStorage`, or neither — depending on timing and whether the Electron app is running.

2. **`saveCurrentSession` overwrites `session.agents` with an incompatible payload** from `collectAgentConfigs()`, which scans `localStorage` for `agent_model_v2_*` keys. These objects have a completely different shape from the `session.agents` that `processFlow.parseAgentsFromSession` expects. When `saveCurrentSession` fires (on first user action or lock button), it silently overwrites any well-formed `session.agents` array with a malformed one.

3. **`SAVE_AGENT_BOX_TO_SQLITE` in `background.ts` auto-creates a shallow agent shell** (`{key: "agent1", name: box.title, enabled: false, config: {}}`) in `session.agents` every time a box is saved. When Sessions History reads `session.agents`, it displays these auto-created shells — not real configured agents. The UI label shows "🤖 AI Agents (1)" with the box title as the agent name, giving the false appearance that an agent called e.g. "beap" exists.

The net result: **the session data model is maintained by three independent writers** (content script, background via HTTP, `ensureSessionInHistory`) with **no coordination layer** ensuring they produce compatible schemas. The agent box overview shows "0 registered boxes" because the session blob read at that moment either has no `agentBoxes` (race: box was only in localStorage at read time) or has boxes that fail the `title || agentId || agentNumber || model || provider` filter.

---

## 2. Confirmed Observations

These are directly supported by code inspection:

| # | Observation | Source |
|---|------------|--------|
| O1 | Sessions History shows "AI Agents (1)" with item "beap" for a session that has an agent box configured, not an actual agent | `content-script.tsx:38477–38501` — `session.agents` is rendered under this label |
| O2 | Agent Box Overview shows "Registered Boxes: 0" | `content-script.tsx:40235–40240` — `registeredBoxes.length` is 0 |
| O3 | A box was configured in the UI (visible in workspace) | User observation, confirmed by `currentTabData.agentBoxes` push at `6534` |
| O4 | The "Agents" button in Sessions History opens the Agent Box Overview, not an agent list | `content-script.tsx:38459, 38693–38711` |
| O5 | `SAVE_AGENT_BOX_TO_SQLITE` auto-creates `session.agents` entries with box title as agent name | `background.ts:4271–4310` |
| O6 | `saveCurrentSession` replaces `session.agents` with `collectAgentConfigs()` output | `content-script.tsx:41326–41348` |
| O7 | `collectAgentConfigs()` scans `localStorage` for `agent_model_v2_*` keys — not canonical session agents | `content-script.tsx:41153–41209` |
| O8 | `saveTabDataToStorage` writes only to `localStorage`, never to SQLite | `content-script.tsx:4482–4521` |
| O9 | `OrchestratorSQLiteAdapter` had no `X-Launch-Secret` header on all HTTP calls (fixed in commit `a622834b`) | `src/storage/OrchestratorSQLiteAdapter.ts` (fixed) |
| O10 | Sessions created before the auth fix were stored only in Chrome storage, not SQLite | Consequence of O9 |

---

## 3. Expected Behavior

When a user creates a session, configures an agent, and adds an agent box:

1. **Session object** stored under key `session_<timestamp>` contains:
   - `tabName`, `url`, `timestamp`, `isLocked`
   - `agents[]` — configured agents with `{key, name, number, enabled, config: {instructions: {...}}}` 
   - `agentBoxes[]` — agent box configs with `{id, identifier, boxNumber, agentNumber, title, model, provider, agentId, source, enabled}`
   - `displayGrids[]`, `helperTabs`, `customAgents`, `hiddenBuiltins`

2. **Sessions History** correctly shows:
   - "📦 Master Agent Boxes (N)" — count from `session.agentBoxes`
   - "🤖 AI Agents (N)" — list from `session.agents`, showing only user-configured agents with `enabled: true`

3. **Agent Box Overview** correctly shows N registered boxes matching each configured box.

4. **Restore** reconstructs the full runtime state including both `agentBoxes` and `agents` from the same session blob.

---

## 4. Actual Behavior

1. **Agent box creation path** (master tab):
   - Pushes box to `currentTabData.agentBoxes` ✓
   - Writes to `localStorage` only via `saveTabDataToStorage()` ✓ (local only)
   - Sends `SAVE_AGENT_BOX_TO_SQLITE` to background ✓
   - Background loads session from SQLite (may fail if auth not yet resolved), merges box, saves session back ✓
   - Background **also auto-creates** a shallow agent shell in `session.agents` with `enabled: false` and `name = box.title` ⚠️
   - `ensureSessionInHistory` is **NOT called** on this path ❌

2. **Agent save path** (sidepanel form):
   - Calls `saveAgentConfig` → `normalizeSessionAgents` → `ensureSessionInHistory` ✓
   - `ensureSessionInHistory` does a **full overwrite** including `agents: transformedAgents` ✓
   - But this overwrites any `agents` entries that were auto-created from boxes if the names differ ⚠️

3. **`saveCurrentSession` (lock button or first action)**:
   - Replaces `session.agents` with `collectAgentConfigs()` output (localStorage scan) ❌
   - This payload has a different schema — no `key`, no `number`, no `config` structure
   - Spreads `currentTabData` so `agentBoxes` is included IF `currentTabData.agentBoxes` is populated ⚠️
   - BUT if save fires before SQLite response returns (race condition), `currentTabData.agentBoxes` may contain the box already; HOWEVER the `agents` field is corrupted ❌

4. **Sessions History rendering**:
   - Reads full session blob from `storageGet(null)` (merged Chrome + SQLite)
   - Displays `session.agents` as "AI Agents" — which may contain the auto-created shells with box titles ❌
   - "Master Agent Boxes" shows count from `session.agentBoxes` — but if box save failed (SQLite 401 before fix), count is 0 ❌

5. **Agent Box Overview**:
   - Reads `session.agentBoxes` for the selected session key
   - Filters: only boxes with `title || agentId || agentNumber || model || provider` are "registered"
   - If SQLite was down when box was saved, `session.agentBoxes` is empty → 0 registered boxes ❌
   - If session was read from Chrome storage (fallback), the box was never written there (only localStorage) → 0 ❌

---

## 5. Probable Failure Points

Ranked from most to least likely:

| Rank | Failure Point | Confidence |
|------|--------------|------------|
| 1 | Sessions created before auth fix (O9) only exist in localStorage; SQLite has no data; all reads from SQLite see empty sessions | **High** |
| 2 | `SAVE_AGENT_BOX_TO_SQLITE` auto-creates agent shells in `session.agents` from box titles, causing Sessions History to display box names under "AI Agents" | **High** |
| 3 | `saveCurrentSession` overwrites `session.agents` with incompatible `collectAgentConfigs()` payload, destroying any previously correct agent array | **High** |
| 4 | `saveTabDataToStorage` writes agentBoxes only to localStorage, not SQLite; if page reloads before `SAVE_AGENT_BOX_TO_SQLITE` completes, boxes may be lost | **Medium** |
| 5 | `openAgentBoxOverview` filter at `39963` excludes boxes missing `title/agentId/agentNumber/model/provider`; newly created minimal boxes may be filtered out | **Medium** |
| 6 | `ensureSessionInHistory` not called during the master-tab box creation flow; session history is never updated with the box | **Medium** |
| 7 | `storageGet(null)` in `openSessionsLightbox` may return stale Chrome-only data if SQLite adapter returned empty and Chrome fallback doesn't have `session_*` keys (because they were in SQLite before auth fix, now inaccessible) | **Medium** |
| 8 | `agent-manager-v2.ts` creates sessions with a different schema (no `agentBoxes`, no `displayGrids`) that may overwrite the canonical session | **Low** |
| 9 | `displayGrids: null` initial value — if never populated, grids appear missing even if they exist | **Low** |
| 10 | Multiple session key stores (`sessionStorage`, `localStorage`, `chrome.storage.local`) can diverge after page navigations | **Low** |

---

## 6. Data Model and Schema Review

### 6.1 Expected canonical session schema

```
session_{timestamp}_{random} → {
  tabName: string
  url: string
  timestamp: ISO string
  isLocked: boolean
  lastOpenedAt?: ISO string
  agents: AgentRecord[]          // user-configured agents
  agentBoxes: AgentBoxRecord[]   // configured boxes
  displayGrids: DisplayGrid[]
  helperTabs: any | null
  customAgents: any[]
  hiddenBuiltins: any[]
  numberMap: { [key: string]: number }
  nextNumber: number
  context?: object               // user/publisher context
  agentsV2?: any[]               // agent-manager-v2 path (separate)
  agentEvents?: any[]            // agent-manager-v2 path
  hybridAgentBoxes?: any[]       // hybrid master tab boxes
}
```

### 6.2 AgentRecord (expected by processFlow.parseAgentsFromSession)

```
{
  key: string          // sanitized name e.g. "summarizer", "agent1"
  name: string
  icon: string
  number: number       // 1-indexed
  enabled: boolean
  kind: "custom"
  scope: "session" | "account"
  config: {
    instructions: string | object  // JSON with listening/reasoning/execution
  }
  listening?: object
  reasoning?: object
  execution?: object
  capabilities?: string[]
}
```

### 6.3 AgentRecord (what `collectAgentConfigs()` produces — INCOMPATIBLE)

```
{
  name: string        // from localStorage key agent_model_v2_{name}
  model: object|null  // parsed JSON from agent_model_v2_{name}
  context: string|null
  memory: string|null
  source: string|null
  persist: string|null
  priority: string|null
  autostart: string|null
  autorespond: string|null
  delay: string|null
  // MISSING: key, number, enabled, kind, scope, config
}
```

### 6.4 AgentRecord (what `SAVE_AGENT_BOX_TO_SQLITE` auto-creates — SHELL)

```
{
  key: "agent1"           // always "agent" + agentNumber
  name: box.title         // agent name = box title (misleading)
  icon: "🤖"
  number: agentNumber     // from box.agentNumber
  kind: "custom"
  scope: "session"
  enabled: false          // always disabled
  config: {}              // always empty
}
```

### 6.5 AgentBoxRecord (what `newBox` produces in content-script)

```
{
  id: string              // custom-{timestamp}-{random}
  boxNumber: number
  agentNumber: number
  identifier: string      // AB{boxNum}{agentNum}
  agentId: string         // "agent{agentNumber}"
  number: number          // same as boxNumber (backward compat)
  title: string
  color: string
  outputId: string
  provider: string
  model: string
  tools: any[]
  wrExperts: any[]
  side: string
  tabIndex: number
  masterTabId: string
  tabUrl: string
  source: "master_tab"
  enabled: boolean
}
```

### 6.6 Schema mismatches

| Mismatch | Impact |
|----------|--------|
| `collectAgentConfigs()` output has no `key`, `number`, or `config.instructions` | `parseAgentsFromSession` falls back to index-based number extraction; trigger matching fails |
| Auto-created agent shell has `name = box.title` | Sessions History "AI Agents" displays box titles as agent names |
| Auto-created shell has `enabled: false`, `config: {}` | Agent matching in `evaluateAgentListener` always rejects (no capabilities, no triggers) |
| `displayGrids: null` initial value vs expected `[]` | Spread into session saves `null`; readers expecting array will see falsy |
| `agentBoxes` not included in `SAVE_SESSION_TO_SQLITE` after `saveCurrentSession` if `currentTabData.agentBoxes` is populated but box was only in localStorage | SQLite has empty agentBoxes array |

---

## 7. Save Pipeline Analysis

### 7.1 Box creation (master tab) — `content-script.tsx:6490–6603`

```
newBox → currentTabData.agentBoxes.push(newBox)
       → localStorage (saveTabDataToStorage) [IMMEDIATE, LOCAL ONLY]
       → chrome.runtime.sendMessage(SAVE_AGENT_BOX_TO_SQLITE) [ASYNC]
             └─ background.ts:4222–4388
                   └─ fetch SQLite GET session
                   └─ merge agentBoxes
                   └─ AUTO-CREATE agent shell in session.agents  ← PROBLEM
                   └─ fetch SQLite SET session
       → ensureSessionInHistory: NOT CALLED  ← PROBLEM
```

**The session history record is NEVER updated** when a box is created via the master tab flow. The box is only in SQLite if the background HTTP call succeeds (requires auth, requires Electron app running).

### 7.2 Lock / first-action save — `saveCurrentSession` `content-script.tsx:41302–41398`

```
saveCurrentSession()
  → collectAgentConfigs()  ← reads localStorage agent_model_v2_* (INCOMPATIBLE SCHEMA)
  → sessionKey = session_{Date.now()} [ALWAYS NEW KEY]  ← PROBLEM
  → sessionData = { ...currentTabData, agents: collectAgentConfigs() }
  → storageSet({ [sessionKey]: sessionData })  → SQLite + Chrome fallback
  → setCurrentSessionKey(sessionKey)
```

**Critical:** every call to `saveCurrentSession` creates a **new session key**. If called twice, there are two session records. The old record with properly configured boxes is abandoned.

### 7.3 Agent config save — `ensureSessionInHistory` `content-script.tsx:2977–3072`

```
saveAgentConfig()
  → ensureActiveSession()
  → normalizeSessionAgents()
  → agent.config[configType] = configData
  → ensureSessionInHistory(activeKey, session, cb)
        → completeSessionData = {
            ...session,
            agents: transformedAgents,  // from session.agents (may include shells)
            agentBoxes: session.agentBoxes || [],
          }
        → storageSet({ [sessionKey]: completeSessionData })
        → SAVE_SESSION_TO_SQLITE (redundant second write)
```

**`agentBoxes: session.agentBoxes || []`** — uses whatever was in the session at read time. If the box was saved to SQLite but the `storageGet` in the agent save path reads a stale version, the box may be lost.

### 7.4 Race condition

Timeline of box creation + agent save:

```
t=0  User creates box →  currentTabData.agentBoxes = [newBox]
t=1  SAVE_AGENT_BOX_TO_SQLITE sent
t=2  User saves agent config
t=2  storageGet([sessionKey]) inside agent save path → reads SQLite
     If t < SQLite response for SAVE_AGENT_BOX_TO_SQLITE:
       session.agentBoxes = []  (box not yet in SQLite)
t=3  ensureSessionInHistory saves session with agentBoxes: []
t=4  SAVE_AGENT_BOX_TO_SQLITE background response arrives → merges box into session
     BUT ensureSessionInHistory at t=3 already wrote agentBoxes: []
     → box is now lost from session
```

This is a **confirmed race condition**. The save path does not lock or sequence the two async operations.

---

## 8. Restore / Hydration Analysis

### 8.1 Session key recovery

On page load:
1. `getCurrentSessionKey()` → `sessionStorage['optimando-current-session-key']` → `localStorage['optimando-global-active-session']`
2. These keys survive page reload (sessionStorage clears on tab close; localStorage persists)
3. `processFlow.getCurrentSessionKeyAsync()` reads `chrome.storage.local['optimando-active-session-key']` — a **third store** written by `setCurrentSessionKey`. Can diverge.

**Divergence scenario:** User navigates to new page; `sessionStorage` is cleared; `localStorage` still has old key; `chrome.storage.local` has a different key from a later `setCurrentSessionKey` call. The three reads return different values. The winner depends on which read order fires first.

### 8.2 Session data recovery

On restore at `content-script.tsx:5078–5124`:

```javascript
chrome.runtime.sendMessage({ type: 'GET_SESSION_FROM_SQLITE', sessionKey })
  → background.ts:4079 → fetch orchestrator/get → fallback chrome.storage.local
  → response.session merged into currentTabData
  → if agentBoxes.length > 0: renderAgentBoxes()
```

**Problem:** If session was saved to Chrome storage (localStorage fallback, not `chrome.storage.local`) before auth fix, the `chrome.storage.local` fallback in background.ts also won't find it. The data exists only in `localStorage` (from `saveTabDataToStorage`), which is **not read** during this restore path.

### 8.3 displayGrids hydration

`currentTabData.displayGrids = null as any` initially. If session.displayGrids was null when saved (spread from initial state), restore merges `null`. Grid rendering functions may not check for null before iterating.

### 8.4 agentBoxes hydration 

`renderAgentBoxes()` is called at restore (`5089–5092`). It reads `currentTabData.agentBoxes`. If restore came back empty, `currentTabData.agentBoxes` remains `[]` and no boxes render.

Separately, `content-script.tsx:5361–5367` explicitly **does not save** when agentBoxes is empty on init:
```javascript
// DON'T save here! This would wipe out boxes from other tabs/grids on page refresh
currentTabData.agentBoxes = []
```
This is correct defensively, but means a failed restore produces a silent empty state with no error to the user.

---

## 9. UI Mapping / Presentation Defects

### 9.1 "AI Agents (1)" showing box title

**Root cause:**  
`SAVE_AGENT_BOX_TO_SQLITE` in `background.ts:4288–4305` creates:
```javascript
{ key: "agent1", name: msg.agentBox.title, enabled: false, config: {} }
```
This pushes the box's title into `session.agents` as an agent name. When Sessions History renders `session.agents`, it uses `agent.name` for each chip.

So if the box title is "beap", a chip labeled "beap" appears under "🤖 AI Agents (1)".

This is **not** an agent — it is an auto-generated placeholder that was intended to pre-allocate an agent number for box routing purposes.

### 9.2 "Master Agent Boxes (0)" or absent

Sessions History shows `session.agentBoxes.length`. If:
- SQLite write failed (pre-auth-fix) → `session.agentBoxes` is empty in SQLite
- Session was read from Chrome storage fallback → Chrome storage was never written (only localStorage was)
- `saveCurrentSession` ran after `ensureSessionInHistory` and spread `currentTabData` where `agentBoxes` was `[]` → overwrote the boxes with empty

In any of these cases, `session.agentBoxes` is `[]` and the "Master Agent Boxes" section is not rendered at all.

### 9.3 "Agents" button label mismatch

The button labeled **"Agents"** in Sessions History actually opens **Agent Box Overview** (not an agent list). This naming causes user confusion — users expect it to list configured agents, but it lists agent boxes. When the overview shows "0 registered boxes", users believe their agent configuration is missing.

### 9.4 Agent Box Overview zero-registration filter

`openAgentBoxOverview:39963` only includes boxes with at least one of: `title`, `agentId`, `agentNumber`, `model`, `provider`. A minimal box (e.g. created with only `identifier` and `boxNumber`, no title set) would be excluded. However, the standard `newBox` includes all of these fields, so this filter should not normally cause 0 boxes unless the `agentBoxes` array itself is empty.

---

## 10. Instrumentation Plan

### 10.1 Session lifecycle probes

**`ensureSessionInHistory` (content-script.tsx:2977)**  
Add at entry:
```javascript
console.log('[SESSION_PROBE] ensureSessionInHistory called', {
  sessionKey, 
  agentBoxCount: sessionData.agentBoxes?.length ?? 'undefined',
  agentCount: sessionData.agents?.length ?? 'undefined',
  caller: new Error().stack?.split('\n')[2]
})
```
Add before `storageSet`:
```javascript
console.log('[SESSION_PROBE] completeSessionData payload', {
  agentBoxes: completeSessionData.agentBoxes?.map(b => b.identifier),
  agents: completeSessionData.agents?.map(a => ({ key: a.key, name: a.name, number: a.number }))
})
```

**`saveCurrentSession` (content-script.tsx:41302)**  
Add:
```javascript
console.log('[SESSION_PROBE] saveCurrentSession: new key =', sessionKey, 
  'agentBoxes from currentTabData:', currentTabData.agentBoxes?.length,
  'agents from collectAgentConfigs:', agents.length,
  'agents[0] sample:', agents[0])
```

**`SAVE_AGENT_BOX_TO_SQLITE` result callback (content-script.tsx:6560)**  
Add:
```javascript
console.log('[SESSION_PROBE] Box saved to SQLite. Response:', response,
  'sessionKey:', sessionKey, 'boxId:', newBox.identifier)
```

### 10.2 Background probes (background.ts)

**`SAVE_AGENT_BOX_TO_SQLITE` after merge (background.ts:4305)**  
Add before fetch SET:
```javascript
console.log('[BG_PROBE] Pre-save session snapshot:', {
  agentBoxes: session.agentBoxes.map(b => b.identifier),
  agents: session.agents.map(a => ({ key: a.key, name: a.name, enabled: a.enabled })),
  autoCreatedShell: !existingAgent
})
```

**`SAVE_SESSION_TO_SQLITE` (background.ts:4127)**  
Add:
```javascript
console.log('[BG_PROBE] SAVE_SESSION_TO_SQLITE payload check:', {
  agentBoxes: session.agentBoxes?.length,
  agents: session.agents?.length,
  sessionKey
})
```

### 10.3 Storage read probes

**`storageGet` for session in `openSessionsLightbox` (content-script.tsx:38351)**  
Add after filter:
```javascript
console.log('[UI_PROBE] Sessions loaded:', sessions.map(s => ({
  id: s.id, agentBoxCount: s.agentBoxes?.length ?? 0, agentCount: s.agents?.length ?? 0
})))
```

**`storageGet` in `openAgentBoxOverview` (content-script.tsx:~39900)**  
Add after read:
```javascript
console.log('[UI_PROBE] AgentBoxOverview read session.agentBoxes:', 
  session.agentBoxes?.map(b => ({
    identifier: b.identifier, title: b.title, agentId: b.agentId, 
    agentNumber: b.agentNumber, model: b.model, provider: b.provider
  })))
```

### 10.4 Schema validation probes

**`parseAgentsFromSession` (processFlow.ts:455)**  
Add per agent:
```javascript
console.log('[SCHEMA_PROBE] Agent from session:', {
  hasKey: !!agent.key, hasNumber: !!agent.number, 
  hasConfig: !!agent.config, hasInstructions: !!agent.config?.instructions,
  hasListening: !!agent.listening, name: agent.name
})
```

### 10.5 Session key tracking probes

**`setCurrentSessionKey` (content-script.tsx:2678)**  
Add:
```javascript
console.log('[KEY_PROBE] setCurrentSessionKey:', key, 'caller:', new Error().stack?.split('\n')[2])
```

**`getCurrentSessionKey` returns (content-script.tsx:2612)**  
Add:
```javascript
console.log('[KEY_PROBE] getCurrentSessionKey returning:', result ?? 'null', 
  'from:', result === sessionStorage.getItem('optimando-current-session-key') ? 'sessionStorage' : 'localStorage')
```

---

## 11. Verification Checklist

Use this to confirm the bugs and validate fixes:

- [ ] **V1: Session key consistency** — After creating a box, verify `sessionStorage['optimando-current-session-key']`, `localStorage['optimando-global-active-session']`, and `chrome.storage.local['optimando-active-session-key']` all return the same key.
- [ ] **V2: Box in SQLite** — After creating a box, open DevTools → Application → Service Worker → console, verify `SAVE_AGENT_BOX_TO_SQLITE` response shows `success: true, totalBoxes: 1`.
- [ ] **V3: Session blob integrity** — After creating a box, open Sessions History and log the full session object for the active session. Verify `agentBoxes.length >= 1`.
- [ ] **V4: No auto-created shell confusion** — In the session blob (V3), check `agents[]`. Verify no entry has `config: {}` and `name === box.title`.
- [ ] **V5: saveCurrentSession schema** — Trigger `saveCurrentSession` (lock button). Log the `sessionData.agents` payload. Verify it contains `key`, `number`, and `config.instructions` per agent.
- [ ] **V6: Race condition** — Create a box and immediately save an agent config. Log the `agentBoxes` array inside `ensureSessionInHistory`. Verify count is >= 1.
- [ ] **V7: Agent Box Overview count** — Open Agent Box Overview for the active session. Verify "Registered Boxes: N" where N equals actual configured boxes.
- [ ] **V8: Restore integrity** — Reload the page. Verify `renderAgentBoxes()` is called with a non-empty array. Verify boxes appear in the UI.
- [ ] **V9: Sessions History label** — Verify "Master Agent Boxes (1)" appears and "AI Agents (0)" appears when only a box is configured and no agent has been saved.
- [ ] **V10: Auth validation** — Confirm `OrchestratorSQLiteAdapter` sends `X-Launch-Secret` with all requests (check Network tab in DevTools for 200 responses from `:51248`).

---

## 12. Likely Root Causes (Ranked)

| Rank | Root Cause | Confidence | Impact |
|------|-----------|------------|--------|
| 1 | `SAVE_AGENT_BOX_TO_SQLITE` in background auto-creates shallow agent shells in `session.agents` using box title as agent name → Sessions History shows box names as "AI Agents" | **High** | Confusing UI; users think agents are registered |
| 2 | `saveCurrentSession` overwrites `session.agents` with incompatible `collectAgentConfigs()` payload (no `key`, `number`, `config`) → routing and trigger matching breaks | **High** | All agent routing fails after lock/first-action save |
| 3 | Box creation does NOT call `ensureSessionInHistory` → session history never reflects box creation; only SQLite background path updates the session blob | **High** | Box visible in runtime but not in history; survives reload only if SQLite save completed |
| 4 | Sessions saved before `X-Launch-Secret` fix only exist in `localStorage`; SQLite has no data; restore fails silently → "0 boxes" | **High** | All pre-fix sessions are broken (no forward migration) |
| 5 | Race condition: `ensureSessionInHistory` can fire while `SAVE_AGENT_BOX_TO_SQLITE` is still in-flight → `agentBoxes: []` overwrite in session | **Medium** | Non-deterministic; only when both ops happen within ~200ms |
| 6 | `saveCurrentSession` always allocates a new `session_{Date.now()}` key → multiple orphaned sessions; previous session with correct data is abandoned | **Medium** | Session fragmentation; history grows with duplicates |
| 7 | `openAgentBoxOverview` filter excludes boxes without `title/agentId/agentNumber/model/provider` → may incorrectly show 0 for minimal boxes | **Medium** | Unlikely with standard box creation but fragile |
| 8 | Three session key stores diverge after navigation → wrong session key used at restore → wrong session data loaded | **Low** | Sporadic; hard to reproduce consistently |
| 9 | `agent-manager-v2.ts` creates parallel sessions with different schemas → interferes with canonical session | **Low** | Depends on whether this path is actively used |

---

## 13. Minimal Fix Strategy for Next Step

Listed in priority order. **Do not implement all at once — sequence matters.**

### Fix 1 (Priority: Critical) — Stop auto-creating agent shells from box saves

**`background.ts:4271–4310`**  
Remove or gate the auto-creation of `session.agents` entries in `SAVE_AGENT_BOX_TO_SQLITE`. Agent shells should only be created when the user explicitly saves an agent configuration via the sidepanel form. The auto-creation conflates boxes with agents and pollutes `session.agents`.

If pre-allocation is needed for routing, the shell should be created with `name = "Agent {N}"` (not box title) and must not appear in Sessions History "AI Agents" unless `enabled: true`.

### Fix 2 (Priority: Critical) — Replace `collectAgentConfigs()` in `saveCurrentSession`

**`content-script.tsx:41326`**  
`saveCurrentSession` must not call `collectAgentConfigs()`. Instead it must read `session.agents` from the current session (via `storageGet([sessionKey])`) and use that, preserving the canonical shape. If no session agents exist yet, default to `[]`.

### Fix 3 (Priority: High) — Call `ensureSessionInHistory` after box creation

**`content-script.tsx:6534–6603`**  
After `SAVE_AGENT_BOX_TO_SQLITE` callback returns success, call `ensureSessionInHistory` (or at minimum call `storageGet([sessionKey])` → merge box → `storageSet`) so the session history record is updated. This must be done inside the response callback to avoid the race condition.

### Fix 4 (Priority: High) — Sequence saves to prevent race condition

**`content-script.tsx` agent save path**  
When `ensureSessionInHistory` fires during agent config save, it must first load the latest session (including any recently saved agentBoxes) before writing. Consider adding `currentTabData.agentBoxes` as authoritative source for the merge if session.agentBoxes is empty.

### Fix 5 (Priority: Medium) — Fix `saveCurrentSession` key allocation

**`content-script.tsx:41330`**  
`saveCurrentSession` must check if a session key already exists (`getCurrentSessionKey()`) and update that key rather than always creating a new one. New key should only be allocated if no key exists.

### Fix 6 (Priority: Medium) — Add migration for pre-auth-fix sessions

Sessions saved to Chrome storage (before the `X-Launch-Secret` fix) need a one-time migration to SQLite on next app start. The migration should scan `chrome.storage.local` for `session_*` keys and push them to SQLite via `SAVE_SESSION_TO_SQLITE`.

### Fix 7 (Priority: Low) — Fix "Agents" button label

**`content-script.tsx:38459`**  
Rename button text from `"Agents"` to `"Boxes"` or `"Agent Boxes"` to accurately describe what it opens.

### Fix 8 (Priority: Low) — Initialize `displayGrids` as `[]` not `null`

**`content-script.tsx:2603`**  
Change `displayGrids: null as any` to `displayGrids: [] as any[]` to prevent null spread into session saves.

---

## 14. Open Questions / Missing Evidence

| # | Question | How to Confirm |
|---|----------|---------------|
| Q1 | Does the Electron app respond correctly to `orchestrator/get` and `orchestrator/set` after the auth fix? Are there any remaining 401s? | Check DevTools Network tab in extension service worker for `:51248` calls |
| Q2 | Is `agent-manager-v2.ts` actively used in production flows or is it dead code? | Grep for calls to `ensureActiveSession` in agent-manager-v2; check if the module runs |
| Q3 | What is the exact moment `saveCurrentSession` is triggered? Is it only on lock button, or does it fire on other events? | Grep for `saveCurrentSession()` calls in content-script.tsx |
| Q4 | When the "beap" agent shell was observed in Sessions History, was a box named "beap" also configured? | Confirm by inspecting session.agentBoxes for matching title |
| Q5 | Does `localStorage['optimando-tab-{tabId}']` survive page reloads and is it read during restore? | Check if restore path at `content-script.tsx:5078–5124` also reads localStorage as fallback |
| Q6 | Is `GET_SESSION_FROM_SQLITE` returning the correct session after the auth fix, or does it still fall back to Chrome storage? | Add probe log at `background.ts:4100` to confirm SQLite response vs Chrome fallback |
| Q7 | Is there a code path that calls `displayGrids = null` explicitly (resetting it)? | Grep for `displayGrids = null` and `displayGrids: null` in content-script.tsx |
| Q8 | How does the `storageWrapper` `storageGet(null)` merge behave when both Chrome and SQLite have different versions of the same `session_*` key? | Read `storageWrapper.ts:139–155` — adapter wins when both exist |
| Q9 | Is `SAVE_SESSION_TO_SQLITE` (called from `ensureSessionInHistory`) actually successfully writing after the auth fix? | Check if `OrchestratorSQLiteAdapter` auth header is present and trace background.ts:4127 response |
| Q10 | After `saveCurrentSession` creates a new session key, is the old session key cleaned up or do orphaned sessions accumulate indefinitely? | Inspect if any cleanup logic follows `setCurrentSessionKey` in `saveCurrentSession` |

---

## Most Likely First Debug Entry Points

| Category | File | Function / Line | Why |
|----------|------|----------------|-----|
| **Agent shell pollution** | `background.ts` | `SAVE_AGENT_BOX_TO_SQLITE` handler ~4271 | Auto-creates agents from box data; root cause of "AI Agents" showing box names |
| **Agents schema overwrite** | `content-script.tsx` | `saveCurrentSession` ~41326 | Overwrites `session.agents` with incompatible localStorage payload |
| **Box not in history** | `content-script.tsx` | Box creation flow ~6534 | `ensureSessionInHistory` never called; box only in localStorage + async SQLite |
| **Race condition** | `content-script.tsx` | `ensureSessionInHistory` ~3040 | Reads stale session before box SQLite write completes |
| **Zero boxes filter** | `content-script.tsx` | `openAgentBoxOverview` ~39963 | Inclusion filter; log what `session.agentBoxes` contains at this point |
| **Key divergence** | `content-script.tsx` | `getCurrentSessionKey` ~2612 | Three stores; which one wins and why |
| **Pre-fix sessions** | `background.ts` | `GET_SESSION_FROM_SQLITE` ~4113 | Chrome fallback may not have session data either; both paths return null |
| **Session history source** | `content-script.tsx` | `openSessionsLightbox` ~38351 | `storageGet(null)` — confirm merged result contains `agentBoxes` |
