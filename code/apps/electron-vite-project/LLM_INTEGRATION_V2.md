# LLM Integration V2 - Implementation Summary

## Overview

Complete local LLM integration with Ollama runtime, accurate hardware detection, multi-model support, and unified UI across Electron app and Chrome extension.

## Architecture

### Backend (Electron Main Process)

**Location**: `apps/electron-vite-project/electron/main/llm/`

#### Core Modules

1. **types.ts** - TypeScript interfaces
   - `HardwareInfo`: System capabilities (RAM, CPU, GPU, disk)
   - `LlmModelConfig`: Model specifications (size, RAM requirements, context window)
   - `OllamaStatus`: Runtime status
   - `InstalledModel`: Installed model details
   - `ChatMessage`, `ChatRequest`, `ChatResponse`: LLM communication
   - `DownloadProgress`: Model installation progress
   - `ModelPerformanceEstimate`: Performance predictions

2. **hardware.ts** - `HardwareService`
   - Detects: Total/Free RAM, CPU cores, GPU (optional), disk space
   - OS detection: Windows/macOS/Linux
   - **Key**: Uses FREE RAM for recommendations (not total)
   - Generates warnings for insufficient resources
   - Recommends specific models based on available RAM
   - Estimates performance per model: fast/usable/slow/unusable

3. **ollama-manager.ts** - `OllamaManager`
   - Lifecycle management: check installation, start/stop server
   - Model operations: list, pull (download), delete
   - Chat interface: send messages, receive responses
   - Headless service mode (background process)
   - Auto-detects bundled vs. system Ollama
   - Progress tracking for downloads

4. **config.ts** - Model catalog and defaults
   - 10 models across 4 tiers:
     - **Lightweight**: TinyLlama (0.6GB), Phi-3 Mini (2.3GB)
     - **Balanced**: Mistral 7B Q4 (2.6GB), Q5 (3.2GB), Llama 3 8B (4.7GB)
     - **Performance**: Mistral 7B full (4.1GB), Llama 3.1 8B (4.7GB)
     - **High-end**: Mixtral 8x7B (26GB), Llama 3.1 70B (40GB), Qwen 2 72B (41GB)
   - Helper functions: `getModelConfig()`, `getModelsByTier()`, `getModelsForRam()`

5. **ipc.ts** - IPC handlers for Electron renderer
   - `llm:getHardware` - Get system info
   - `llm:getStatus` - Get Ollama status
   - `llm:startOllama` / `llm:stopOllama` - Control server
   - `llm:listModels` - List installed models
   - `llm:getModelCatalog` - Get available models
   - `llm:installModel` - Download model (with progress events)
   - `llm:deleteModel` - Remove model
   - `llm:setActiveModel` - Switch active model
   - `llm:chat` - Send chat request
   - `llm:getPerformanceEstimate` - Get estimate for model

#### HTTP API (for Extension)

**Endpoints in main.ts** (port 51248):

```
GET  /api/llm/hardware           - Get hardware info
GET  /api/llm/status             - Get Ollama status
POST /api/llm/start              - Start Ollama
POST /api/llm/stop               - Stop Ollama
GET  /api/llm/models             - List installed models
GET  /api/llm/catalog            - Get model catalog
POST /api/llm/models/install     - Install model
DELETE /api/llm/models/:modelId  - Delete model
POST /api/llm/models/activate    - Set active model
POST /api/llm/chat               - Chat with model
GET  /api/llm/performance/:modelId - Get performance estimate
```

### Frontend (Shared React Component)

**Location**: `apps/extension-chromium/src/components/LlmSettings.tsx`

#### Bridge Abstraction

Component works with both:
- **IPC bridge** (Electron renderer): Direct `ipcRenderer.invoke()`
- **HTTP bridge** (Extension): Fetch to `http://127.0.0.1:51248`

#### UI Features

1. **Hardware Info Card**
   - Total RAM, FREE RAM (color-coded 🟢🟡🔴)
   - CPU cores, GPU detection
   - Disk space available
   - Warnings for insufficient resources

2. **Ollama Status Card**
   - Installation status
   - Running status
   - Version info
   - "Start Ollama" button if not running
   - Link to ollama.ai if not installed

3. **Installed Models List**
   - Model name, size, active indicator
   - "Use" button to switch active model
   - Delete button (🗑) for any model
   - Shows active model with "✓ ACTIVE" badge

4. **Install New Model Section**
   - Dropdown with all 10 models
   - Shows compatibility indicator (🟢🟡🔴)
   - Model description and specs
   - Real-time download progress bar
   - Install button

5. **Notifications**
   - Success/error toasts
   - Auto-dismiss after 3 seconds

### Integration Points

1. **Extension Backend Configuration**
   - `BackendSwitcher.tsx` LLM tab
   - Uses `<LlmSettings bridge="http" />`

2. **Electron App (future)**
   - Settings window
   - Uses `<LlmSettings bridge="ipc" />`

