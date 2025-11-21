# 🤖 AI Agent → LLM Integration - Complete Analysis & Implementation Plan

## 📋 Form Structure Analysis (From Screenshots & Code)

### **AI Instructions Form - Agent 01 - Ergg**

Located in: `apps/extension-chromium/src/content-script.tsx`  
Function: `openAgentConfigDialog(agentName, type='instructions', overlay)`

### **Form Fields Identified:**

#### **1. Basic Configuration**
```typescript
- Name (Command Identifier): string  // e.g., "ergg"
- Icon: string  // emoji selector
```

#### **2. Capability Checkboxes** (THREE MAIN SECTIONS)
```typescript
☑ Listener   // cap-listening
☑ Reasoning  // cap-reasoning  
☑ Execution  // cap-execution
```

#### **3. Context Section**
```typescript
- Upload JSON/PDF/DOCX/MD: file upload
- Session Context: checkbox
- Account Context: checkbox
- Agent Context: checkbox
```

#### **4. Memory Section**
```typescript
- Session Memory: Read ON/OFF, Write ON/OFF
- Account Memory: Read ON/OFF, Write ON/OFF
- Agent Memory: always on (grayed out)
```

#### **5. Listener Section** (when Listener checkbox enabled)
```typescript
- Passive Listener / Active Listener: radio buttons
- Listen on (type): dropdown (All, specific types)
- Tagged Trigger (with pattern detection): text input with tags
- Example Files: file upload for training examples
```

#### **6. Reasoning Section** (when Reasoning checkbox enabled)
```typescript
- Apply For: dropdown selector (__any__ or specific routes)
- Goals: textarea (R-goals) // Main AI instructions
- Role: text input (R-role) // Agent role/persona
- Rules: textarea (R-rules) // Constraints and guidelines
- Accept From: route selector (agent, workflow, tool, UI, agentBox)
- Report To: route selector (where to send output)
- Custom Fields: key-value pairs
```

#### **7. Execution Section** (when Execution checkbox enabled)
```typescript
- Workflows: list of workflows to trigger
- Accept From: route selector
- Special Destinations: where to send results
  - Can select specific agents (Agent 01-10)
  - Can select agent boxes (Agent Box 01-50)
```

---

## 🔍 Critical Data Flow Understanding

### How Agents Are Stored:
```typescript
const storageKey = `agent_${agentName}_instructions`

interface AgentConfig {
  name: string
  icon: string
  capabilities: ('listening' | 'reasoning' | 'execution')[]
  
  // Context
  sessionContext: boolean
  accountContext: boolean
  agentContext: boolean
  agentContextFiles?: File[]
  
  // Memory
  memory: {
    sessionRead: boolean
    sessionWrite: boolean
    accountRead: boolean
    accountWrite: boolean
    agentEnabled: true
  }
  
  // Listener (if capability enabled)
  listening?: {
    passiveEnabled: boolean
    activeEnabled: boolean
    expectedContext: string
    tags: string[]
    source: string
    website: string
    exampleFiles: File[]
    triggers: Array<{
      tag: string
      kind: string
      pattern: string
    }>
  }
  
  // Reasoning (if capability enabled) 
  reasoning?: {
    applyFor: string  // '__any__' or specific route
    goals: string     // ⚡ THIS IS THE AI INSTRUCTIONS
    role: string      // ⚡ THIS IS THE AGENT PERSONA
    rules: string     // ⚡ THIS IS THE CONSTRAINTS
    custom: Array<{key: string, value: string}>
    acceptFrom: string[]  // Routes this agent accepts input from
    reportTo: string[]    // Routes where output is sent
  }
  
  // Execution (if capability enabled)
  execution?: {
    workflows: string[]
    acceptFrom: string[]
    specialDestinations: Array<{
      kind: string
      agents: string[]  // e.g., ['agent-01', 'agentbox-05']
    }>
  }
}
```

---

## 🎯 WHERE TO INTEGRATE LLM

### **Location 1: Add LLM Provider to Reasoning Section**

**File:** `apps/extension-chromium/src/content-script.tsx`  
**Function:** Dynamic section rendering (around line 11250-11400)  
**Section:** When `cap-reasoning` is checked

**Need to Add:**
```typescript
// After R-role field, add LLM provider selection:
<div style="margin-top: 12px;">
  <label>LLM Provider
    <select id="R-llm-provider" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
      <option value="">Use Global Default</option>
      <option value="ollama">Ollama (Local)</option>
      <option value="openai">OpenAI</option>
      <option value="claude">Claude</option>
      <option value="gemini">Gemini</option>
      <option value="grok">Grok</option>
    </select>
  </label>
</div>

<div style="margin-top: 12px;">
  <label>Model
    <select id="R-llm-model" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
      <option value="auto">Auto</option>
      <!-- Dynamically populated based on provider -->
    </select>
  </label>
</div>
```

### **Location 2: Save LLM Config with Reasoning Data**

**File:** `apps/extension-chromium/src/content-script.tsx`  
**Function:** Save handler (around line 10836-10878)  
**Current Code:**
```typescript
if (R) {
  const base:any = {
    applyFor: ...,
    goals: ...,
    role: ...,
    rules: ...,
    acceptFrom: ...,
    reportTo: ...
  }
  draft.reasoning = base
}
```

**Need to Add:**
```typescript
if (R) {
  const base:any = {
    applyFor: ...,
    goals: ...,
    role: ...,
    rules: ...,
    // ⚡ ADD LLM CONFIG
    llmProvider: (document.getElementById('R-llm-provider') as HTMLSelectElement)?.value || '',
    llmModel: (document.getElementById('R-llm-model') as HTMLSelectElement)?.value || 'auto',
    acceptFrom: ...,
    reportTo: ...
  }
  draft.reasoning = base
}
```

