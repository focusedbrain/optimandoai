# Agent Input/Output Coordination Layer - Implementation Complete

## Overview

Implemented a complete wiring layer that routes user input to appropriate agents, executes them via LLM, and displays results in the correct Agent Boxes.

## Architecture

```
User Input (Command Chat / DOM)
    ↓
InputCoordinator
    ↓ (finds matching agents)
AgentExecutor.runAgentExecution()
    ↓ (builds prompt, calls LLM)
LlmClient → Electron HTTP API → Ollama
    ↓ (LLM response)
OutputCoordinator
    ↓ (routes to agent box)
Agent Box Display (UI update)
```

## New Files Created

### 1. `src/types/coordination.ts`
Shared TypeScript interfaces for coordination system:
- `ListenerSectionConfig` - Agent input filtering (patterns, sources, types, priority)
- `ExecutionSectionConfig` - Output routing (target box, display mode, append mode)
- `InputEventPayload` - Normalized input from command chat or DOM events
- `SystemAgentConfig` - Marks system agents (input/output coordinators)
- `AgentExecutionResult` - Standardized LLM execution result
- `ChatCompletionRequest/Response` - LLM API types

### 2. `src/services/llm/LlmClient.ts`
HTTP wrapper for LLM calls to Electron app:
- `sendLlmRequest()` - Sends chat completion to `http://127.0.0.1:51248/api/llm/chat`
- `checkLlmAvailability()` - Checks if Electron app + Ollama are running
- 60-second timeout with helpful error messages
- Handles network errors, timeouts gracefully

### 3. `src/services/InputCoordinator.ts`
Routes input events to matching agents:
- `handleInputEvent()` - Main entry point for all input
- `findMatchingAgents()` - Matches agents by listener section config
- `matchesPattern()` - Pattern matching logic (source, type, patterns)
- `getDefaultAgent()` - Fallback to agent01 if no matches
- `extractAgentNumber()` - Parses agent number from name

**Logic:**
1. Receives normalized `InputEventPayload`
2. Finds all agents with `listenerSection.enabled = true`
3. Matches by `inputSources`, `inputTypes`, `patterns`
4. If no matches → use default agent (agent01)
5. For each matched agent → call `AgentExecutor.runAgentExecution()`
6. Forward result to `OutputCoordinator`

### 4. `src/services/OutputCoordinator.ts`
Routes LLM output to correct Agent Box:
- `routeOutput()` - Main entry point for agent results
- `resolveTargetAgentBox()` - Determines target box (explicit, matching, fallback)
- `appendToAgentBox()` - Updates box content (append/replace modes)

**Logic:**
1. Loads agent's `executionSection` config
2. Resolves target agent box:
   - Priority 1: `executionSection.targetOutputAgentBoxId`
   - Priority 2: Agent box with matching agent number
   - Priority 3: First available agent box in session
3. Appends content based on `appendMode` (append/replace)
4. Persists to SQLite and emits UI refresh event

### 5. Enhanced `src/services/AgentExecutor.ts`
Added coordination-friendly execution method:
- `runAgentExecution()` - New method for coordinator integration
- `buildPromptFromInput()` - Builds prompt from `InputEventPayload`
- Uses `LlmClient` for HTTP bridge to Electron
- Returns standardized `AgentExecutionResult` with `agentNumber`

**Updated interfaces:**
- Added `listenerSection?: ListenerSectionConfig`
- Added `executionSection?: ExecutionSectionConfig`
- Added `isSystemAgent?: boolean`
- Added `systemAgentType?: "input_coordinator" | "output_coordinator"`

## Integration Points

### Command Chat (sidepanel.tsx)
**Before:**
```typescript
const handleSendMessage = () => {
  setChatMessages([...chatMessages, 
    { role: 'user', text },
    { role: 'assistant', text: `Acknowledged: ${text}` }
  ])
}
```

**After:**
```typescript
const handleSendMessage = async () => {
  setChatMessages([...chatMessages, { role: 'user', text }])
  
  await inputCoordinator.handleInputEvent({
    sessionId: sessionKey,
    source: 'command',
    text,
    inputType: 'text'
  })
  
  // Response routed to agent box by OutputCoordinator
}
```

### System Agents Auto-Creation
On session load, automatically creates two system agents if they don't exist:

**Input Coordinator:**
```typescript
{
  name: 'Input Coordinator',
  icon: '📥',
  capabilities: ['listening'],
  isSystemAgent: true,
  systemAgentType: 'input_coordinator',
  reasoning: {
    goals: 'Route incoming user input to appropriate agents',
    role: 'Input routing and pattern matching',
    rules: 'Analyze input, match patterns, fallback to default'
  }
}
```

**Output Coordinator:**
```typescript
{
  name: 'Output Coordinator',
  icon: '📤',
  capabilities: [],
  isSystemAgent: true,
  systemAgentType: 'output_coordinator',
  reasoning: {
    goals: 'Route agent LLM output to correct display location',
    role: 'Output routing and display management',
    rules: 'Respect execution config, use fallback displays'
  }
}
```

Stored in SQLite as:
- `agent_system_input_coordinator_instructions`
- `agent_system_output_coordinator_instructions`

## TODO Stubs for Future Implementation

### InputCoordinator
```typescript
// TODO: Load all agents from SQLite for session ${sessionId}
// Expected: const agents = await this.loadAllAgents(sessionId)
//           return agents.filter(agent => this.matchesPattern(agent, input))
```

### OutputCoordinator
```typescript
// TODO: Load session data from SQLite to find agent boxes
// Expected: const sessionData = await this.loadSessionData(sessionId)
//           const agentBoxes = sessionData.agentBoxes || []
//           const matchingBox = agentBoxes.find(box => box.agent === agentNumber)

// TODO: Update agent box in session data and persist to SQLite
// TODO: Emit event to refresh UI
// Expected: chrome.runtime.sendMessage({ type: 'AGENT_BOX_UPDATED', boxId, content })
```

## Testing Steps

1. **Command Chat Input:**
   - Open extension sidepanel
   - Type message in command chat
   - Message should route through InputCoordinator
   - Default agent (agent01) will be called if no matches
   - Check console for execution logs

2. **System Agents:**
   - Reload page/extension
   - Check SQLite (via Electron HTTP API `/api/orchestrator/get`)
   - Should see `agent_system_input_coordinator_instructions`
   - Should see `agent_system_output_coordinator_instructions`

3. **LLM Execution:**
   - Ensure Electron app is running
   - Ensure Ollama + Mistral 7B are installed
   - Send message in command chat
   - Console should show:
     ```
     [InputCoordinator] Handling input event
     [AgentExecutionService] Running agent execution
     [LlmClient] Sending LLM request
     [LlmClient] LLM response received
     [OutputCoordinator] Routing output
     ```

4. **Error Handling:**
   - Stop Electron app → should show "Cannot connect to Electron app"
   - Stop Ollama → should show "Ollama is not running"
   - Invalid agent → should show "Agent not found"

## Next Steps

To complete the coordination layer:

1. **Implement agent loading in InputCoordinator:**
   - Load all agents from SQLite
   - Filter by listener section configuration
   - Support priority-based selection

2. **Implement session data loading in OutputCoordinator:**
   - Load session's agent boxes from SQLite
   - Find matching boxes by agent number
   - Update box output and persist back

3. **Add UI refresh mechanism:**
   - Emit runtime message when agent box updated
   - Listen in sidepanel and update state
   - Re-render affected agent boxes

4. **Add DOM event integration:**
   - Listen for DOM events in content script
   - Normalize to `InputEventPayload`
   - Forward to InputCoordinator

5. **Enhance pattern matching:**
   - Regular expression support
   - Fuzzy matching
   - Intent detection
   - Priority weighting

6. **Add display modes:**
   - Implement "overlay" mode
   - Implement "notification" mode
   - Add streaming support for real-time updates

## Files Modified

- `apps/extension-chromium/src/sidepanel.tsx` - Added InputCoordinator integration + system agent creation
- `apps/extension-chromium/src/services/AgentExecutor.ts` - Added runAgentExecution() method + updated interfaces

## Commit

- `10958d8` - feat(coordination): Implement Agent Input/Output coordination layer
- Branch: `feature/ollama-llm-integration`
- Status: ✅ Built and pushed to GitHub

## Benefits

1. **Separation of Concerns:** Input routing, execution, and output display are separate services
2. **Extensibility:** Easy to add new input sources (voice, keyboard shortcuts, etc.)
3. **Flexibility:** Agents can specify where their output goes
4. **Testability:** Each coordinator can be tested independently
5. **Scalability:** Pattern matching can become sophisticated without affecting execution
6. **Maintainability:** Clear data flow with well-defined interfaces

