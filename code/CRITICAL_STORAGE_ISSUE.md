# CRITICAL: Data Loss After SQLite Migration

## Problem Report

### Symptoms
When reopening a session from session history:

1. **Agent boxes disappear from UI**
   - Still registered in session (visible in System tab → Output Coordinator)
   - Not rendered in the sidebar of the master tab
   - UI state not synchronized with storage state

2. **Agents get toggled OFF automatically**
   - All agents show as disabled even if they were enabled
   - `enabled` flag is lost/reset

3. **Agent configuration data is LOST**
   - All stored information in agents disappears
   - Instructions, reasoning, execution settings all gone
   - Only basic agent structure (name, key) remains

### Root Cause
**Storage migration from `chrome.storage.local` to SQLite** introduced data persistence issues.

## Technical Analysis

### Current Storage Flow

#### Session Save (`ensureActiveSession`)
```typescript
// Line 2478-2673 in content-script.tsx
function ensureActiveSession(cb: any) {
  // Checks for existing session key
  // Loads session from storage
  // Creates new session if none exists
}
```

#### Agent Transform on Load
```typescript
// Line 2519-2637
// CRITICAL: Transform agents from orchestrator format to internal format on load
if (session.agents && Array.isArray(session.agents)) {
  session.agents = session.agents.map((a: any) => {
    if (a.key) return a; // Already in internal format
    
    // Transform from orchestrator format
    const sanitizedKey = a.name ? a.name.toLowerCase().replace(/[^a-z0-9]/g, '') : `agent${a.number || 1}`;
    
    return {
      ...a,
      key: sanitizedKey,
      // ... transformation logic
    };
  });
}
```

### Suspected Issues

1. **SQLite Read/Write Desync**
   - Data written to SQLite successfully
   - Data not read back correctly when loading session
   - Possible async timing issues

2. **Agent Format Transformation Loss**
   - Transformation from orchestrator → internal format works
   - Reverse transformation might be losing data
   - `enabled` flag not persisted correctly

3. **Agent Box UI Rendering**
   - Agent boxes stored in `session.agentBoxes`
   - UI components not re-rendering after session load
   - Sidebar components not receiving updated data

4. **Config Storage**
   ```typescript
   // Line 3642-3648
   agent.config[configType] = configData
   // 🔥 CRITICAL: Enable agent when user saves configuration
   agent.enabled = true
   ```
   - Config saved to `agent.config.instructions` as JSON string
   - May not be persisted to SQLite correctly
   - Loading might fail to parse/restore this data

## Data Flow Paths to Check

### 1. Agent Config Save
```
User saves config → saveAgentConfig() → agent.config[type] = data → session update → SQLite write
```

### 2. Session Load from History
```
User clicks session → Load from SQLite → Transform agents → Update UI → Render agent boxes
```

### 3. Agent Box Persistence
```
Create agent box → currentTabData.agentBoxes → session.agentBoxes → SQLite write
↓
Load session → session.agentBoxes → Render in sidebar
```

## Files to Investigate

1. **`apps/extension-chromium/src/content-script.tsx`**
   - `ensureActiveSession` (line 2478)
   - `normalizeSessionAgents` 
   - `saveAgentConfig` (line 3615)
   - `loadAgentConfig` (line 3778)
   - Agent box rendering functions

2. **`apps/extension-chromium/src/background.ts`**
   - SQLite adapter integration
   - Storage wrapper functions
   - Message handlers for SAVE/LOAD operations

3. **Storage Adapters**
   - Check SQLite read/write implementations
   - Verify serialization/deserialization
   - Check for data type mismatches (JSON string vs object)

## Immediate Actions Needed

### 1. Add Debug Logging
```typescript
// In ensureActiveSession when loading from storage
console.log('🔍 LOADED SESSION FROM STORAGE:', {
  key: existingKey,
  agentsCount: session.agents?.length,
  agentBoxesCount: session.agentBoxes?.length,
  agents: session.agents?.map(a => ({
    key: a.key,
    enabled: a.enabled,
    hasConfig: !!a.config,
    configKeys: a.config ? Object.keys(a.config) : []
  }))
});
```

### 2. Verify SQLite Writes
```typescript
// After saving to storage
storageSet({ [activeKey]: session }, () => {
  // Immediately read back to verify
  storageGet([activeKey], (result) => {
    console.log('🔍 VERIFY WRITE:', {
      written: session,
      readBack: result[activeKey],
      match: JSON.stringify(session) === JSON.stringify(result[activeKey])
    });
  });
});
```

### 3. Check Agent Box Rendering
- Verify `currentTabData.agentBoxes` is populated after session load
- Check if sidebar components receive updated data
- Ensure agent box UI components re-render on data change

### 4. Test Config Persistence
- Save agent config with detailed instructions
- Close/reopen session
- Verify all config fields are restored
- Check if `enabled` flag persists

## Temporary Workaround

Until fixed, users should:
1. **Avoid closing sessions** - keep master tab open
2. **Backup configurations** - copy agent settings before closing
3. **Use Account scope** for critical agents (if account-level storage works)

## Priority
**CRITICAL** - This blocks production use of the extension as it causes data loss.

## Related Memory
This relates to the WRVault unlock timeout memory (ID: 11029637) about SQLite/storage issues.






