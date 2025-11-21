# Ollama LLM Integration - Implementation Guide

## Overview

This implementation adds local LLM support via Ollama with Mistral 7B as the default model. The integration includes:

- Hardware detection (RAM, CPU, OS)
- Ollama binary management (bundled with installer)
- Model download with progress tracking
- Provider-agnostic chat completion API
- First-run wizard for user setup
- Configuration persistence

## Architecture

```
Renderer (React/TSX)
    ↓ IPC Channels
Main Process Services
    ↓ HTTP API (localhost:11434)
Ollama Runtime (Bundled Binary)
```

### Core Services

1. **HardwareCheckService** (`electron/main/llm/hardware.ts`)
   - Detects system RAM, CPU cores, OS type
   - Recommends model tier (insufficient/minimal/recommended/excellent)
   - Generates warnings for low-spec systems

2. **OllamaManagerService** (`electron/main/llm/ollama-manager.ts`)
   - Manages Ollama binary lifecycle (start/stop)
   - Downloads models from Ollama registry
   - Checks model availability
   - Tracks download progress

3. **LlmClientService** (`electron/main/llm/client.ts`)
   - Provider-agnostic abstraction layer
   - Supports Ollama (extensible to OpenAI, Anthropic, etc.)
   - Handles chat completion requests
   - Error handling and retries

4. **LlmConfigService** (`electron/main/llm/config.ts`)
   - Loads/saves config from JSON file
   - Merges defaults with user overrides
   - Future: Move API keys to encrypted SQLite

5. **IPC Handlers** (`electron/main/llm/ipc.ts`)
   - Exposes all LLM services to renderer
   - Progress events for model downloads
   - Error propagation

### UI Components

1. **FirstRunWizard** (`src/components/llm/FirstRunWizard.tsx`)
   - Multi-step wizard (Hardware → Ollama → Download → Complete)
   - Shows hardware capabilities and warnings
   - Ollama detection and startup
   - Model download with progress bar
   - Skip option for remote API usage

## Installation & Setup

### Development Setup

For development, you can either:

**Option A: Install Ollama globally (Recommended for testing)**

1. Download Ollama from: https://ollama.ai
2. Install for your platform (Windows/macOS/Linux)
3. Ollama will be available in your system PATH
4. The app will detect it automatically

**Option B: Use bundled binary (Production-like testing)**

1. Download Ollama binaries for your platform
2. Place them in `apps/electron-vite-project/resources/ollama/`
3. Structure:
   ```
   resources/
     ollama/
       windows/
         ollama.exe
       macos/
         ollama
       linux/
         ollama
   ```

### Production Bundling

To bundle Ollama with the installer:

1. **Download Ollama binaries:**
   - Windows: https://ollama.ai/download/windows
   - macOS: https://ollama.ai/download/macos
   - Linux: https://ollama.ai/download/linux

2. **Add to resources directory:**
   ```
   apps/electron-vite-project/resources/ollama/
   ```

3. **Update electron-builder config** (`electron-builder.json5`):
   ```json5
   {
     "extraResources": [
       {
         "from": "resources/ollama",
         "to": "ollama",
         "filter": ["**/*"]
       }
     ]
   }
   ```

4. **Licensing considerations:**
   - Ollama is MIT licensed (redistribution allowed)
   - Mistral 7B is Apache 2.0 (redistribution allowed)
   - Include licenses in your installer
   - Respect model usage terms

### Model Storage

- Ollama stores models in user data directory automatically
- Windows: `%USERPROFILE%\.ollama\models`
- macOS: `~/.ollama/models`
- Linux: `~/.ollama/models`

## Configuration

### Config File Location

`{userData}/llm-config.json`

Example:
```json
{
  "provider": "ollama",
  "modelId": "mistral:7b",
  "endpointUrl": "http://127.0.0.1:11434",
  "ramTier": "recommended",
  "autoStartOllama": true
}
```

### Supported Models

Pre-configured in `config.ts`:
- `mistral:7b` - Default, 4.1 GB, 8 GB RAM minimum
- `llama3:8b` - 4.7 GB, 8 GB RAM minimum
- `phi3:mini` - 2.3 GB, 4 GB RAM minimum

## API Usage

### From Renderer Process

```typescript
// Check hardware
const hardware = await window.llm.checkHardware()
console.log(hardware.totalRamGb, hardware.canRunMistral7B)

// Get status
const status = await window.llm.getStatus()
console.log(status.ollamaInstalled, status.modelAvailable)

// Start Ollama
await window.llm.startOllama()

// Download model with progress
window.llm.onDownloadProgress((data) => {
  console.log(`${data.progress}% - ${data.status}`)
})
await window.llm.downloadModel('mistral:7b')

// Send chat request
const response = await window.llm.chat({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 2048
})
console.log(response.content)

// Update config
await window.llm.updateConfig({
  modelId: 'llama3:8b',
  temperature: 0.9
})
```

