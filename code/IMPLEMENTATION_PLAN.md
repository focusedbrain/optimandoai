# AI Agent Session/Account Storage - Implementation Plan

## ✅ Analysis Complete

### Problem Confirmed:
- AI agent configurations are stored in **global localStorage**
- Sessions don't include agent configs, so restoring a session doesn't restore agent setups
- All sessions share the same agent configurations (not isolated)

### Solution Validated:
- Add `agents` array to session data structure ✅
- Add `accountAgents` to global chrome.storage.local ✅
- Session restore spreads all properties: `currentTabData = {...currentTabData, ...sessionData}` ✅
- Chrome.storage.local supports nested objects and has 10MB limit (plenty) ✅

---

## Implementation Steps

### Step 1: Add Helper Functions for Storage Management
**File**: `apps/extension-chromium/src/content-script.tsx`
**Location**: After `deleteAgentFromSession()` function (around line 671)

```typescript
// Helper: Get account-level agents from global storage
function getAccountAgents(callback: (agents: any[]) => void) {
  chrome.storage.local.get(['accountAgents'], (result) => {
    callback(result.accountAgents || [])
  })
}

// Helper: Save account-level agents to global storage
function saveAccountAgents(agents: any[], callback: () => void) {
  chrome.storage.local.set({ accountAgents: agents }, callback)
}

// Helper: Get all agents for current session (system + account + session)
function getAllAgentsForSession(session: any, callback: (agents: any[]) => void) {
  getAccountAgents((accountAgents) => {
    const BUILTIN_AGENTS = [
      { key: 'summarize', name: 'Summarize', icon: '📝', kind: 'builtin', scope: 'system' },
      { key: 'research', name: 'Research', icon: '🔍', kind: 'builtin', scope: 'system' },
      { key: 'analyze', name: 'Analyze', icon: '📊', kind: 'builtin', scope: 'system' },
      { key: 'generate', name: 'Generate', icon: '✨', kind: 'builtin', scope: 'system' },
      { key: 'coordinate', name: 'Coordinate', icon: '🎯', kind: 'builtin', scope: 'system' }
    ]
    
    const sessionAgents = (session.agents || []).filter((a: any) => a.scope === 'session')
    const allAgents = [...BUILTIN_AGENTS, ...accountAgents, ...sessionAgents]
    callback(allAgents)
  })
}

// Helper: Save agent config based on scope
function saveAgentConfig(agentKey: string, scope: string, configData: any, callback: () => void) {
  if (scope === 'session') {
    // Save to current session
    ensureActiveSession((activeKey: string, session: any) => {
      if (!Array.isArray(session.agents)) session.agents = []
      
      let agent = session.agents.find((a: any) => a.key === agentKey)
      if (!agent) {
        agent = { key: agentKey, name: agentKey, icon: '🤖', scope: 'session', config: {} }
        session.agents.push(agent)
      }
      
      agent.config = { ...agent.config, ...configData }
      session.timestamp = new Date().toISOString()
      
      chrome.storage.local.set({ [activeKey]: session }, () => {
        console.log('✅ Saved session-scoped agent config:', agentKey)
        callback()
      })
    })
  } else if (scope === 'account') {
    // Save to account agents
    getAccountAgents((accountAgents) => {
      let agent = accountAgents.find((a: any) => a.key === agentKey)
      if (!agent) {
        agent = { key: agentKey, name: agentKey, icon: '🤖', scope: 'account', config: {} }
        accountAgents.push(agent)
      }
      
      agent.config = { ...agent.config, ...configData }
      
      saveAccountAgents(accountAgents, () => {
        console.log('✅ Saved account-scoped agent config:', agentKey)
        callback()
      })
    })
  }
}

// Helper: Load agent config based on scope
function loadAgentConfig(agentKey: string, scope: string, callback: (config: any) => void) {
  if (scope === 'session') {
    ensureActiveSession((activeKey: string, session: any) => {
      const agent = (session.agents || []).find((a: any) => a.key === agentKey)
      callback(agent?.config || {})
    })
  } else if (scope === 'account') {
    getAccountAgents((accountAgents) => {
      const agent = accountAgents.find((a: any) => a.key === agentKey)
      callback(agent?.config || {})
    })
  } else {
    // System agents - return empty config for now
    callback({})
  }
}

// Helper: Toggle agent scope between session and account
function toggleAgentScope(agentKey: string, fromScope: string, toScope: string, callback: () => void) {
  if (fromScope === 'session' && toScope === 'account') {
    // Move from session to account
    ensureActiveSession((activeKey: string, session: any) => {
      const agent = (session.agents || []).find((a: any) => a.key === agentKey)
      if (!agent) return callback()
      
      // Remove from session
      session.agents = session.agents.filter((a: any) => a.key !== agentKey)
      
      // Add to account
      agent.scope = 'account'
      getAccountAgents((accountAgents) => {
        accountAgents.push(agent)
        saveAccountAgents(accountAgents, () => {
          chrome.storage.local.set({ [activeKey]: session }, callback)
        })
      })
    })
  } else if (fromScope === 'account' && toScope === 'session') {
    // Move from account to session
    getAccountAgents((accountAgents) => {
      const agent = accountAgents.find((a: any) => a.key === agentKey)
      if (!agent) return callback()
      
      // Remove from account
      const updatedAccountAgents = accountAgents.filter((a: any) => a.key !== agentKey)
      
      // Add to session
      agent.scope = 'session'
      ensureActiveSession((activeKey: string, session: any) => {
        if (!Array.isArray(session.agents)) session.agents = []
        session.agents.push(agent)
        
        saveAccountAgents(updatedAccountAgents, () => {
          chrome.storage.local.set({ [activeKey]: session }, callback)
        })
      })
    })
  }
}
```

