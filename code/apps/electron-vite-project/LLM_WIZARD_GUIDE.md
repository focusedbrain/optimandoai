# LLM Setup Wizard - Complete Installation Guide

## Overview

The LLM Setup Wizard provides a comprehensive, user-friendly first-run experience for installing and configuring local AI models in OpenGiraffe. It automatically detects hardware capabilities, guides users through Ollama installation, allows model selection, and handles the complete setup process.

## Features

### 1. **Welcome Screen**
- Introduces users to local AI capabilities
- Explains what will happen during setup
- Estimated time: 5-15 minutes
- Option to skip setup for later

### 2. **Hardware Compatibility Check**
- **System Detection:**
  - Total RAM (GB)
  - CPU core count
  - Operating system
  - GPU information (if available)

- **Compatibility Analysis:**
  - Determines if system can run specific models
  - Provides RAM tier classification:
    - `< 8 GB` → Limited resources (lightweight models only)
    - `8-16 GB` → Standard (Mistral 7B recommended)
    - `>= 16 GB` → High performance (Mistral 14B available)
  
- **Warnings and Recommendations:**
  - Alerts for insufficient resources
  - Model suggestions based on hardware
  - Performance impact notifications

### 3. **Ollama Installation**
- **Automatic Detection:**
  - Checks if Ollama is already installed
  - Verifies Ollama server is accessible
  
- **Guided Installation:**
  - Opens official Ollama website
  - Step-by-step instructions for user's OS
  - Verification after installation
  - Retry mechanism

### 4. **Model Selection**
Four pre-configured model options:

| Model | Size | RAM Required | Description |
|-------|------|--------------|-------------|
| **Phi-3 Mini** | ~2.3 GB | 4 GB | Lightweight for limited resources |
| **Mistral 7B** ⭐ | ~4 GB | 8 GB | **Recommended** - Balanced performance |
| **Llama 3 8B** | ~4.7 GB | 8 GB | High-quality responses |
| **Mistral 14B** | ~8 GB | 16 GB | Advanced model for powerful systems |

- **Smart Filtering:**
  - Models requiring more RAM than available are disabled
  - Recommended model is highlighted
  - Clear indicators for insufficient resources

### 5. **Download & Installation**
- **Real-time Progress:**
  - Progress bar (0-100%)
  - Status messages
  - Download size and speed (when available)
  
- **Automatic Steps:**
  1. Start Ollama server
  2. Download selected model
  3. Verify installation
  4. Save configuration
  5. Mark setup as complete

- **Error Handling:**
  - Clear error messages
  - Retry button on failure
  - Progress preservation

### 6. **Completion**
- Success confirmation
- Summary of what was installed
- Next steps guidance
- Option to start using the app

## Technical Implementation

### Component: `LlmSetupWizard.tsx`

**Location:** `apps/electron-vite-project/src/components/llm/LlmSetupWizard.tsx`

**Props:**
```typescript
interface LlmSetupWizardProps {
  onComplete: () => void    // Called when setup succeeds
  onSkip?: () => void       // Optional skip callback
}
```

**State Machine:**
```typescript
type WizardStep = 
  | 'welcome'        // Initial introduction
  | 'hardware'       // Hardware check and compatibility
  | 'ollama'         // Ollama installation guide
  | 'model-select'   // Model selection
  | 'download'       // Download and installation
  | 'complete'       // Success confirmation
```

### Integration in `App.tsx`

**First-Run Detection:**
```typescript
useEffect(() => {
  const setupComplete = localStorage.getItem('llm-setup-complete')
  if (!setupComplete) {
    setShowWizard(true)
  }
}, [])
```

**Wizard Lifecycle:**
- Shows automatically on first app launch
- Blocks main UI until complete or skipped
- Can be re-run from Settings
- Persists completion state in localStorage

### IPC Communication

**Exposed APIs (via `window.llm`):**
```typescript
// Hardware check
llm.checkHardware(): Promise<HardwareInfo>

// Ollama management
llm.getStatus(): Promise<OllamaStatus>
llm.startOllama(): Promise<void>

// Model management
llm.downloadModel(modelId: string): Promise<void>
llm.listModels(): Promise<Model[]>

// Configuration
llm.updateConfig(config: Partial<LlmConfig>): Promise<void>
llm.getConfig(): Promise<LlmConfig>

// Progress events
llm.onDownloadProgress((progress: DownloadProgress) => void)
```

## User Flow Diagram

```
┌─────────────┐
│   Welcome   │
│   Screen    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Hardware   │──► Warnings if RAM < 8 GB
│    Check    │──► Recommendations displayed
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Ollama    │
│ Installed?  │
└──┬───────┬──┘
   │ No    │ Yes
   ▼       │
┌─────────────┐│
│  Install    ││
│   Ollama    ││
└──────┬──────┘│
       │       │
       └───┬───┘
           ▼
┌─────────────┐
│   Model     │──► Shows 4 model options
│  Selection  │──► Disables incompatible models
└──────┬──────┘──► Highlights recommended
       │
       ▼
┌─────────────┐
│  Download   │──► Real-time progress bar
│  & Install  │──► Status messages
└──────┬──────┘──► Error handling & retry
       │
       ▼
┌─────────────┐
│  Complete!  │──► Success message
│             │──► Start using app
└─────────────┘
```

## Configuration Storage

**Location:** `localStorage` (persisted across sessions)

**Keys:**
- `llm-setup-complete`: `"true"` | `"skipped"` | `undefined`