3. **App Initialization**
   - `main.ts` app.whenReady():
     - Registers LLM IPC handlers
     - Checks Ollama installation
     - Auto-starts Ollama if installed

### Installer Configuration

**electron-builder.json**:
- Bundles Ollama binary from `resources/ollama/{os}/`
- Extracts to app resources on install
- NSIS installer for Windows (customizable, desktop shortcut)
- DMG for macOS, AppImage for Linux

**scripts/download-ollama.js**:
- Pre-build script (runs before `npm run build`)
- Downloads official Ollama binaries for target OS
- Places in `resources/ollama/win|darwin|linux/`
- Makes executable on Unix systems
- Supports building for all platforms or current only

**package.json**:
- `prebuild` script: `node scripts/download-ollama.js`
- Auto-runs before `build`

## Hardware Detection Logic

### RAM Tiers

Based on **FREE RAM** (not total):

| Free RAM | Recommended Models | Tier |
|----------|-------------------|------|
| < 2 GB | None (use remote API) | Critical |
| 2-3 GB | TinyLlama, Phi-3 Mini | Lightweight |
| 3-4 GB | Mistral 7B Q4 | Balanced |
| 4-6 GB | Mistral 7B Q4/Q5, Llama 3 8B | Balanced |
| 6-8 GB | Mistral 7B full, Llama 3.1 8B | Performance |
| 8-30 GB | All 7B-8B models | Performance |
| 30-60 GB | Mixtral 8x7B | High-end |
| 60+ GB | Llama 3.1 70B, Qwen 2 72B | High-end |

### Performance Estimates

For each model + hardware combination:

- **fast**: RAM margin >= 4GB above recommended
- **usable**: RAM margin >= 1GB above recommended
- **slow**: RAM margin >= -1GB (close to minimum)
- **unusable**: RAM margin < -1GB below recommended

Speed estimates based on CPU cores (8+ cores vs. fewer).

## Model Catalog

### Lightweight (1-3GB RAM)

1. **TinyLlama 1.1B**
   - Size: 0.6 GB
   - RAM: 1-2 GB
   - Context: 2K
   - Use case: Very old hardware, fast responses

2. **Phi-3 Mini 3.8B**
   - Size: 2.3 GB
   - RAM: 2-3 GB
   - Context: 4K
   - Use case: Low-end PCs, good quality

### Balanced (3-8GB RAM)

3. **Mistral 7B Q4** (default)
   - Size: 2.6 GB
   - RAM: 3-4 GB
   - Context: 8K
   - Use case: Default, best balance

4. **Mistral 7B Q5**
   - Size: 3.2 GB
   - RAM: 4-5 GB
   - Context: 8K
   - Use case: Better quality than Q4

5. **Llama 3 8B**
   - Size: 4.7 GB
   - RAM: 5-6 GB
   - Context: 8K
   - Use case: High quality, Meta's model

### Performance (8-16GB RAM)

6. **Mistral 7B (Full Precision)**
   - Size: 4.1 GB
   - RAM: 7-8 GB
   - Context: 8K
   - Use case: Best Mistral quality

7. **Llama 3.1 8B**
   - Size: 4.7 GB
   - RAM: 6-8 GB
   - Context: 128K (!)
   - Use case: Huge context window

### High-end (16GB+ RAM)

8. **Mixtral 8x7B (MoE)**
   - Size: 26 GB
   - RAM: 24-32 GB
   - Context: 32K
   - Use case: Expert reasoning, coding

9. **Llama 3.1 70B**
   - Size: 40 GB
   - RAM: 48-64 GB
   - Context: 128K
   - Use case: Enterprise-grade

10. **Qwen 2 72B**
    - Size: 41 GB
    - RAM: 48-64 GB
    - Context: 32K
    - Use case: Multilingual, advanced reasoning

## Usage Flow

### First Run (User Experience)

1. User installs OpenGiraffe
2. Ollama is bundled, auto-extracts to app resources
3. On app launch:
   - Ollama auto-starts in background
   - Hardware check runs
   - LLM tab shows system info + recommended models
4. User opens Extension → Settings → LLM tab
5. Sees hardware info, Ollama status
6. Selects model from dropdown (sees compatibility indicator)
7. Clicks "Install Selected Model"
8. Watches real-time progress
9. Model appears in "Installed Models" list
10. Clicks "Use" to set as active
11. Ready to chat with local LLM

### Switching Models

1. User opens LLM settings
2. Sees list of installed models
3. Clicks "Use" on different model
4. Model becomes active immediately
5. Next chat uses new model

### Deleting Models

1. User opens LLM settings
2. Clicks 🗑 on any model (even active one)
3. Confirms deletion
4. Model removed, disk space freed

### Troubleshooting

#### Ollama Not Found

- UI shows "❌ Ollama not found"
- Displays link to ollama.ai
- User can manually install Ollama
- App retries detection on next start

#### Ollama Not Running

- UI shows "✅ Installed" but "❌ Not running"
- "Start Ollama" button appears
- Click to start service
- Status updates automatically

