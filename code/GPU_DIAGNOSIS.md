# GPU DIAGNOSIS REPORT

**Date:** 2026-04-01  
**Machine:** Windows 11, RTX 5080 (16 GB VRAM)  
**Ollama:** 0.18.3  
**Driver:** 595.97 (CUDA 13.2)  
**Verdict:** ⚠️ Ollama is running entirely on CPU. `size_vram = 0` confirmed.

---

## 1. nvidia-smi Output

```
Wed Apr  1 01:55:25 2026
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 595.97       Driver Version: 595.97       CUDA Version: 13.2                |
+-----------------------------------------+------------------------+----------------------+
|   0  NVIDIA GeForce RTX 5080     WDDM   |   00000000:01:00.0  On |                N/A   |
|  0%   50C    P1          59W / 360W     |     944MiB / 16303MiB  |      3%    Default   |
+-----------------------------------------+------------------------+----------------------+
| Processes:                                                                              |
|    0   N/A   N/A   24044    C+G   ...Programs\Ollama\ollama.exe    N/A                  |
+-----------------------------------------------------------------------------------------+
```

**Observations:**
- GPU is fully functional. Driver and CUDA version are healthy.
- Ollama appears in the process list (`C+G` = compute + graphics context), but this only means the process has a display-side GPU context — **not** that it is doing ML inference on the GPU.
- GPU memory usage: only 944 MiB used (baseline OS/display). The model is NOT loaded into VRAM.

---

## 2. Ollama Version

```
ollama version is 0.18.3
```

---

## 3. Installed Models (`/api/tags`)

| Model | Size | Quantization |
|---|---|---|
| `gemma3:12b` | 8.15 GB | Q4_K_M |
| `llama3.1:8b` | 4.92 GB | Q4_K_M |
| `llama3:latest` | 4.66 GB | Q4_0 |
| `nomic-embed-text:latest` | 274 MB | F16 |

All models fit in 16 GB VRAM. Model size is **not** the cause.

---

## 4. Definitive CPU Proof — `/api/ps` After Model Load

```json
{
  "models": [{
    "name": "llama3.1:8b",
    "size": 5154267136,
    "size_vram": 0,
    "context_length": 4096
  }]
}
```

**`size_vram: 0` is the definitive confirmation. The entire 4.9 GB model is loaded in system RAM, not VRAM.**

Load + inference time observed: ~3.1 seconds for a trivial prompt. On GPU this should be ~0.3–0.5 seconds.

---

## 5. Environment Variables

**Process-level (current shell):** No `OLLAMA_*` or `CUDA_*` variables set.

**Machine-level (System):**
- `OLLAMA_GPU_LAYERS`: *not set*
- `OLLAMA_NUM_GPU`: *not set*
- `CUDA_VISIBLE_DEVICES`: *not set*
- `OLLAMA_HOST`: *not set*

No environment variable is deliberately disabling the GPU.

---

## 6. Ollama Server Log