---

## 🚀 WHERE AGENTS ARE EXECUTED

### **Trigger Points Found:**

1. **Command Chat** - User types agent name in command chat
2. **Tagged Triggers** - Pattern detection from Listener section
3. **Passive Listening** - Continuous monitoring mode
4. **Workflows** - Other agents/workflows trigger this agent
5. **Manual Activation** - Agent toggle switch in main config

### **Execution Flow (Need to Create):**

```typescript
async function executeAgent(agentName: string, context: any) {
  // 1. Load agent config
  const agentConfig = await loadAgentConfig(agentName)
  
  // 2. Check if Reasoning capability is enabled
  if (!agentConfig.capabilities.includes('reasoning')) {
    console.log('Agent does not have reasoning capability')
    return
  }
  
  // 3. Gather context data
  const fullContext = await gatherContext(agentConfig, context)
  
  // 4. Build LLM prompt
  const prompt = buildPrompt(agentConfig.reasoning, fullContext)
  
  // 5. ⚡ CALL LLM (THIS IS THE CRITICAL INTEGRATION POINT)
  const llmResponse = await callLLM({
    provider: agentConfig.reasoning.llmProvider || 'ollama',
    model: agentConfig.reasoning.llmModel || 'mistral:7b',
    messages: [
      { role: 'system', content: prompt.systemMessage },
      { role: 'user', content: prompt.userMessage }
    ]
  })
  
  // 6. Route response to destinations
  await routeResponse(agentConfig, llmResponse)
}

function buildPrompt(reasoning: any, context: any) {
  const systemMessage = `
Role: ${reasoning.role || 'AI Assistant'}

Goals:
${reasoning.goals || 'Help the user'}

Rules:
${reasoning.rules || 'Be helpful and accurate'}

Context Available:
${JSON.stringify(context, null, 2)}
`
  
  const userMessage = context.userInput || context.triggerText || 'Process the provided context'
  
  return { systemMessage, userMessage }
}

async function callLLM(request: {provider: string, model: string, messages: any[]}) {
  // Check if using local Ollama
  if (request.provider === 'ollama' || !request.provider) {
    // Call Electron app's HTTP API
    const response = await fetch('http://127.0.0.1:51248/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: request.model,
        messages: request.messages
      })
    })
    
    const data = await response.json()
    return data.data.content
  }
  
  // For remote providers (OpenAI, Claude, etc.)
  // Use existing API call logic
}

async function routeResponse(agentConfig: any, response: string) {
  // Get destinations from execution.specialDestinations
  const destinations = agentConfig.execution?.specialDestinations || []
  
  for (const dest of destinations) {
    if (dest.kind === 'agentBox') {
      // Send to agent boxes
      for (const agentBox of dest.agents) {
        await displayInAgentBox(agentBox, response)
      }
    } else if (dest.kind === 'agent') {
      // Send to other agents
      for (const targetAgent of dest.agents) {
        await executeAgent(targetAgent, { input: response })
      }
    }
  }
}
```

---

## 📝 Implementation Checklist

### Phase 1: Add LLM Provider Fields to Form ✅
- [ ] Find Reasoning section rendering code
- [ ] Add LLM Provider dropdown (Ollama, OpenAI, Claude, Gemini, Grok)
- [ ] Add Model dropdown (dynamically populated)
- [ ] Wire up provider change → update models
- [ ] Add to save/load logic

### Phase 2: Create Agent Execution Engine
- [ ] Create `executeAgent()` function
- [ ] Implement context gathering
- [ ] Implement prompt building
- [ ] Implement LLM call routing (local vs remote)
- [ ] Implement response routing to destinations

### Phase 3: Wire Trigger Points
- [ ] Command chat integration
- [ ] Tagged trigger detection
- [ ] Passive listener integration
- [ ] Workflow trigger integration

### Phase 4: Display Logic
- [ ] Agent Box display integration
- [ ] Agent-to-agent communication
- [ ] UI overlay display
- [ ] Workflow execution

### Phase 5: Testing
- [ ] Test with Ollama + Mistral 7B
- [ ] Test context gathering
- [ ] Test routing to agent boxes
- [ ] Test full listener → reasoning → execution flow

---

## 🎯 NEXT IMMEDIATE STEPS

1. **Search for Reasoning Section Rendering**
   - Find where `box-reasoning` div is created
   - Find where R-goals, R-role, R-rules fields are added
   - Add LLM provider/model dropdowns after R-role

2. **Update Save Logic**
   - Add llmProvider and llmModel to reasoning object
   - Ensure it persists to chrome.storage

3. **Create LLM Call Function**
   - Add to content-script.tsx or separate module
   - Handle both local (Ollama) and remote providers
   - Use Electron HTTP API for local LLM

4. **Wire First Execution Trigger**
   - Start with command chat (simplest)
   - When user types agent name, execute agent
   - Display response in console first, then agent box

---

## 🔧 Code Locations Reference

**Agent Form:**
- File: `apps/extension-chromium/src/content-script.tsx`
- Function: `openAgentConfigDialog()` (line ~11000-12000)
- Save Handler: Line ~10700-11000

**Agent Execution (TO BE CREATED):**
- Location: TBD (new function in content-script.tsx)
- Called from: Command chat, triggers, workflows

**LLM Client:**
- Backend: `apps/electron-vite-project/electron/main/llm/client.ts` ✅
- HTTP API: `apps/electron-vite-project/electron/main.ts` (port 51248) ✅
- Extension calls: `http://127.0.0.1:51248/api/llm/chat` ✅

---

**Status:** Ready to implement Phase 1  
**Next:** Add LLM provider fields to Reasoning section

