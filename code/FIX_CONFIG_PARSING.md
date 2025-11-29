# Fix: Correct Config Parsing for System Tab Display

## The Problem

The Input and Output Coordinators were showing incorrect/empty data because they were trying to read agent configuration from the wrong location in the data structure.

### Root Cause

Agent configurations are stored in `agent.config.instructions` as a **JSON string**, not as direct properties on the `agent` object.

```typescript
// WRONG - trying to read from agent directly
const hasListener = agent.capabilities?.includes('listening')
const contextSettings = agent.contextSettings || {}

// These fields don't exist on agent, they exist in agent.config.instructions!
```

### How Config is Actually Stored

When a user saves agent configuration, the data is stored like this:

```typescript
agent.config.instructions = JSON.stringify({
  id: 'agent-01',
  name: 'Research Agent',
  icon: '🔍',
  capabilities: ['listening', 'reasoning', 'execution'],
  listening: {
    passiveEnabled: true,
    activeEnabled: true,
    expectedContext: 'Research papers...',
    tags: ['dom', 'screenshot'],
    source: 'all',
    website: 'scholar.google.com',
    active: {
      triggers: [
        { tag: { name: '@research', kind: 'MENTION' } }
      ]
    },
    passive: {
      triggers: [
        { tag: { name: 'scroll', kind: 'SCROLL' } }
      ]
    },
    exampleFiles: [...],
    reportTo: ['agent:agent-02']
  },
  reasoning: {
    applyFor: '__any__',
    goals: 'Analyze research...',
    role: 'Research Assistant',
    rules: 'Always cite...',
    custom: [{ key: 'citation_style', value: 'APA' }],
    acceptFrom: ['agent:agent-01'],
    reportTo: ['agent:agent-03']
  },
  contextSettings: {
    sessionContext: true,
    accountContext: true,
    agentContext: true
  },
  agentContextFiles: [...],
  memorySettings: {
    sessionEnabled: true,
    sessionRead: true,
    sessionWrite: true,
    accountEnabled: false,
    accountRead: false,
    accountWrite: false
  }
})
```

**Key Point**: The data is stored as a **string** in `agent.config.instructions`, not as properties directly on `agent`.

## The Solution

Parse `agent.config.instructions` at the start of processing each agent:

```typescript
agents.forEach((agent, idx) => {
  // Parse agent.config.instructions if it's a string
  let agentData = agent
  if (agent.config?.instructions) {
    try {
      const parsed = typeof agent.config.instructions === 'string' 
        ? JSON.parse(agent.config.instructions) 
        : agent.config.instructions
      // Merge parsed config into agent data
      agentData = { ...agent, ...parsed }
    } catch (e) {
      console.error('Failed to parse agent config:', e)
    }
  }
  
  // NOW we can read the actual configuration
  const hasListener = agentData.capabilities?.includes('listening')
  const contextSettings = agentData.contextSettings || {}
  const memSettings = agentData.memorySettings || {}
  // etc...
})
```

## What Was Fixed

### Input Coordinator (`generateInputCoordinatorText`):
1. ✅ Added config parsing at the start of the agent loop
2. ✅ Changed all `agent.X` references to `agentData.X`
3. ✅ Updated summary statistics to re-parse configs

### Output Coordinator (`generateOutputCoordinatorText`):
1. ✅ Added config parsing at the start of the agent loop
2. ✅ Changed all `agent.X` references to `agentData.X`
3. ✅ Updated summary statistics to re-parse configs

## Fields Now Correctly Displayed

All fields are now read from the parsed config:

**Listener Section:**
- ✅ `passiveEnabled` / `activeEnabled`
- ✅ `expectedContext`
- ✅ `tags`
- ✅ `source`
- ✅ `website`
- ✅ `active.triggers` with kinds
- ✅ `passive.triggers` with kinds
- ✅ `exampleFiles` with names and sizes
- ✅ `reportTo` destinations

**Reasoning Section:**
- ✅ `applyFor`
- ✅ `goals`
- ✅ `role`
- ✅ `rules`
- ✅ `custom` fields
- ✅ `acceptFrom` (Listen From)
- ✅ `reportTo` (Respond To)

**Context & Memory:**
- ✅ `contextSettings` (session/account/agent)
- ✅ `agentContextFiles` with names and sizes
- ✅ `memorySettings` (session/account, read/write)

**Execution:**
- ✅ `specialDestinations` (agent boxes, workflows, UI)
- ✅ Agent box allocations with slot details

## Verification

To verify the fix works:

1. Open extension and configure an agent with:
   - Listener section enabled
   - Expected context filled
   - Tags selected
   - Triggers added (passive and active)
   - Files uploaded (example and context)
   - Context access enabled
   - Memory settings enabled
   - Reasoning goals/role/rules filled

2. Click "System" tab

3. Verify Input Coordinator shows:
   - ✓ Listener State: ACTIVE
   - ✓ All modes, tags, triggers, files
   - ✓ Context Access with correct checkmarks
   - ✓ Memory Settings with correct states

4. Verify Output Coordinator shows:
   - ✓ Execution destinations
   - ✓ Reasoning output routing
   - ✓ Model config if set

## Technical Details

**Where config is saved**: `apps/extension-chromium/src/content-script.tsx` line ~3644
```typescript
agent.config[configType] = configData  // configData is a JSON string
```

**Where config is loaded**: `apps/extension-chromium/src/content-script.tsx` line ~3776
```typescript
const data = agent?.config?.[configType] || null
```

**Storage key format**: `agent_${agentName}_${type}` where type is `'instructions'`

## Build Info

- **Build Status**: ✅ Successful
- **Build Time**: 4.41s
- **Output File**: `dist/assets/content-script.tsx-GvxkcZcM.js` (626.32 KB)
- **No errors or warnings** (other than chunk size)

## What This Fixes

- ❌ **Before**: "Listener State: INACTIVE" when listener WAS active
- ✅ **After**: "Listener State: ACTIVE" with all settings shown

- ❌ **Before**: "Context Access: ✗ ✗ ✗" when context WAS enabled
- ✅ **After**: "Context Access: ✓ ✓ ✓" with correct states

- ❌ **Before**: No files shown even when uploaded
- ✅ **After**: All uploaded files displayed with sizes

- ❌ **Before**: Empty tags/triggers/settings
- ✅ **After**: All configured values displayed accurately








