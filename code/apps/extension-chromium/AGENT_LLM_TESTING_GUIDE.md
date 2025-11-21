# Agent Box LLM Integration - Testing Guide

## Overview

All phases of the Ollama LLM integration for Agent Boxes are now complete. This guide explains how to test the complete agent → LLM → agent box display flow.

## What Was Implemented

### Phase 1: Ollama Provider in Agent Box Forms ✅
- Added "Ollama (Local)" as first option in provider dropdown
- Available in all agent box forms:
  - Sidepanel agent box form (`content-script.tsx`)
  - Display grid agent box form (`grid-script-v2.js`)
  - Display grid agent box form v1 (`grid-script.js`)
- Added Ollama models:
  - `mistral:7b` (default, installed)
  - `llama3:8b`
  - `phi3:mini`
  - `mistral:14b`

### Phase 2: AgentExecutor Service ✅
- Created `src/services/AgentExecutor.ts`
- Loads agent configuration from chrome.storage
- Loads agent box LLM settings (provider + model)
- Builds prompts from agent's reasoning section (goals, role, rules)
- Calls Ollama via Electron app HTTP API (`http://127.0.0.1:51248/api/llm/chat`)
- Supports fallback to global/default LLM settings

### Phase 3: Agent Box Execution Wiring ✅
- Added execute button (▶) to all agent boxes in sidepanel
- Button positioned next to edit and delete buttons
- Execute button:
  - Checks if agent is configured
  - Sends page content (first 5000 chars) as context
  - Calls AgentExecutor with agent number, context, and agent box ID
  - Displays result in agent box output area
  - Shows notifications for success/error states

### Phase 4: Configuration Persistence ✅
- Verified all save handlers capture provider and model
- Agent box configurations stored with:
  - `provider`: "Ollama", "OpenAI", "Claude", etc.
  - `model`: "mistral:7b", "gpt-4o-mini", etc.
  - Stored in chrome.storage and SQLite
  - Properly loaded on page reload

### Phase 5: Error Handling and Fallbacks ✅
- Connection checks before LLM calls:
  - `checkElectronConnection()`: Verifies OpenGiraffe desktop app is running
  - `checkOllamaRunning()`: Verifies Ollama server status
- 60-second timeout for LLM requests
- User-friendly error messages:
  - "Cannot connect to Electron app. Please ensure the OpenGiraffe desktop app is running."
  - "Ollama is not running. Please start Ollama or check LLM settings in the Backend Configuration."
  - "LLM request timed out. The model might be too large or the system is under heavy load."

## Prerequisites

Before testing, ensure:

1. ✅ **Electron App (OpenGiraffe) is running**
   - Must be running for extension to communicate with Ollama
   
2. ✅ **Ollama is installed and running**
   - Check in extension's Backend Configuration → LLM tab
   - Should show: "✓ Ollama Installed and Running"
   
3. ✅ **Mistral 7B model is downloaded**
   - Check in Backend Configuration → LLM tab
   - Should show: "✓ Available" under Mistral 7B Model Status
   
4. ✅ **At least one AI Agent is configured with reasoning capability**
   - Open ADMIN section → AI Agent Configuration
   - Enable "Reasoning" capability checkbox
   - Fill in:
     - **Goals** (R-goals): Main AI instructions (e.g., "Summarize the main points of this page")
     - **Role** (R-role): Agent persona (e.g., "You are a helpful summarization assistant")
     - **Rules** (R-rules): Constraints/guidelines (e.g., "Keep summaries under 200 words")

## Testing Steps

### Test 1: Create and Configure Agent Box

1. **Open Extension Sidepanel**
   - Click extension icon in Chrome toolbar
   - Switch to "Master Tab" mode

2. **Add New Agent Box**
   - Click "+" button to add new agent box
   - Or use existing agent box and click edit (✏️) button

3. **Configure Agent Box**
   - **Title**: Give it a descriptive name (e.g., "Page Summary")
   - **Agent Number**: Select an agent that has reasoning configured (e.g., "1" for agent01)
   - **Provider**: Select "Ollama (Local)"
   - **Model**: Select "mistral:7b"
   - Click **Save**

4. **Verify Configuration**
   - Agent box should appear in sidepanel
   - Should show title and status: "Ready for [Title]..."

### Test 2: Execute Agent with LLM

1. **Navigate to a Web Page**
   - Go to any webpage with text content (e.g., Wikipedia article, blog post)

2. **Execute Agent**
   - In sidepanel, find your configured agent box
   - Click the green **Execute button (▶)** on the agent box header

3. **Monitor Execution**
   - Should see notification: "Executing agent X..."
   - Agent box should show activity (loading state)
   - Wait for LLM to process (typically 5-30 seconds depending on page content)

4. **Verify Results**
   - Success notification: "Agent execution completed!"
   - Agent box should display LLM's response
   - Response should be relevant to:
     - Agent's goals/role/rules
     - Page content that was sent

### Test 3: Error Scenarios

1. **Test Without Electron App**
   - Close OpenGiraffe desktop app
   - Try to execute agent
   - Expected error: "Cannot connect to Electron app. Please ensure the OpenGiraffe desktop app is running."