#### Insufficient RAM

- Hardware card shows warnings
- Model dropdown shows 🔴 for incompatible models
- User can still install (freedom of choice)
- Performance estimate explains risk

## Development

### Local Development

1. Install dependencies:
   ```bash
   cd apps/electron-vite-project
   npm install
   
   cd apps/extension-chromium
   npm install
   ```

2. Install Ollama manually:
   - Download from https://ollama.ai
   - Install system-wide
   - Will be detected automatically

3. Run dev mode:
   ```bash
   cd apps/electron-vite-project
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build  # Auto-downloads Ollama, builds installer
   ```

### Testing

1. **Hardware Detection**:
   - Open LLM tab
   - Verify RAM (total/free), CPU, disk shown correctly
   - Check color coding (🟢🟡🔴)

2. **Ollama Lifecycle**:
   - Check status indicator
   - Stop Ollama manually, verify "Start" button works
   - Verify auto-start on app launch

3. **Model Management**:
   - Install small model (TinyLlama)
   - Watch progress bar
   - Verify appears in installed list
   - Install second model
   - Switch between models
   - Delete one model
   - Verify disk space freed

4. **Performance Estimates**:
   - Check estimates for each model
   - Verify colors match hardware
   - Confirm warnings for unsuitable models

5. **Chat**:
   - Once model installed and active
   - Send test message via agent/chat
   - Verify response received

## Future Enhancements

1. **Model Updates**:
   - Check for model updates
   - One-click update

2. **GPU Acceleration**:
   - Detect CUDA/Metal/ROCm
   - Show GPU utilization
   - Recommend GPU-optimized models

3. **Advanced Settings**:
   - Context window size
   - Temperature, top_p, top_k
   - System prompts

4. **Model Recommendations**:
   - Task-specific recommendations
   - "Best for coding", "Best for writing", etc.

5. **Backup/Restore**:
   - Export model list
   - Restore models on new machine

6. **Multi-Instance**:
   - Run multiple models simultaneously
   - Load balancing

## Key Design Decisions

1. **FREE RAM vs. Total RAM**:
   - Previous version used total RAM
   - Users with 16GB total but only 3GB free couldn't run models
   - Now uses free RAM for accurate recommendations

2. **Ollama Bundled vs. Downloaded**:
   - Bundled in installer (low friction)
   - Fallback: guide user to manual install if bundled fails
   - Best of both worlds

3. **Multi-Model Support**:
   - Allows experimentation
   - Power users can have small+large models
   - No forced uninstall before install

4. **Bridge Abstraction**:
   - Same UI in Electron and Extension
   - DRY principle
   - Easy to add new frontends

5. **Performance Estimates**:
   - Don't disable options
   - Show advisory warnings
   - Let user decide (freedom)

6. **Headless Ollama**:
   - Runs in background
   - No console window
   - Clean UX

## Files Modified/Created

### New Files

- `apps/electron-vite-project/electron/main/llm/types.ts`
- `apps/electron-vite-project/electron/main/llm/hardware.ts`
- `apps/electron-vite-project/electron/main/llm/ollama-manager.ts`
- `apps/electron-vite-project/electron/main/llm/config.ts`
- `apps/electron-vite-project/electron/main/llm/ipc.ts`
- `apps/electron-vite-project/scripts/download-ollama.js`
- `apps/electron-vite-project/electron-builder.json`
- `apps/extension-chromium/src/components/LlmSettings.tsx`

### Modified Files

- `apps/electron-vite-project/electron/main.ts` (HTTP endpoints, initialization)
- `apps/electron-vite-project/package.json` (prebuild script)
- `apps/extension-chromium/src/components/BackendSwitcher.tsx` (LLM tab integration)

## Dependencies

No new dependencies required! Uses built-in Node.js modules:

- `os` - Hardware detection
- `child_process` - Ollama process management
- `fs` - File operations
- `path` - Path handling
- `https` - Model catalog API calls (via Ollama)

## License & Credits

- Ollama: Apache 2.0 (https://github.com/ollama/ollama)
- Models: See individual model licenses (Mistral AI, Meta, Microsoft, Alibaba)
- This integration: Same as OpenGiraffe project license

## Support

- Ollama issues: https://github.com/ollama/ollama/issues
- OpenGiraffe issues: [Your GitHub repo]/issues
- Ollama docs: https://github.com/ollama/ollama/blob/main/README.md

## Changelog

### v2.0.0 (2025-11-21)

- ✨ Complete LLM integration with Ollama
- ✨ 10-model catalog with tier-based recommendations
- ✨ Accurate hardware detection (FREE RAM focus)
- ✨ Multi-model support (install, switch, delete)
- ✨ Unified UI (Electron IPC + Extension HTTP)
- ✨ Bundled Ollama in installer
- ✨ Performance estimates per model
- ✨ Real-time download progress
- ✨ Auto-start Ollama on app launch
- ✨ Health check + repair flow