**Additional Config:** Managed by `llmConfigService`:
- Model selection
- Ollama endpoint
- Auto-start preferences
- Stored in: `<userData>/llm-config.json`

## Re-running the Wizard

Users can re-run the setup wizard at any time:

1. Open **Settings** (gear icon)
2. Scroll to bottom of Settings modal
3. Click **"🔄 Re-run LLM Setup Wizard"**
4. Wizard will restart from welcome screen

This is useful for:
- Switching to a different model
- Fixing installation issues
- Reconfiguring after hardware upgrade

## Model Management

### Adding New Models

To add new models, update `MODEL_OPTIONS` in `LlmSetupWizard.tsx`:

```typescript
const MODEL_OPTIONS: ModelOption[] = [
  // ... existing models ...
  {
    id: 'your-model-id',
    name: 'Your Model Name',
    size: '~X.X GB',
    ramRequired: X,
    recommended: false,
    description: 'Brief description'
  }
]
```

### Model Metadata

Each model includes:
- **id**: Ollama model identifier (e.g., `mistral:7b`)
- **name**: Display name
- **size**: Download size (approximate)
- **ramRequired**: Minimum RAM in GB
- **recommended**: Boolean flag for default
- **description**: User-friendly explanation

## Testing

### Manual Testing Checklist

1. **First Run:**
   - [ ] Wizard appears on first launch
   - [ ] Hardware check shows correct specs
   - [ ] Compatibility warnings display properly

2. **Ollama Detection:**
   - [ ] Detects when Ollama is not installed
   - [ ] Opens download link correctly
   - [ ] Verifies installation after retry

3. **Model Selection:**
   - [ ] All models display correctly
   - [ ] Incompatible models are disabled
   - [ ] Recommended model is highlighted
   - [ ] Selection updates properly

4. **Download Process:**
   - [ ] Progress bar updates in real-time
   - [ ] Status messages are clear
   - [ ] Error handling works
   - [ ] Retry button functions

5. **Completion:**
   - [ ] Success screen displays
   - [ ] Config is saved
   - [ ] App becomes usable
   - [ ] Setup doesn't repeat on restart

6. **Re-run:**
   - [ ] Wizard can be reopened from Settings
   - [ ] Previous config is preserved until changed
   - [ ] New model selection works

### Testing with Limited RAM

To test low-RAM scenarios:
- Mistral 14B should be disabled on systems with < 16 GB
- Warnings should appear for systems with < 8 GB
- Phi-3 Mini should be the only option for < 4 GB systems

## Troubleshooting

### Wizard Doesn't Appear

**Solution:** Clear localStorage:
```javascript
localStorage.removeItem('llm-setup-complete')
```
Then refresh the app.

### Hardware Check Fails

**Cause:** IPC handler not registered or hardware service issue

**Solution:**
1. Check console for errors
2. Verify `registerLlmHandlers()` is called in `main.ts`
3. Ensure `systeminformation` package is installed

### Model Download Hangs

**Possible Causes:**
- Ollama server not running
- Network connectivity issues
- Insufficient disk space

**Solutions:**
1. Verify Ollama is running: `ollama serve`
2. Check network connection
3. Ensure adequate disk space
4. Try downloading manually: `ollama pull model-name`

### Ollama Not Detected After Install

**Solution:**
1. Restart the app completely
2. Check if Ollama is in PATH
3. Try manual verification: `ollama --version`
4. Restart the computer (Windows/macOS may require this)

## Future Enhancements

### Planned Features
- [ ] **Custom Model URLs**: Allow users to add custom Ollama models
- [ ] **Offline Mode**: Bundle models for air-gapped installations
- [ ] **Benchmark Testing**: Run quick performance tests during setup
- [ ] **GPU Acceleration**: Detect and configure GPU support
- [ ] **Model Comparison**: Side-by-side model comparisons
- [ ] **Partial Downloads**: Resume interrupted downloads
- [ ] **Disk Space Check**: Warn before downloading large models
- [ ] **Bandwidth Estimation**: Show estimated download time

### Model Expansion
- Add smaller models for ultra-low-resource systems
- Include specialized models (code, vision, etc.)
- Support for model quantization options (4-bit, 8-bit, etc.)
- Model performance ratings based on benchmarks

## Architecture Notes

### Why This Approach?

1. **First-Run Focus:** 
   - Users get immediate, guided setup
   - Reduces friction in getting started
   - Educational about local AI capabilities

2. **Hardware-Aware:**
   - Prevents users from selecting incompatible models
   - Manages expectations based on system capabilities
   - Provides clear upgrade paths

3. **Flexible:**
   - Can be skipped by advanced users
   - Can be re-run for reconfiguration
   - Supports future model additions

4. **User-Friendly:**
   - Clear step-by-step process
   - Real-time feedback
   - Helpful error messages
   - No technical jargon

## Related Files

- **Wizard Component:** `src/components/llm/LlmSetupWizard.tsx`
- **App Integration:** `src/App.tsx`
- **IPC Handlers:** `electron/main/llm/ipc.ts`
- **Hardware Service:** `electron/main/llm/hardware.ts`
- **Ollama Manager:** `electron/main/llm/ollama-manager.ts`
- **Config Service:** `electron/main/llm/config.ts`
- **Type Definitions:** `electron/main/llm/types.ts`

## Support

For issues or questions:
1. Check the console for error messages
2. Review `LLM_INTEGRATION.md` for technical details
3. Verify Ollama installation: https://ollama.ai
4. Check system requirements match selected model