2. **Test Without Ollama Running**
   - Ensure Electron app is running
   - Stop Ollama service (if running as system service)
   - Try to execute agent
   - Expected error: "Ollama is not running. Please start Ollama or check LLM settings in the Backend Configuration."

3. **Test With No Agent Configured**
   - Create agent box without selecting an agent
   - Try to execute
   - Expected error: "No agent configured for this box"

4. **Test With Agent Missing Reasoning**
   - Configure agent box to use an agent that doesn't have reasoning enabled
   - Try to execute
   - Expected error: "Agent X does not have reasoning capability enabled"

### Test 4: Multiple Agent Boxes

1. **Create Multiple Agent Boxes**
   - Create 2-3 agent boxes with different:
     - Agent numbers
     - Titles
     - Models (try phi3:mini if downloaded)

2. **Execute Each Agent**
   - Verify each agent box:
     - Uses its own configured agent's instructions
     - Uses its own configured model
     - Displays results independently

3. **Verify Persistence**
   - Reload the extension (close and reopen sidepanel)
   - Verify all agent boxes still show:
     - Correct configuration
     - Previous output (if any)

## Expected Behavior

### Successful Execution
- Notification: "Executing agent X..." → "Agent execution completed!"
- Agent box displays markdown-formatted response
- Response is contextually relevant to page content
- Response follows agent's goals, role, and rules

### Agent Box Output Format
- Plain text or markdown rendered
- Scrollable if content is long
- Preserves formatting (paragraphs, lists, etc.)

### Typical Response Time
- **Short pages (< 1000 words)**: 5-15 seconds
- **Medium pages (1000-3000 words)**: 15-30 seconds
- **Long pages (> 3000 words)**: 30-60 seconds

## Troubleshooting

### Issue: "Cannot connect to Electron app"
**Solution:**
- Start OpenGiraffe desktop app
- Verify it's running on port 51248
- Check Windows Task Manager for "OpenGiraffe.exe" or "electron.exe"

### Issue: "Ollama is not running"
**Solution:**
1. Open Backend Configuration → LLM tab in extension
2. Check Ollama Runtime Status
3. If not running, click "Refresh Status" or restart desktop app
4. Desktop app should auto-start Ollama

### Issue: "Agent execution timed out"
**Solution:**
- Page content might be too large
- Model might be slow on your hardware
- Try a smaller/faster model like "phi3:mini"
- Reduce page content (shorter pages)

### Issue: Agent box shows empty or irrelevant response
**Solution:**
- Check agent configuration in AI Agent Configuration form
- Verify reasoning section has clear goals and role
- Make sure page has actual content (not just navigation/ads)
- Check console logs for errors (F12 → Console)

### Issue: Execute button does nothing
**Solution:**
- Check browser console for JavaScript errors
- Verify agent number is set in agent box config
- Ensure agent has reasoning capability enabled
- Try editing and re-saving the agent box

## Debug Information

### Browser Console Logs
Open browser console (F12) and look for:
- `[AgentExecutor] Starting execution:` - Shows request details
- `[AgentExecutor] Using LLM settings:` - Shows provider/model
- `[AgentExecutor] Generated prompt:` - Shows what's sent to LLM
- `[AgentExecutor] LLM response received:` - Shows response
- `[AgentExecutor] Execution failed:` - Shows errors

### Electron App Logs
In OpenGiraffe desktop app console:
- `[LLM IPC] Chat request received` - Shows incoming requests
- `[OLLAMA] Chat request` - Shows Ollama API calls
- `[OLLAMA] Chat response` - Shows Ollama responses

## Next Steps After Testing

Once testing is complete, the following can be added:

1. **Command Chat Integration**
   - Allow executing agents via chat commands (e.g., "ergg summarize this")
   - Route responses to configured destinations

2. **Auto-Execution Triggers**
   - Execute agents automatically on page load
   - Execute on user selection
   - Execute on specific URL patterns

3. **Streaming Responses**
   - Real-time token streaming from Ollama
   - Progressive display in agent boxes
   - Improves perceived performance

4. **Additional LLM Providers**
   - OpenAI (gpt-4o-mini, gpt-4o)
   - Claude (claude-3-5-sonnet, claude-3-opus)
   - Gemini (gemini-1.5-flash, gemini-1.5-pro)
   - Grok (grok-2-mini, grok-2)

5. **Advanced Agent Features**
   - Agent memory (session and account level)
   - Multi-agent workflows
   - Tool integration (search, calculate, etc.)

## Files Modified

- `apps/extension-chromium/src/content-script.tsx` - Added Ollama to sidebar agent boxes
- `apps/extension-chromium/public/grid-script-v2.js` - Added Ollama to display grids
- `apps/extension-chromium/public/grid-script.js` - Added Ollama to display grids
- `apps/extension-chromium/src/services/AgentExecutor.ts` - NEW: Agent execution service
- `apps/extension-chromium/src/sidepanel.tsx` - Added execute button and integration

## Commits

- `820b180` - Phase 1 & 2: Ollama provider + AgentExecutor service
- `a1daa2c` - Phase 3-5: Execution wiring, persistence, error handling

