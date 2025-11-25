# Ollama Troubleshooting Guide

## Overview
This guide helps diagnose and fix issues when running Ollama LLM models on Windows systems, especially on older or resource-constrained hardware.

## Common Issues

### 1. System Freezes or Crashes When Loading Models

**Symptoms:**
- System becomes unresponsive after selecting a model
- Application crashes immediately or after loading
- TinyLlama or Phi-3 models hang

**Causes:**
- Broken or outdated GPU/Vulkan drivers
- Insufficient RAM
- Old integrated graphics (Intel HD/UHD)
- Ollama attempting to use unstable GPU backend

**Solutions:**

#### A. Check Diagnostic Logs
1. Open the app logs folder: `%USERPROFILE%\AppData\Roaming\<YourAppName>\logs\`
2. Open `ollama-debug.log`
3. Look for lines starting with `[HardwareDiagnostics]` to see detected hardware
4. Check for warnings about Vulkan or GPU

#### B. Force CPU-Only Mode
If GPU/Vulkan is causing crashes:

1. The app should automatically detect and switch to CPU mode
2. Check logs for: `Starting in CPU-only mode (GPU/Vulkan unhealthy)`
3. If not, manually force CPU mode:
   - Set environment variable: `OLLAMA_NO_GPU=1`
   - Restart the application

#### C. Update Graphics Drivers
1. **Intel:** Download from [intel.com/content/www/us/en/download-center](https://www.intel.com/content/www/us/en/download-center/home.html)
2. **NVIDIA:** Download from [nvidia.com/Download/index.aspx](https://www.nvidia.com/Download/index.aspx)
3. **AMD:** Download from [amd.com/en/support](https://www.amd.com/en/support)

#### D. Use Smaller Models
For systems with <8GB RAM or old CPUs:
- **Ultra-light:** `tinyllama` (0.6GB)
- **Light:** `phi3-low` (custom optimized, 2.3GB)
- **Avoid:** Models >4GB like Mistral 7B

---

### 2. "Model Load Timeout" Errors

**Symptoms:**
- Chat fails with "Model loading timed out"
- Long delays (>60s) before error

**Causes:**
- Insufficient RAM
- Too many background applications
- Model too large for system

**Solutions:**

#### A. Free Up RAM
1. Close unnecessary applications (browsers, IDEs)
2. Disable startup programs
3. Restart your computer before using the app

#### B. Reduce Model Context Size
The app automatically adjusts based on detected RAM:
- <8GB RAM: Context = 512, Batch = 8
- 8-16GB RAM: Context = 1024, Batch = 16
- >16GB RAM: Context = 2048+, Batch = 32+

**Manual Override (Advanced):**
Edit Modelfile for custom models to add:
```
PARAMETER num_ctx 512
PARAMETER num_batch 8
PARAMETER num_threads 2
```

#### C. Switch to Smaller Quantization
Models come in different sizes (quantization levels):
- **q2_K** - Smallest, lowest quality (~50% reduction)
- **q4_K_M** - Balanced (default)
- **q5_K_M** - Higher quality, larger size

For weak systems, prefer q2_K or q4_K variants.

---

### 3. "GPU/Vulkan Driver Unstable" Warning

**Symptoms:**
- Log shows: `Vulkan likely unstable`
- System freezes intermittently

**Specific Hardware Issues:**

#### Intel HD 2000/3000/4000 Series
These old iGPUs have poor Vulkan support:
1. **Solution:** CPU-only mode (automatic)
2. **Alternative:** Update to latest Intel drivers (may help)

#### NVIDIA Optimus Laptops
Ollama may try to use integrated GPU instead of dedicated:
1. Open NVIDIA Control Panel
2. Manage 3D Settings → Program Settings
3. Add `ollama.exe`
4. Select "High-performance NVIDIA processor"

#### AMD APU Systems
Some AMD integrated graphics have Vulkan issues:
1. Update to latest AMD drivers
2. If issues persist, force CPU mode

---

### 4. "Ollama Install Corrupted" Error

**Symptoms:**
- Cannot start Ollama service
- `ollama --version` fails
- Models don't load at all

**Solutions:**

#### A. Verify Installation
```powershell
# Open PowerShell and run:
ollama --version
ollama list
```

If these fail, reinstall Ollama.

#### B. Reinstall Ollama
1. Download latest from [ollama.ai/download](https://ollama.ai/download)
2. Uninstall existing:
   - Windows Settings → Apps → Ollama → Uninstall
3. Delete leftover files:
   - `%LOCALAPPDATA%\Programs\Ollama`
   - `%USERPROFILE%\.ollama`
4. Install fresh copy
5. Restart your app

#### C. Check Ollama is Running
```powershell
# Check if Ollama service is running:
Get-Process | Where-Object {$_.Name -like "*ollama*"}