### Step 2: Update openAgentsLightbox() - Add Tabs
**Location**: Around line 2793 where overlay.innerHTML is set

**Current**:
```html
<h2>🤖 AI Agents Configuration</h2>
<button id="close-agents-lightbox">×</button>
```

**New**:
```html
<h2>🤖 AI Agents Configuration</h2>
<button id="close-agents-lightbox">×</button>
</div>

<!-- TABS -->
<div style="padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; gap: 10px;">
  <button class="agent-filter-tab active" data-filter="all" style="...">All Agents</button>
  <button class="agent-filter-tab" data-filter="account" style="...">Account</button>
  <button class="agent-filter-tab" data-filter="system" style="...">System</button>
</div>
```

Add tab click handlers after `document.body.appendChild(overlay)`:
```typescript
let currentFilter = 'all'
overlay.querySelectorAll('.agent-filter-tab').forEach((tab: any) => {
  tab.addEventListener('click', () => {
    currentFilter = tab.getAttribute('data-filter')
    overlay.querySelectorAll('.agent-filter-tab').forEach((t: any) => {
      t.classList.toggle('active', t === tab)
      t.style.background = t === tab ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'
      t.style.color = t === tab ? 'white' : 'rgba(255,255,255,0.7)'
    })
    renderAgentsGrid(overlay, currentFilter)
  })
})
```

### Step 3: Update renderAgentsGrid() - Add Scope Toggle & Filtering
**Location**: Around line 672

**Update function signature**:
```typescript
function renderAgentsGrid(overlay:HTMLElement, filter: string = 'all'){
```

**Replace agent card HTML**:
```html
<div style="font-size: 32px; margin-bottom: 8px;">${a.icon || '🤖'}</div>
<h4 style="margin: 0 0 8px 0; font-size: 12px;">Agent ${num} — ${a.name || 'Agent'}</h4>
<button class="agent-toggle" style="...">OFF</button>

<!-- Scope Toggle (only if not system agent) -->
${a.scope !== 'system' ? `
  <div class="scope-toggle-container" style="margin: 8px 0; display: flex; border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.3);">
    <button class="scope-toggle-btn ${a.scope === 'session' ? 'active' : ''}" data-scope="session" data-agent="${a.key}" style="flex: 1; padding: 4px 8px; background: ${a.scope === 'session' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}; border: none; color: white; cursor: pointer; font-size: 9px;">
      📍 Session
    </button>
    <button class="scope-toggle-btn ${a.scope === 'account' ? 'active' : ''}" data-scope="account" data-agent="${a.key}" style="flex: 1; padding: 4px 8px; background: ${a.scope === 'account' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}; border: none; color: white; cursor: pointer; font-size: 9px;">
      🌐 Account
    </button>
  </div>
` : '<div style="height: 24px; margin: 8px 0; text-align: center; font-size: 9px; color: rgba(255,255,255,0.5);">🔒 System</div>'}

${a.scope !== 'system' ? `<button class="delete-agent" data-key="${a.key}">×</button>` : ''}
```

**Add scope toggle handler after card is appended**:
```typescript
card.querySelectorAll('.scope-toggle-btn').forEach((btn: any) => {
  btn.addEventListener('click', (e: any) => {
    e.stopPropagation()
    const newScope = btn.getAttribute('data-scope')
    const agentKey = btn.getAttribute('data-agent')
    const currentScope = a.scope
    
    if (newScope !== currentScope) {
      toggleAgentScope(agentKey, currentScope, newScope, () => {
        renderAgentsGrid(overlay, filter)
      })
    }
  })
})
```

**Add filtering logic**:
```typescript
getAllAgentsForSession(s, (allAgents) => {
  let agents = allAgents
  
  // Apply filter
  if (filter === 'account') {
    agents = agents.filter(a => a.scope === 'account')
  } else if (filter === 'system') {
    agents = agents.filter(a => a.scope === 'system')
  }
  // 'all' shows everything
  
  agents.sort((a:any,b:any)=> (a.number||0)-(b.number||0))
  
  agents.forEach((a:any) => {
    // ... render agent card
  })
})
```