## IPC Channels

| Channel | Description |
|---------|-------------|
| `llm:checkHardware` | Detect RAM, CPU, OS |
| `llm:getStatus` | Get Ollama and model status |
| `llm:startOllama` | Start Ollama server |
| `llm:stopOllama` | Stop Ollama server |
| `llm:downloadModel` | Download model from registry |
| `llm:listModels` | List available models |
| `llm:chat` | Send chat completion request |
| `llm:isReady` | Check if client is ready |
| `llm:getConfig` | Get current configuration |
| `llm:updateConfig` | Update configuration |
| `llm:downloadProgress` (event) | Progress updates during download |

## Testing

### Manual Testing Steps

1. **First Run:**
   - Clear localStorage: `localStorage.clear()`
   - Restart app
   - Should show FirstRunWizard
   - Hardware check should display system specs

2. **Ollama Detection:**
   - If Ollama installed: Should detect and proceed
   - If not installed: Should show installation instructions

3. **Model Download:**
   - Click "Download Now"
   - Progress bar should update in real-time
   - Should complete with "Setup Complete" message

4. **Chat Test:**
   ```javascript
   // Open DevTools console
   await window.llm.chat({
     messages: [{ role: 'user', content: 'Say hello' }]
   })
   ```

5. **Settings:**
   - Open Settings
   - Click "Configure Local LLM"
   - Wizard should reopen

### Automated Testing (Future)

See `packages/hello/src/index.test.ts` for examples of how to add tests.

## Troubleshooting

### Ollama not detected

- **Cause:** Ollama not installed or not in PATH
- **Fix:** 
  - Install from https://ollama.ai
  - Or add Ollama binary path to system PATH
  - Restart application

### Download stuck at 0%

- **Cause:** Ollama server not running or network issue
- **Fix:**
  - Check Ollama is running: `ollama list`
  - Check network connection
  - Check firewall/antivirus blocking

### Model not available after download

- **Cause:** Download incomplete or corrupted
- **Fix:**
  - Delete model: `ollama rm mistral:7b`
  - Retry download
  - Check disk space

### Chat request fails

- **Cause:** Ollama server crashed or model not loaded
- **Fix:**
  - Restart Ollama: `ollama serve`
  - Check logs in DevTools console
  - Verify model exists: `ollama list`

## Future Enhancements

1. **Streaming Responses**
   - Use Server-Sent Events (SSE) from Ollama API
   - Show token-by-token output in UI

2. **Multiple Providers**
   - OpenAI client implementation
   - Anthropic (Claude) client
   - Google Gemini client
   - Provider selection in UI

3. **Model Management**
   - List installed models in UI
   - Delete unused models
   - Auto-update models

4. **Performance Metrics**
   - Track tokens/second
   - Measure latency
   - Show in UI

5. **API Key Management**
   - Move to encrypted orchestrator-db
   - Vault integration for sensitive data

6. **Offline Mode**
   - Auto-fallback to local if network down
   - Cache remote responses

## Licensing & Distribution

### Ollama Binary
- License: MIT
- Source: https://github.com/ollama/ollama
- Redistribution: Allowed with attribution

### Mistral 7B Model
- License: Apache 2.0
- Source: https://huggingface.co/mistralai/Mistral-7B-v0.1
- Redistribution: Allowed with attribution
- Commercial use: Allowed

### Your Obligations
1. Include Ollama LICENSE file in installer
2. Include Mistral LICENSE file
3. Add attribution in About dialog
4. Respect model usage terms
5. Don't claim models as your own work

## Support

For issues or questions:
1. Check Ollama docs: https://github.com/ollama/ollama/tree/main/docs
2. Check Mistral docs: https://docs.mistral.ai
3. Review this README
4. Check DevTools console for errors
5. File an issue with logs

## Changes Made

### Files Created
- `electron/main/llm/types.ts` - Type definitions
- `electron/main/llm/hardware.ts` - Hardware detection service
- `electron/main/llm/ollama-manager.ts` - Ollama lifecycle management
- `electron/main/llm/client.ts` - LLM client abstraction
- `electron/main/llm/config.ts` - Configuration service
- `electron/main/llm/ipc.ts` - IPC handlers
- `src/components/llm/FirstRunWizard.tsx` - Setup wizard UI

### Files Modified
- `electron/main.ts` - Added LLM service initialization
- `electron/preload.ts` - Exposed LLM API to renderer
- `src/App.tsx` - Integrated FirstRunWizard

### Dependencies
No new dependencies required! Uses built-in Node.js modules:
- `os` - System information
- `fs/promises` - File operations
- `child_process` - Process management
- `fetch` (Node 18+) - HTTP requests