# If not, start manually:
ollama serve
```

---

### 5. Slow Performance Even with Small Models

**Symptoms:**
- TinyLlama takes >30s per response
- System feels sluggish

**Causes:**
- Too many threads (CPU thrashing)
- Background processes consuming resources
- Old hard drive (HDD vs SSD)

**Solutions:**

#### A. Reduce Thread Count
The app auto-detects, but for very old CPUs:
- Systems with <4 cores: Limit to 2 threads
- Celeron/Pentium/Atom: Limit to 1-2 threads

#### B. Close Background Apps
Check Task Manager (Ctrl+Shift+Esc):
- Browsers (Chrome/Edge use lots of RAM)
- IDEs (VS Code, Visual Studio)
- Communication apps (Discord, Slack)
- Gaming clients (Steam, Epic)

#### C. Check Disk Space
Ollama models need space:
- Ensure >10GB free on C: drive
- If low, move Ollama models to another drive:
  ```powershell
  # Set environment variable:
  $env:OLLAMA_MODELS = "D:\ollama-models"
  ```

---

## System Requirements

### Minimum (Ultra-Light Models Only)
- CPU: Dual-core 2.0GHz+
- RAM: 4GB (8GB recommended)
- Storage: 5GB free
- OS: Windows 10 64-bit

### Recommended (Most Models)
- CPU: Quad-core 2.5GHz+
- RAM: 16GB
- GPU: Any with Vulkan support
- Storage: 20GB+ free SSD

### Optimal (All Models)
- CPU: 8+ cores 3.0GHz+
- RAM: 32GB+
- GPU: NVIDIA RTX or AMD RX 6000+
- Storage: 50GB+ SSD

---

## Diagnostic Commands

Run these in PowerShell to gather info for support:

```powershell
# System info
systeminfo | findstr /C:"OS" /C:"System Type" /C:"Total Physical Memory"

# CPU info
wmic cpu get name,numberofcores,numberoflogicalprocessors

# GPU info
wmic path win32_VideoController get name,AdapterCompatibility,AdapterRAM

# Check Vulkan
vulkaninfo --summary

# Ollama version
ollama --version

# List models
ollama list

# Check Ollama process
Get-Process | Where-Object {$_.Name -like "*ollama*"}
```

---

## Log File Locations

- **Ollama Debug Log:** `%USERPROFILE%\AppData\Roaming\<YourAppName>\logs\ollama-debug.log`
- **Ollama Service Log:** `%USERPROFILE%\.ollama\logs\server.log`
- **Rotating Logs:** `ollama-debug.log.1`, `ollama-debug.log.2`, etc.

---

## Quick Fix Checklist

When experiencing issues, try these in order:

- [ ] Restart the application
- [ ] Check diagnostic logs for warnings
- [ ] Update graphics drivers
- [ ] Close other applications
- [ ] Restart computer
- [ ] Switch to smaller model (TinyLlama)
- [ ] Force CPU-only mode (set `OLLAMA_NO_GPU=1`)
- [ ] Reinstall Ollama
- [ ] Check disk space
- [ ] Verify Ollama service is running

---

## Getting Help

If issues persist after trying all solutions:

1. **Collect diagnostic info:**
   - Hardware specs (CPU, RAM, GPU)
   - Diagnostic log (`ollama-debug.log`)
   - Ollama version
   - Exact error message

2. **Report issue with:**
   - What you were doing when it failed
   - Which model you were using
   - Any error messages
   - Diagnostic logs

---

## Advanced: Manual Model Optimization

For developers or advanced users, create a custom optimized Modelfile:

```dockerfile
# Modelfile.ultralow
FROM tinyllama

PARAMETER num_ctx 256        # Minimal context
PARAMETER num_batch 4        # Tiny batch
PARAMETER num_threads 1      # Single thread
PARAMETER temperature 0.7

SYSTEM You are a helpful assistant optimized for low-resource systems.
```

Create the model:
```bash
ollama create ultralow -f Modelfile.ultralow
```

Use it:
```bash
ollama run ultralow
```

---

## FAQ

**Q: Why does the app auto-select CPU mode?**  
A: Hardware diagnostics detected unstable GPU/Vulkan. This prevents freezes/crashes.

**Q: Can I force GPU mode if CPU is too slow?**  
A: Yes, but risky if Vulkan is broken. Set `OLLAMA_NO_GPU=0` and update drivers first.

**Q: What's the smallest usable model?**  
A: TinyLlama (0.6GB) works on almost any system, though quality is limited.

**Q: Will a faster SSD help?**  
A: Yes, model loading is much faster on SSD vs HDD, especially for large models.

**Q: Can I run this on a laptop from 2015?**  
A: Maybe. Use TinyLlama or Phi-3 Low in CPU mode. Expect 10-30s per response.

---

**Last Updated:** 2025-11-21  
**App Version:** 1.0.0







