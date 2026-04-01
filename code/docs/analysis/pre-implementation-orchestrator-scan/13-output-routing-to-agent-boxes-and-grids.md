# 13 — Output Routing to Agent Boxes and Grids

**Status:** Analysis-only.  
**Date:** 2026-04-01  
**Evidence basis:** `processFlow.ts` `updateAgentBoxOutput`, `sidepanel.tsx` `UPDATE_AGENT_BOX_OUTPUT` handler, `grid-display.js`, `grid-script.js`, `grid-script-v2.js`, `background.ts`.

---

## How Output Is Written to Boxes

### Write path: `updateAgentBoxOutput` (processFlow.ts lines 1137–1195)

Called from the execution loop in `sidepanel.tsx` at ~line 3087–3095, guarded by `if (match.agentBoxId)`.

```javascript
// processFlow.ts ~1137
export async function updateAgentBoxOutput(
  agentBoxId: string,
  output: string,
  sessionKey: string,
  reasoningContext?: string
): Promise<boolean>
```

**Exact sequence:**
1. Get current session key via `getCurrentSessionKeyAsync()` — fails silently if missing
2. Read `chrome.storage.local` for that session key
3. If no session or no `agentBoxes` → return `false`
4. `session.agentBoxes.findIndex(b => b.id === agentBoxId)` — if `-1` → return `false`
5. Format output: if `reasoningContext` is set, prepend `📋 **Reasoning Context:**\n{reasoningContext}\n\n---\n\n**Response:**\n{output}`
6. Set `session.agentBoxes[boxIndex].output = formattedOutput`
7. Set `session.agentBoxes[boxIndex].lastUpdated = new Date().toISOString()`
8. `chrome.storage.local.set({ [sessionKey]: session }, callback)`
9. `chrome.runtime.sendMessage({ type: 'UPDATE_AGENT_BOX_OUTPUT', data: { agentBoxId, output: formattedOutput, allBoxes: session.agentBoxes } })`

**What is persisted:** `output` (plain string or formatted string with reasoning prefix) and `lastUpdated` (ISO timestamp). No structured output, no history array, no stream chunks.

**What is NOT persisted:** The LLM call metadata (model used, token count, latency). The full reasoning context is prepended to the output string only if `reasoningContext` was passed — it becomes part of the text blob, not a separate field.

---

## How Output Gets Associated with the Right Box

The association mechanism is `match.agentBoxId` — the box's `id` UUID field, carried on `AgentMatch` from routing.

Box ID is found by `findAgentBoxesForAgent` during routing:
1. Checks `execution.specialDestinations` for explicit `agentBox` destination with agent identifier
2. Parses `listening.reportTo[]` strings → finds box by box number
3. Falls back to `agentBoxes.find(b => b.agentNumber === agent.number)`

The first matching box's `id` becomes `match.agentBoxId`. This ID is then used by `updateAgentBoxOutput` to find and update the box in the stored session.

**If no box is found:** `match.agentBoxId` is `undefined`. The guard at ~3087 in sidepanel.tsx:
```javascript
if (match.agentBoxId) {
  await updateAgentBoxOutput(match.agentBoxId, result.output, ...)
}
```
Silently skips the output write. The LLM result is computed but not written anywhere.

---

## Sidepanel Behavior: Live Update

The `UPDATE_AGENT_BOX_OUTPUT` message is sent by `processFlow.ts` after the chrome.storage write. The sidepanel has a `chrome.runtime.onMessage` listener at line 1576:

```javascript
// sidepanel.tsx lines 1576–1588
if (message.type === 'UPDATE_AGENT_BOX_OUTPUT') {
  if (message.data.allBoxes) {
    setAgentBoxes(message.data.allBoxes)
  } else if (message.data.agentBoxId && message.data.output) {
    setAgentBoxes(prev => prev.map(box =>
      box.id === message.data.agentBoxId
        ? { ...box, output: message.data.output }
        : box
    ))
  }
}
```

This updates **React state** (`setAgentBoxes`). The sidepanel re-renders from state — the DOM update is driven by React, not by direct DOM manipulation.

The `allBoxes` path (preferred) replaces the entire `agentBoxes` state with the full session array from storage. The single-box path patches just the affected box.

**Result:** Sidepanel Agent Box output updates are live and immediate upon LLM response — no page reload required.

---

## Display Grid Behavior: Not Live

**`UPDATE_AGENT_BOX_OUTPUT` has no handler in grid scripts.**

Confirmed: no occurrences of `UPDATE_AGENT_BOX_OUTPUT` in `grid-script.js`, `grid-script-v2.js`, or `grid-display.js`.

**How grid pages get box output on load:**
`grid-display.js` loads session once on page load:
```javascript
chrome.runtime.sendMessage({ type: 'GET_SESSION_FROM_SQLITE', sessionKey })
// then maps session.agentBoxes into slots by locationId
```

`chrome.storage.onChanged` in `grid-display.js` only reacts to `optimando-ui-theme` — not to session changes or box output updates.

**Implication:** Grid pages display the box output that was in the session when the page was loaded. If an agent runs and writes to a box, the grid page does not update — the user must reload the grid page to see new output.

