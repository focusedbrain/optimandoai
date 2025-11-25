# Integration Guide: Enhanced Ollama Manager

## Overview
This document explains how to integrate the new enhanced Ollama Manager with hardware diagnostics, auto-fallback, and hang protection.

## New Files Created

1. **`hardware-diagnostics.ts`** - Hardware detection and resource recommendations
2. **`rotating-logger.ts`** - Rotating log system for debug logs
3. **`ollama-manager-enhanced.ts`** - Enhanced Ollama manager with all new features
4. **`docs/ollama-troubleshoot.md`** - User-facing troubleshooting guide

## Integration Steps

### Step 1: Replace the Old Manager

**Option A: Direct Replacement**
```bash
# Backup old file
mv apps/electron-vite-project/electron/main/llm/ollama-manager.ts apps/electron-vite-project/electron/main/llm/ollama-manager.old.ts

# Rename enhanced version
mv apps/electron-vite-project/electron/main/llm/ollama-manager-enhanced.ts apps/electron-vite-project/electron/main/llm/ollama-manager.ts
```

**Option B: Gradual Migration**
Keep both files and update imports in `main.ts`:
```typescript
// Change this:
import { ollamaManager } from './main/llm/ollama-manager'

// To this:
import { ollamaManager } from './main/llm/ollama-manager-enhanced'
```

### Step 2: Update Main Initialization

In `apps/electron-vite-project/electron/main.ts`, update the LLM initialization section:

```typescript
// Find this section (around line 528-556):
// Initialize LLM services
try {
  console.log('[MAIN] ===== INITIALIZING LLM SERVICES =====')
  const { registerLlmHandlers } = await import('./main/llm/ipc')
  const { ollamaManager } = await import('./main/llm/ollama-manager-enhanced')
  
  // Register IPC handlers
  registerLlmHandlers()
  console.log('[MAIN] LLM IPC handlers registered')
  
  // NEW: Run hardware diagnostics first
  await ollamaManager.initialize()
  console.log('[MAIN] Hardware diagnostics complete')
  
  // Check if Ollama is installed and auto-start if configured
  const installed = await ollamaManager.checkInstalled()
  console.log('[MAIN] Ollama installed:', installed)
  
  if (installed) {
    try {
      await ollamaManager.start()
      console.log('[MAIN] Ollama started successfully')
      
      // NEW: Log health status
      const health = ollamaManager.getHealthStatus()
      console.log('[MAIN] Ollama health:', health)
    } catch (error) {
      console.warn('[MAIN] Failed to auto-start Ollama:', error)
      // Not critical, user can start manually
    }
  } else {
    console.warn('[MAIN] Ollama not found - repair flow will be needed')
  }
} catch (error) {
  console.error('[MAIN] Error initializing LLM services:', error)
  // Continue app startup even if LLM init fails
}
```

### Step 3: Add Health Status API Endpoint

Add a new endpoint to expose diagnostics to the frontend:

```typescript
// In main.ts, add this to your HTTP server routes:
router.get('/api/llm/health', async (req, res) => {
  try {
    const health = ollamaManager.getHealthStatus()
    res.json({ 
      ok: true, 
      ...health 
    })
  } catch (error: any) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    })
  }
})
```

### Step 4: Update Frontend to Show Diagnostics

In `LlmSettings.tsx`, add a health status section:

```typescript
const [healthStatus, setHealthStatus] = useState<any>(null)

useEffect(() => {
  async function loadHealth() {
    try {
      const res = await fetch('http://127.0.0.1:51248/api/llm/health')
      if (res.ok) {
        const data = await res.json()
        setHealthStatus(data)
      }
    } catch (error) {
      console.error('Failed to load health status:', error)
    }
  }
  loadHealth()
}, [])

// In the UI:
{healthStatus?.cpuFallbackMode && (
  <div className="bg-yellow-100 p-3 rounded-md">
    ⚠️ Running in CPU-only mode due to GPU/Vulkan issues
  </div>
)}

{healthStatus?.diagnostics?.recommendations?.warnings?.map((w: string, i: number) => (
  <div key={i} className="text-sm text-yellow-700">{w}</div>
))}
```

### Step 5: Update Chat Error Display

In `sidepanel.tsx`, improve error messages:

```typescript
// The new manager returns user-friendly error messages
// Just display them directly:
if (!res.ok) {
  setLlmError(res.error || 'Chat failed')
}
```

### Step 6: Add Log Viewer (Optional)

Create a simple log viewer UI:

```typescript
// Add button in LlmSettings
<button onClick={async () => {
  const health = await fetch('http://127.0.0.1:51248/api/llm/health').then(r => r.json())
  window.open(health.logPath, '_blank')
}}>
  View Debug Logs
</button>
```

## Testing

### Manual Testing Checklist

- [ ] App starts successfully
- [ ] Hardware diagnostics run on startup (check console)
- [ ] TinyLlama installs and runs without freezing
- [ ] Phi-3 Low runs without freezing
- [ ] Error messages are user-friendly
- [ ] CPU fallback activates if GPU unstable
- [ ] Logs are written to `ollama-debug.log`
- [ ] Log files rotate at 5MB

### Test on Weak Hardware

If you have access to a low-spec system:
- Windows 10 with 4GB RAM
- Intel HD Graphics or similar
- Old dual-core CPU

Expected behavior:
1. Diagnostics detect weak hardware
2. Automatically uses CPU mode
3. Sets conservative defaults (ctx=512, batch=8)
4. Recommends q2_K quantization
5. TinyLlama runs successfully (slow but stable)

### Test Hang Protection

Simulate a hang:
1. Try loading a very large model (e.g., 13B+ on weak hardware)
2. Watchdog should trigger after 90 seconds
3. User-friendly timeout error should appear
4. App should remain responsive (not freeze)

## Monitoring Logs

Check `ollama-debug.log` for:

```
[2025-11-21T...] [INFO] [HardwareDiagnostics] ===== SYSTEM DIAGNOSTICS =====
[2025-11-21T...] [INFO] [HardwareDiagnostics] CPU: Intel(R) Core(TM) i5-7200U
[2025-11-21T...] [INFO] [HardwareDiagnostics] RAM: 8.0GB total
[2025-11-21T...] [WARN] [HardwareDiagnostics] Vulkan Issues: Old Intel integrated GPU
[2025-11-21T...] [WARN] [OllamaManager] Starting in CPU-only mode
[2025-11-21T...] [INFO] [OllamaManager] Chat completed for tinyllama
```

## Rollback Plan

If issues occur:

1. **Revert to old manager:**
   ```bash
   mv apps/electron-vite-project/electron/main/llm/ollama-manager.ts apps/electron-vite-project/electron/main/llm/ollama-manager-new.ts
   mv apps/electron-vite-project/electron/main/llm/ollama-manager.old.ts apps/electron-vite-project/electron/main/llm/ollama-manager.ts
   ```

2. **Remove diagnostics import from main.ts**

3. **Rebuild and restart app**

## Performance Impact

- **Startup:** +1-2 seconds for hardware diagnostics
- **First chat:** Same or faster (optimized defaults)
- **Subsequent chats:** No difference
- **Memory:** +~5MB for diagnostics caching
- **Disk:** Logs rotate, max ~15MB total

## Configuration

All defaults are automatic, but advanced users can override:

```typescript
// In config file or environment:
OLLAMA_NO_GPU=1              // Force CPU mode
OLLAMA_NUM_CTX=512           // Override context size
OLLAMA_NUM_BATCH=8           // Override batch size
OLLAMA_NUM_THREADS=2         // Override thread count
```

## FAQ

**Q: Will this slow down startup?**  
A: Slightly (1-2s), but it prevents crashes and hangs that take much longer to recover from.

**Q: Does it work on macOS/Linux?**  
A: Yes, but GPU detection is limited. Windows has the most comprehensive diagnostics.

**Q: What if diagnostics are wrong?**  
A: Users can manually override via environment variables. Logs show detected values.

**Q: Can I disable auto-fallback?**  
A: Not recommended, but possible by modifying `ollama-manager-enhanced.ts` to skip the `if (!this.cpuFallbackMode)` retry logic.

---

## Support

Point users to `docs/ollama-troubleshoot.md` for common issues and solutions.

Collect these from users reporting issues:
1. Hardware specs
2. `ollama-debug.log` contents
3. Ollama version
4. Model being used