### Step 4: Update openAgentConfigDialog() - Use Scope-Aware Storage
**Location**: Around line 3972

**Replace localStorage save calls**:
```typescript
// BEFORE:
localStorage.setItem('agent_model_v2_'+agentName, dataToSave)

// AFTER:
saveAgentConfig(agentName, agentScope, { instructions: JSON.parse(dataToSave) }, () => {
  // Show notification
  notification.innerHTML = `💾 ${agentName} saved to ${agentScope} scope!`
  // ... rest of notification code
  configOverlay.remove()
})
```

**Add agentScope parameter**:
```typescript
function openAgentConfigDialog(agentName, type, parentOverlay, agentScope = 'session') {
  // ... existing code
}
```

**Pass scope when opening dialog from renderAgentsGrid**:
```typescript
openAgentConfigDialog(agentKey, t, overlay, a.scope || 'session')
```

### Step 5: Add AI Agents Section to Session History
**Location**: Around line 8565 in generateSessionsHTML()

**Add after displayGrids section**:
```html
${session.agents && session.agents.length > 0 ? `
  <div style="background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 12px; margin: 10px 0;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-size: 12px; font-weight: bold; color: #FFD700;">🤖 AI Agents (${session.agents.length + (accountAgentCount || 0)})</span>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
      ${session.agents.map((agent: any) => `
        <span style="background: rgba(255,215,0,0.25); color: white; border: 1px solid rgba(255,215,0,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;" title="${agent.name} (Session-scoped)">
          ${agent.icon} ${agent.name}
        </span>
      `).join('')}
    </div>
  </div>
` : ''}
```

**Note**: Account agents count needs to be fetched separately and added to display

### Step 6: Ensure Session Save Includes Agents
**Location**: Multiple places where `chrome.storage.local.set({ [sessionKey]: sessionData })` is called

**Verify `agents` property is included** (it will be automatically if it's in `currentTabData`):
- Around line 805: Fresh session creation
- Around line 7038: Helper tabs session
- Around line 8108: Grid config save
- Etc.

These should all work automatically because they save the full `sessionData` or `currentTabData` object.

### Step 7: Initialize agents Array for Existing Sessions
**Location**: In `normalizeSessionAgents()` around line 522

**Add**:
```typescript
if (!Array.isArray(session.agents)) {
  session.agents = []
}
```

---

## Testing Checklist

### Test 1: Session-Scoped Agent
- [ ] Create new agent in Session A (should default to Session scope)
- [ ] Configure the agent (instructions, memory, settings)
- [ ] Save session
- [ ] Create new Session B
- [ ] Verify agent does NOT appear in Session B
- [ ] Go to Session History, click Session A
- [ ] Verify agent appears with correct configuration

### Test 2: Account-Scoped Agent
- [ ] Create or edit an agent
- [ ] Toggle scope to "Account"
- [ ] Verify agent still appears
- [ ] Create new Session B
- [ ] Verify agent appears in Session B
- [ ] Verify configuration is the same in both sessions

### Test 3: Scope Toggle
- [ ] Create session-scoped agent in Session A
- [ ] Toggle to Account scope
- [ ] Verify agent now appears in all sessions
- [ ] Toggle back to Session scope
- [ ] Verify agent only appears in Session A

### Test 4: Session History Display
- [ ] Open Session History
- [ ] Verify "🤖 AI Agents" section appears for sessions with agents
- [ ] Verify count is correct
- [ ] Verify agent names and icons are shown

### Test 5: Tabs Filtering
- [ ] Open AI Agents Configuration
- [ ] Click "All Agents" - verify all agents shown
- [ ] Click "Account" - verify only account-scoped agents
- [ ] Click "System" - verify only 5 builtin agents
- [ ] Create new account agent - verify it appears in Account tab

### Test 6: System Agents
- [ ] Verify 5 system agents always appear
- [ ] Verify they don't have scope toggle (show "🔒 System")
- [ ] Verify they can't be deleted
- [ ] Verify their configs can be saved

---

## Backward Compatibility

**Old sessions without `agents` property:**
- Will have `agents === undefined`
- `normalizeSessionAgents()` will initialize empty array
- Old global localStorage agent configs will remain (cleanup can be done later)
- Users can gradually migrate agents to session/account scope

---

## Ready to Implement?

This plan:
- ✅ Solves the problem of global agent configs
- ✅ Adds session isolation
- ✅ Adds account-level agents
- ✅ Is backward compatible
- ✅ Uses existing session storage patterns
- ✅ Will work with current session restore logic

**Shall I proceed with implementation?**

