# AI Agent Session Storage Analysis

## Current System Overview

### What's Stored in Sessions
Sessions are stored in `chrome.storage.local` with keys like `session_${timestamp}`. Each session contains:
- **Basic Info**: `tabId`, `tabName`, `url`, `timestamp`, `isLocked`
- **UI Config**: `uiConfig` (sidebar widths, heights)
- **Goals**: `shortTerm`, `midTerm`, `longTerm`
- **Agent Boxes**: `agentBoxes` array (Master agent box configs)
- **Hybrid Views**: `hybridAgentBoxes` array
- **Helper Tabs**: `helperTabs.urls` array
- **Display Grids**: `displayGrids` array (with layout configs)
- **Context**: `context.userContext` and `context.publisherContext` (text + PDFs)

### Session History Display
Currently shows these sections for each session:
- 📦 Master Agent Boxes (count)
- 🧩 Hybrid Views (count + IDs)
- 🌐 Web Sources (helper tabs count)
- 🗂️ Display Grids (layouts)
- 📄 Attached Context (user/publisher/PDFs)
- **❌ MISSING**: AI Agents section

---

## The Problem (Why It's Broken)

### AI Agent Configurations Are Stored Globally
**Location**: `localStorage` (global, not session-specific)

**Keys used**:
```
localStorage.setItem('agent_model_v2_' + agentName, JSON.stringify(config))
localStorage.setItem('agent_${agentName}_context', contextText)
localStorage.setItem('agent_${agentName}_memory', memoryValue)
localStorage.setItem('agent_${agentName}_source', sourceValue)
localStorage.setItem('agent_${agentName}_persist', persistValue)
localStorage.setItem('agent_${agentName}_priority', priorityValue)
localStorage.setItem('agent_${agentName}_autostart', autostartValue)
localStorage.setItem('agent_${agentName}_autorespond', autorespondValue)
localStorage.setItem('agent_${agentName}_delay', delayValue)
```

**The Issue**:
- When you configure an AI agent, it saves to **global localStorage**
- When you restore a session, it restores `agentBoxes`, `displayGrids`, etc. BUT NOT agent configs
- All sessions share the same global AI agent configurations
- If you change an agent in Session A, it affects Session B (unintended)
- When you restore Session B, the agent configs are whatever was last saved globally

### Why This Matters
1. **Session Isolation**: Each session should have its own AI agent setup
2. **Reproducibility**: Reopening a session should restore the exact state
3. **Templates**: Users want to save session "templates" with specific AI agents
4. **Account-level Agents**: Some agents should be global (e.g., "Email Writer"), others session-specific (e.g., "Project X Researcher")

---

## The Solution

### 1. Data Structure Changes

#### Add to Session Data:
```typescript
{
  ...existing session properties...
  agents: [
    {
      key: 'research',
      name: 'Research',
      icon: '🔍',
      number: 2,
      kind: 'builtin' | 'custom',
      scope: 'session' | 'account',  // NEW!
      config: {
        instructions: { /* full instruction config */ },
        memory: { /* memory settings */ },
        settings: { /* autostart, priority, etc. */ }
      }
    }
  ]
}
```

#### Add Global Account Storage:
```typescript
// Stored in chrome.storage.local with key 'accountAgents'
{
  accountAgents: [
    {
      key: 'email-writer',
      name: 'Email Writer',
      icon: '✉️',
      scope: 'account',
      config: { /* same structure */ }
    }
  ]
}
```

### 2. Storage Logic

#### Session-Scoped Agents:
- Stored in `session.agents` array
- Only appear in that specific session
- Restored when session is loaded

#### Account-Scoped Agents:
- Stored in global `accountAgents` array in chrome.storage.local
- Appear in ALL sessions
- Persist across all sessions

#### System Agents:
- The 5 built-in agents (Summarize, Research, Analyze, Generate, Coordinate)
- Always visible
- Can't be deleted or have scope changed
- Config stored per session or account based on user choice

### 3. UI Changes