---

## Persistence of Output

| Store | What is written | When |
|---|---|---|
| `chrome.storage.local` (session blob) | `box.output`, `box.lastUpdated` | Immediately after LLM response, inside `updateAgentBoxOutput` |
| SQLite | Not written by `updateAgentBoxOutput` | — |

Output is persisted to chrome.storage only. It is not synced to SQLite as part of the box output write path. If the session blob is later saved via `SAVE_SESSION_TO_SQLITE` (e.g. agent form save), the box output would be included in that full session write, but this is incidental.

**Output is ephemeral across sessions.** The `output` field on a box in chrome.storage is a plain string, overwritten on each run. There is no output history, versioning, or stream.

---

## What Happens on Failure

### LLM call failure
`processWithAgent` returns `{ success: false, error: '...' }`. The calling loop in sidepanel.tsx (~3108–3113) logs the error. `updateAgentBoxOutput` is not called. The box retains its previous output (or empty if first run).

### Box not found in session
`updateAgentBoxOutput` returns `false`. Logged. No user-visible indication.

### Chrome.storage write failure
The callback inside `updateAgentBoxOutput` resolves `true` even on error (the callback checks for `chrome.runtime.lastError` only in a comment-style pattern — the actual `resolve(true)` is unconditional after the `set` call at line 1174). This means storage write failures are silent.

### Network failure (Electron not running)
`fetch` to `/api/llm/chat` throws. `processWithAgent` catches and returns `{ success: false, error: error.message }`. Box output is not updated.

---

## What Happens with Multiple Matched Agents

`handleSendMessage` loops over all matched agents:

```javascript
// sidepanel.tsx ~3058–3083
for (const match of routingDecision.matchedAgents) {
  const result = await processWithAgent(match, inputText, ocrText, processedMessages, fallbackModel, baseUrl)
  if (result.success && result.output) {
    if (match.agentBoxId) {
      await updateAgentBoxOutput(match.agentBoxId, result.output, ...)
    }
  }
}
```

Multiple agents run **sequentially** (not in parallel — `await` inside `for...of`). Each writes to its own box independently. The session is read and written separately for each agent — no batching.

**Race condition:** Because each `updateAgentBoxOutput` call reads the session from chrome.storage, modifies one box, and writes back the full session — sequential calls are safe from a data perspective. However, if a second agent run starts while the first is writing, they could race.

---

## What Happens If Multiple Boxes Point to the Same Agent

If `loadAgentBoxesFromSession` returns multiple boxes for an agent (multiple boxes with `agentNumber === agent.number`), `findAgentBoxesForAgent` returns them all. Only the **first** box is used for `AgentMatch.agentBoxId`. Other boxes for the same agent are ignored.

There is no mechanism to fan out one agent's output to multiple boxes simultaneously.

---

## Are Sidepanel Boxes and Display-Grid Boxes Truly the Same Runtime Target?

**Short answer: No — not at runtime. They are the same schema type but different runtime targets.**

### What makes them the same (schema level)

- Both use `CanonicalAgentBoxConfig`
- Both have `identifier`, `agentNumber`, `provider`, `model`, `outputId`
- Both are stored in `session.agentBoxes[]`
- Both should be written by `updateAgentBoxOutput` via `agentBoxId` lookup

### What makes them different (runtime level)

| Dimension | Sidepanel boxes | Display-grid boxes |
|---|---|---|
| **Written by** | Content-script dialogs → `ensureSessionInHistory` → chrome.storage (adapter: SQLite) | Grid script editors → `SAVE_AGENT_BOX_TO_SQLITE` → SQLite |
| **Read for routing** | `loadAgentBoxesFromSession` → chrome.storage.local | NOT read by routing engine |
| **Receive `UPDATE_AGENT_BOX_OUTPUT`** | Yes — sidepanel `onMessage` → `setAgentBoxes` → React re-render | No — no handler in grid scripts |
| **Live output update** | Yes — React state update on message | No — must reload page |
| **Output persistence path** | `updateAgentBoxOutput` writes to chrome.storage | `updateAgentBoxOutput` writes to chrome.storage (if box is found) |
| **Can be found by routing** | Yes (if box was created via content-script) | No (box not in chrome.storage → not found → output write skipped) |

**The result:** A display-grid box configured from a grid editor will not be found by `loadAgentBoxesFromSession` (which reads chrome.storage only), will not be matched by `findAgentBoxesForAgent`, and therefore will never receive output from an agent run initiated in the sidepanel's WR Chat.

Even if a display-grid box were somehow found and written to by `updateAgentBoxOutput`, the grid page would not display the update live — it would only be visible after a page reload.

### Path to true equivalence

To make sidepanel and display-grid boxes truly equivalent runtime targets:
1. `loadAgentBoxesFromSession` must read from SQLite (same path as `loadAgentsFromSession`)
2. Grid scripts must write boxes to chrome.storage (or adapter must mirror SQLite writes to chrome.storage)
3. Grid pages must listen for `UPDATE_AGENT_BOX_OUTPUT` and update the relevant slot DOM element

Until all three are in place, the two box surfaces are conceptually unified but operationally isolated.