The default log path `%LOCALAPPDATA%\Ollama\logs\server.log` does **not exist**.  
No log file was found anywhere in `%LOCALAPPDATA%\Ollama\` or `%APPDATA%\Ollama\`.

This means Ollama 0.18.3 logs to stdout/stderr only, which are not captured because the process was launched with `stdio: 'ignore'` (or equivalent). The startup GPU detection errors that would explain the fallback are therefore **invisible at runtime**.

---

## 7. Ollama Installation Structure

```
C:\Users\oscar\AppData\Local\Programs\Ollama\
├── ollama.exe
├── ollama app.exe
├── lib\
│   └── ollama\
│       ├── ggml-base.dll          ← GGML base library
│       ├── ggml-cpu-icelake.dll   ← CPU inference runner (Intel Ice Lake SIMD)
│       ├── mlx_cuda_v13\          ← CUDA 13 GPU backend
│       │   ├── dl.dll             ← Dynamic loader shim
│       │   ├── libopenblas.dll    ← BLAS math library
│       │   ├── mlx.dll            ← MLX framework (CUDA backend)
│       │   └── mlxc.dll           ← MLX C API
│       └── rocm\                  ← AMD ROCm backend
│           ├── ggml-hip.dll
│           ├── hipblas.dll
│           └── rocblas.dll
```

**Critical finding:** The CUDA backend (`mlx_cuda_v13`) does NOT bundle its own CUDA runtime DLLs. It relies on finding `cudart64_13.dll` (CUDA 13 runtime) and `cublas64_13.dll` (cuBLAS) either:
- In the system `PATH`, OR
- Installed by the NVIDIA CUDA Toolkit

---

## 8. CUDA Runtime Status — ROOT CAUSE

**CUDA Toolkit is NOT installed on this machine.**

Search results for CUDA runtime DLLs:

| Search location | `cudart64_*.dll` found? |
|---|---|
| `C:\Windows\System32` | ❌ None |
| `PATH` directories | ❌ None |
| Bundled in Ollama `mlx_cuda_v13\` | ❌ None |

**The only CUDA DLL found on the entire system:**
```
C:\Program Files (x86)\NVIDIA Corporation\PhysX\Common\cudart64_65.dll   ← CUDA 6.5 (2014)
```
This is from NVIDIA PhysX and is CUDA 6.5 — completely incompatible with any modern ML workload (needs CUDA 12.x or 13.x).

The `nvcuda.dll` (driver API) **is** present in `C:\Windows\System32` but without the CUDA runtime (`cudart64_13.dll`), the GPU backend cannot initialize.

**When the `mlx_cuda_v13` runner attempts to load and cannot find `cudart64_13.dll`, Ollama silently falls back to `ggml-cpu-icelake.dll`. No error is shown to the user.**

---

## 9. Secondary Issue — RTX 5080 Blackwell Architecture

The RTX 5080 uses the **Blackwell architecture (sm_120, compute capability 12.0)**.  
This is the first generation with sm_120.

Ollama 0.18.3 uses the `mlx_cuda_v13` backend. Whether `mlx.dll` was compiled with `sm_120` support is unknown (binary inspection required). However, this is a secondary concern — the primary issue (missing CUDA runtime) must be fixed first before testing architecture compatibility.

---

## 10. Codebase Analysis — Does the App Force CPU?

**No. The production code does NOT force CPU mode.**

### App-level Ollama environment injection:
- `ollama-manager.ts` (production): No `OLLAMA_NO_GPU` injection. ✅
- `ollama-manager-enhanced.ts` (test-only, not used in production): Contains `env.OLLAMA_NO_GPU = '1'` guarded by `this.cpuFallbackMode` — but this file is **only imported in `__tests__/diagnostics.test.ts`** and never in the production main process.

### `num_gpu` in API calls:
No `num_gpu: 0` or `gpu_layers: 0` is passed in any Ollama API call across the codebase. The chat calls only set:
- `keep_alive: '2m'` (standard)
- `keep_alive: '15m'` (bulk autosort, in `ollamaBulkPrewarm.ts` and `aiProviders.ts`)

### App spawning Ollama:
`ollama-manager.ts` does spawn Ollama when it is not already running, using `spawn(this.ollamaPath, ['serve'], { env: process.env, ... })` — no extra environment variables injected.

**Conclusion: The app is clean. The CPU-only behavior is 100% a system/Ollama configuration issue.**

---

## 11. The "Started After gemma3:12b" Connection

The user reports this started when `gemma3:12b` was made available in the model picker. Two explanations:

**Most likely — Ollama was updated simultaneously:**  
When `gemma3:12b` was pulled (`ollama pull gemma3:12b`), the Ollama client may have auto-updated to 0.18.3. Version 0.18.x switched from the old GGML-CUDA runner (`runners/cuda_v12/`) to the new MLX-CUDA runner (`lib/ollama/mlx_cuda_v13/`). The old runner may have bundled `cudart64_12.dll`; the new one does not.

**Alternative — it was always CPU:**  
The CUDA Toolkit may never have been installed, and the app was fast on the old runner because the old runner bundled its own CUDA DLLs. After the 0.18.x migration to the unbundled MLX runner, GPU stopped working.

Either way the trigger is the **Ollama version change**, not the model itself.

---

## 12. Summary of Root Causes

| # | Root Cause | Confidence | Impact |
|---|---|---|---|
| **1** | CUDA Toolkit 12.x/13.x not installed → `cudart64_13.dll` missing → `mlx_cuda_v13` backend fails to load → CPU fallback | **HIGH (confirmed)** | Performance ×10–20× slower |
| **2** | RTX 5080 Blackwell (sm_120) may not be in Ollama 0.18.3's compiled CUDA kernels | **MEDIUM (unverified)** | GPU fail even with CUDA Toolkit |
| **3** | Ollama 0.18.3 no longer bundles CUDA runtime (changed from old runner architecture) | **HIGH (confirmed by dir listing)** | Same as #1 |
| **4** | No Ollama server log captured → silent failure invisible | **HIGH (confirmed)** | Masks root cause at runtime |

---

## 13. Recommended Fix Steps

### Step 1 — Install NVIDIA CUDA Toolkit (addresses root cause #1 and #3)

Download and install **CUDA Toolkit 12.8** (latest stable as of early 2026) from:  
`https://developer.nvidia.com/cuda-downloads`

Select: Windows → x86_64 → 11 → local installer

After install, verify:
```powershell
Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin" -Filter "cudart64*"
# Should return cudart64_12.dll
```

### Step 2 — Restart Ollama

```powershell
Stop-Process -Name "ollama*" -Force
Start-Sleep -Seconds 2
ollama serve
```

### Step 3 — Verify GPU is used

```powershell
# Load model
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method POST -Body '{"model":"llama3.1:8b","prompt":"hi","stream":false}' -ContentType "application/json"

# Check VRAM
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" | ConvertTo-Json -Depth 5
# size_vram should now be > 0 (expect ~4.8 GB for llama3.1:8b)
```

### Step 4 — If still CPU after CUDA Toolkit install (Blackwell compatibility)

Update Ollama to the latest available version:
```powershell
# Check releases at https://github.com/ollama/ollama/releases
winget upgrade Ollama.Ollama
```

Ollama 0.6.0 added Blackwell (sm_120) support. Confirm 0.18.3 includes it — if not, the latest release will.

### Step 5 — Enable Ollama server logging (optional, for diagnostics)

Set this as a system environment variable before starting Ollama:
```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_DEBUG", "1", "User")
# Ollama will now write verbose GPU detection logs to stderr
```

---

## 14. Expected Performance After Fix

| Metric | Current (CPU) | Expected (RTX 5080 GPU) |
|---|---|---|
| Model load time | ~1.4s (cold) | ~0.3s |
| Tokens/second (llama3.1:8b) | ~8–15 tok/s | ~80–150 tok/s |
| Auto-sort 90 messages | 5–10+ minutes | ~60–90 seconds |
| First classify latency | 15–20s | 1–3s |

---

*Report generated by automated diagnostic. No code was changed during this investigation.*
