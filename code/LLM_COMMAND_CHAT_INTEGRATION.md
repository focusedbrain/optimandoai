# LLM Command Chat Integration

## Overview
This document describes the integration of the Ollama API with the Command Chat interface in the sidepanel. The system now **automatically detects and installs** a lightweight LLM model on first use!

## Branch
- **Branch Name**: `llm-wiring`
- **Status**: ✅ Complete with Auto-Installation

## 🎯 Key Features

### 1. **Automatic Model Detection**
On first load, the Command Chat:
- Checks if Ollama is running
- Detects any installed models
- Auto-selects the first available model

### 2. **Automatic Model Installation** (NEW!)
If no models are installed, the system will:
- **Automatically install Phi-3 Mini (2.3GB)** - A lightweight, fast model
- Show progress message to the user
- Enable chat functionality once installation completes
- Display a success message when ready

### 3. **Intelligent Error Handling**
Provides helpful guidance when:
- Ollama is not running
- No models are available
- Installation fails
- Network errors occur

## Changes Made

### 1. Added LLM State Management
Added state variables to track:
```typescript
const [activeLlmModel, setActiveLlmModel] = useState<string>('')
const [isLlmLoading, setIsLlmLoading] = useState(false)
const [llmError, setLlmError] = useState<string | null>(null)
```

### 2. Auto-Detection and Installation on Mount
The `useEffect` hook now:
- Fetches Ollama status
- Checks for installed models
- **Auto-installs Phi-3 Mini if no models exist**
- Displays status messages to guide the user

### 3. Enhanced `handleSendMessage` Function
**Before:**
- Simple async API call
- Generic error messages

**After:**
- Pre-checks if model is available
- Provides step-by-step instructions for setup
- Handles "no models" scenario gracefully
- Parses backend error messages for better UX
- Shows helpful tips based on error type

**API Endpoint:**
- URL: `http://127.0.0.1:51248/api/llm/chat`
- Method: POST
- Payload: 
  ```json
  {
    "modelId": "auto-detected or phi3:mini",
    "messages": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ]
  }
  ```

### 4. Enhanced UI with Loading Indicators
Updated all three Send buttons to show:
- **Loading state**: "⏳ Thinking..." with gray background
- **Disabled state**: When loading or input is empty
- **Visual feedback**: Opacity changes, no hover effects during loading

### 5. Comprehensive Error Messages
Error messages now include:
- **No models installed**: Step-by-step setup guide
- **Ollama not running**: Instructions to start from LLM Settings
- **Network errors**: Tips for troubleshooting
- **Model installation progress**: Real-time updates

## Default Behavior

### First Launch (No Models Installed)
1. User opens Command Chat
2. System detects no models
3. **Automatically begins installing Phi-3 Mini**
4. Shows: "Installing lightweight model (Phi-3 Mini)... This may take a few minutes."
5. Once complete: "✅ Phi-3 Mini model installed successfully! You can now start chatting."

### Subsequent Launches
1. System auto-detects installed model
2. Chat is immediately ready to use
3. No user intervention required

## Why Phi-3 Mini?

**Phi-3 Mini** was chosen as the default auto-install model because:
- ✅ **Small size**: Only 2.3GB (vs 4-5GB for larger models)
- ✅ **Fast**: Works well on older hardware
- ✅ **Capable**: Surprisingly good quality from Microsoft
- ✅ **Low RAM**: Only requires 2-3GB RAM
- ✅ **Good balance**: Speed + quality for most tasks

Users can still install other models (TinyLlama, Mistral, etc.) through LLM Settings.

## Testing

The integration now works seamlessly:

1. **First-time user experience:**
   - Open Command Chat
   - Wait for auto-installation (~2-3 minutes)
   - Start chatting!

2. **Returning user experience:**
   - Open Command Chat
   - Chat immediately (model already installed)

3. **Manual model management:**
   - Go to Admin panel → LLM Settings
   - Install/remove models as desired
   - Command Chat auto-detects changes

## Error Scenarios

The system gracefully handles:

| Scenario | Behavior |
|----------|----------|
| No models installed | Auto-installs Phi-3 Mini |
| Ollama not running | Shows instructions to start it |
| Network error | Provides troubleshooting tips |
| Model installation fails | Guides user to manual installation |
| Model too slow | Error message suggests lighter alternatives |

## Files Modified
- `apps/extension-chromium/src/sidepanel.tsx` - Main integration + auto-install
- `LLM_COMMAND_CHAT_INTEGRATION.md` - This documentation

## Future Enhancements
Potential improvements:
1. **Progress bar** during model installation
2. **Model selector dropdown** in Command Chat header
3. **Streaming responses** for real-time feedback
4. **Message editing** and regeneration
5. **Hardware detection** to recommend optimal model
6. **Background model updates** when newer versions available
7. **Memory management** to prevent context overflow

## Technical Notes

- The auto-installation happens **once** on first launch
- Installation is **non-blocking** - user sees progress
- The system **always prefers existing models** over installing new ones
- Backend API at port 51248 must be running (Electron app)
- Installation requires internet connection for model download