#### AI Agents Configuration Modal:
```
┌─────────────────────────────────────────────────────┐
│  🤖 AI Agents Configuration                    [×]  │
├─────────────────────────────────────────────────────┤
│  [All Agents] [Account] [System]  ← TABS            │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   🔍     │  │   📊     │  │   ✨     │          │
│  │ Agent 02 │  │ Agent 03 │  │ Agent 04 │          │
│  │ Research │  │ Analyze  │  │ Generate │          │
│  │  [OFF]   │  │  [OFF]   │  │  [OFF]   │          │
│  │[Session|Account] ← TOGGLE                        │
│  │  📋 📄 ⚙️ │  │  📋 📄 ⚙️ │  │  📋 📄 ⚙️ │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│           [➕ Add New Agent]                         │
└─────────────────────────────────────────────────────┘
```

#### Session History - New AI Agents Section:
```
📚 Sessions History
┌──────────────────────────────────────────┐
│ WR Session 04-10-2025_14-30-15          │
│ ┌──────────────────────────────────────┐ │
│ │ https://example.com                  │ │
│ │                                      │ │
│ │ 📦 Master Agent Boxes (2)            │ │
│ │ 🌐 Web Sources (3)                   │ │
│ │ 🗂️ Display Grids (1)                 │ │
│ │ 🤖 AI Agents (5) ← NEW SECTION       │ │
│ │   • Research (Session)               │ │
│ │   • Analyze (Session)                │ │
│ │   • Email Writer (Account)           │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 4. Implementation Plan

#### Phase 1: Data Structure
1. ✅ Add `agents` array to session structure
2. ✅ Add `accountAgents` to chrome.storage.local
3. ✅ Create helper functions:
   - `getSessionAgents(sessionKey)` - get agents for a session
   - `getAccountAgents()` - get global agents
   - `saveAgentConfig(agentKey, scope, config)` - save with scope awareness
   - `loadAgentConfig(agentKey, scope)` - load with scope awareness

#### Phase 2: Save Logic
1. ✅ Modify `openAgentConfigDialog` save handler to check scope
2. ✅ If scope='session': save to `currentSession.agents[agentKey].config`
3. ✅ If scope='account': save to `accountAgents[agentKey].config`
4. ✅ Remove old localStorage save calls

#### Phase 3: Load Logic
1. ✅ Modify `openAgentConfigDialog` to load based on scope
2. ✅ Check agent scope first
3. ✅ Load from correct storage location

#### Phase 4: Session Restore
1. ✅ When restoring session, merge:
   - System agents (always visible)
   - Account agents (global)
   - Session agents (from session data)
2. ✅ Ensure configs are loaded from correct scope

#### Phase 5: UI
1. ✅ Add tabs: All Agents | Account | System
2. ✅ Add scope toggle: [ Session | Account ]
3. ✅ Add AI Agents section to session history
4. ✅ Show agent count + names in session cards

#### Phase 6: Testing
1. ✅ Create session-scoped agent, verify it only appears in that session
2. ✅ Create account-scoped agent, verify it appears in all sessions
3. ✅ Restore session, verify agents and configs are correct
4. ✅ Switch agent from Session to Account scope, verify it moves
5. ✅ Delete session, verify session agents are deleted but account agents remain

---

## Why This Approach is Necessary

### 1. Session Isolation
Users work on different projects in different sessions. Each project needs different AI agents with different configurations.

**Example**: 
- Session A: "Research Project X" with agents for academic papers
- Session B: "Email Management" with agents for drafting emails

### 2. Reproducibility
When a user saved a session 2 weeks ago with specific AI agents configured a certain way, reopening that session should restore **exactly** that state.

**Without this fix**: Agent configs are global, so reopening Session A might have completely different agent settings than when it was saved.

### 3. Account-Level Agents
Some agents are useful across ALL sessions (e.g., "Grammar Checker", "Email Writer"). These should be available everywhere.

### 4. Template System
Users want to create session "templates" - pre-configured setups with specific agents. This requires storing agent configs in the session.

---

## Implementation Validation Checklist

Before implementing, verify:
- ✅ Session restore uses spread operator: `currentTabData = {...currentTabData, ...sessionData}`
- ✅ This means `session.agents` will automatically be restored
- ✅ `chrome.storage.local` supports nested objects (it does)
- ✅ Session size limits: chrome.storage.local has 10MB limit per item (plenty)
- ✅ Backward compatibility: Old sessions without `agents` property will still work

After implementing, verify:
- ⏳ Create agent in Session A, switch to Session B, verify agent not there
- ⏳ Restore Session A, verify agent and config restored correctly
- ⏳ Change agent to Account scope, verify it appears in all sessions
- ⏳ Session history shows AI Agents count correctly
- ⏳ Clicking session in history restores agents and configs


