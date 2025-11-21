# AI Agent → LLM Integration Analysis

## 🔍 Current Agent System Architecture

### 1. Agent Structure (Found in `orchestration.js`)

```javascript
{
    id: 'summarize-agent',
    name: 'Summarize Agent',
    instructions: 'AI instructions text...',
    context: ['page-content', 'user-selection'],
    memory: ['previous-summaries'],
    displaySlot: 'bottom-panel',
    isActive: false
}
```

### 2. Agent Boxes (Grid Display System)

**Location:** `grid-script-v2.js`, `content-script.tsx`

Each Agent Box can be configured with:
- **Agent Number** (1-99)
- **LLM Provider** (OpenAI, Claude, Gemini, Grok, **Ollama**)
- **Model Selection** (per provider)
- **Tools/Mini Apps**
- **Display Configuration**

**Key Quote from Code:**
> "If no agent or LLM is selected, this box will use the global 'Setup AI Agent' settings as fallback."

### 3. Missing: The "Setup AI Agent" Form

**What we need to find:**
- ✅ Location of the AI Instructions form
- ✅ Listener section configuration
- ✅ Reasoning section configuration
- ✅ Execution section configuration
- ✅ How agents actually call LLMs
- ✅ Where the LLM integration point is

## 🎯 Required LLM Integration Points

### Point 1: Add Ollama as LLM Provider Option

**Current Providers in Agent Boxes:**
- OpenAI (GPT-4o, GPT-4o-mini)
- Claude (Claude-3.5-Sonnet, Claude-3-Opus)
- Gemini (Gemini-1.5-Flash, Gemini-1.5-Pro)
- Grok (Grok-2, Grok-2-mini)

**Need to Add:**
```javascript
case 'ollama': return ['auto', 'mistral:7b', 'llama3:8b', 'phi3:mini']
```

### Point 2: LLM Client Call in Agent Execution

**Expected Flow:**
1. User triggers agent (via command, trigger, or manual)
2. Agent gathers context (page content, selection, etc.)
3. Agent accesses memory (previous conversations, etc.)
4. **→ Agent calls LLM with instructions + context**
5. LLM generates response
6. Agent displays response in designated slot (agent box)

**Missing:** Where does step 4 happen in the code?

### Point 3: Setup AI Agent Form Integration

The form you mentioned has:
- **Listener Section** - Defines what triggers the agent
- **Reasoning Section** - Defines how the agent thinks/processes
- **Execution Section** - Defines what actions the agent takes

**This form likely contains:**
- Default AI Instructions template
- Default LLM provider selection
- Default model selection
- Fallback configuration for agent boxes

## 🚨 Critical Questions

### Question 1: Where is "Setup AI Agent" Form Located?

**Possible locations to check:**
- ❓ Sidepanel → Settings or Admin section?
- ❓ Backend Configuration → AI Agent tab?
- ❓ Separate popup/modal in sidepanel?
- ❓ Grid display settings?

**Need from User:**
Could you please point me to where this form is located? Is it in:
1. The sidepanel Settings?
2. A dedicated AI Agent setup tab?
3. The Backend Configuration section?
4. Another location?

### Question 2: Where Does Agent Execution Happen?

**Current findings:**
- Agent **configuration** is in `orchestration.js`
- Agent **boxes** are in `grid-script-v2.js`
- Agent **execution** logic is ???

**Need to find:**
```javascript
function executeAgent(agentId, context) {
    const agent = getAgent(agentId);
    const instructions = agent.instructions;
    const llmProvider = agent.llmProvider || globalLlmProvider;
    
    // THIS is where we need to call the LLM
    const response = await callLLM(llmProvider, instructions, context);
    
    return response;
}
```

### Question 3: How Are Agents Triggered?

**Potential triggers found:**
- Manual toggle in orchestration UI
- Workflow start button
- Command chat messages (in sidepanel)
- Page interactions (captures, triggers)

**Need to understand:** What calls the agent execution with the LLM?

## 📋 Integration Checklist

### Phase 1: Find Missing Pieces ✅ IN PROGRESS

- [x] Located agent configuration system
- [x] Located agent box system
- [x] Identified LLM provider options
- [ ] **FIND: Setup AI Agent form location**
- [ ] **FIND: Agent execution logic with LLM calls**
- [ ] **FIND: Listener/Reasoning/Execution sections**

### Phase 2: Add Ollama Support

- [ ] Add Ollama to provider list in agent boxes
- [ ] Add Ollama models (mistral:7b, llama3:8b, phi3:mini)
- [ ] Create Ollama client adapter
- [ ] Integrate with existing LLM abstraction layer

### Phase 3: Wire LLM Calls

- [ ] Connect agent execution to LLM client
- [ ] Pass AI instructions to LLM
- [ ] Pass context data to LLM
- [ ] Handle LLM response
- [ ] Display in agent boxes

### Phase 4: Test Complete Flow

- [ ] Create test agent with Ollama + Mistral 7B
- [ ] Trigger agent execution
- [ ] Verify LLM is called correctly
- [ ] Verify response displays in agent box
- [ ] Test with different agent configurations

## 🔧 Implementation Strategy

### Step 1: Locate the Form (URGENT)

**User Action Needed:**
Please open the extension and navigate to the "Setup AI Agent" or "AI Instructions" form, then let me know:
1. Where exactly is it located in the UI?
2. What tabs/sections does it have?
3. Are listener/reasoning/execution visible as separate fields?

### Step 2: Understand Execution Flow

Once we find the form, we need to trace:
1. How form data is saved
2. Where agent execution reads this data
3. Where the LLM call should happen
4. How to integrate our Ollama client

### Step 3: Implement Integration

Based on findings, implement:
1. Ollama provider option
2. LLM client adapter
3. Execution wiring
4. Response handling

## 📝 Code Locations for Reference

### Agent Configuration
- `apps/extension-chromium/public/orchestration.js`
- `apps/extension-chromium/public/orchestration.html`

### Agent Boxes
- `apps/extension-chromium/public/grid-script-v2.js`
- `apps/extension-chromium/src/content-script.tsx`

### Sidepanel (Main UI)
- `apps/extension-chromium/src/sidepanel.tsx`

### LLM Integration (Backend)
- `apps/electron-vite-project/electron/main/llm/` - All LLM services
- `apps/electron-vite-project/electron/main.ts` - HTTP API endpoints

## ⚡ Quick Action Items

**For User:**
1. Show me where "Setup AI Agent" form is located
2. Confirm if listener/reasoning/execution sections exist
3. Show me an example of how agents currently work (if working)

**For Development:**
1. Once form is located, add Ollama to provider dropdown
2. Create agent execution → LLM call integration
3. Test with Mistral 7B

---

**Status:** ⏳ Waiting for user to identify form location  
**Next Step:** Locate and analyze the Setup AI Agent form with listener/reasoning/execution sections

