# Local Ollama GPU vs CPU — evidence-based analysis

## 1. Short technical answer: is the app path “GPU-capable”?

**Yes, at the HTTP boundary.** The inbox Auto-Sort and analyze paths that use the **local** backend send standard Ollama **`POST /api/chat`** requests to `http://127.0.0.1:11434` (or the provider’s `baseUrl`). The **Electron app does not embed CUDA, does not select GPU layers, and does not pass `num_gpu` / GPU flags** in the JSON body for chat.

**GPU vs CPU execution is entirely decided by the Ollama server process** (how it was built, which drivers are present, and how it loads the model). The app only supplies:

- `model`
- `messages`
- `stream: true | false`
- `keep_alive: '2m'` (both `OllamaProvider` and `ollamaManager.chat`)

So: **the app is not “forcing CPU” via request options** in the current code. If inference runs on CPU, that is an **Ollama / driver / model / environment** issue, not a missing field in the app’s fetch body.

**Caveat:** A **separate** code path (`ollama-manager-enhanced.ts`, not wired as the default inbox stack in this trace) contains comments about **CPU-only** server start in some failure modes. The **standard** `ollama-manager.ts` used for `listModels`, `getEffectiveChatModelName`, and `chat` does **not** implement that retry in the snippet reviewed—verify which manager your build actually loads for LLM settings vs inbox.

---

## 2. Execution path (inbox classify → HTTP)

1. **`classifySingleMessage`** (`electron/main/email/ipc.ts`) calls **`inboxLlmChat`** with optional **`resolvedContext`** (batch) so **`preResolveInboxLlm`** runs once per chunk, not per message.
2. **`inboxLlmChat`** (`electron/main/email/inboxLlmChat.ts`) resolves **`getProvider`** → **`OllamaProvider`** when Backend preference is local Ollama; passes **`model`** from **`resolvedContext.model`** or **`ollamaManager.getEffectiveChatModelName()`**.
3. **`OllamaProvider.generateChat`** (`electron/main/handshake/aiProviders.ts`) **`fetch`**es **`${baseUrl}/api/chat`** with **`stream: false`**, **`keep_alive: '2m'`**, **`messages`**.
4. **Streaming analyze** may use **`streamOllamaChat`** (`handshake/llmStream.ts`) or **`callInboxOllamaChatStream`** in `ipc.ts` (also **`/api/chat`**, **`stream: true`**, **`keep_alive: '2m'`** in the ipc helper).

**Parallelism:** Bulk classify uses **multiple concurrent** `inboxLlmChat` calls (capped for Ollama in batch). That affects **queue depth and wall time**; it does not change whether each request is GPU-backed—that remains **Ollama-internal**.

---

## 3. CPU vs GPU risk from *app* behavior

| Factor | Effect |
|--------|--------|
| No `options` for `num_gpu` in chat JSON | **Normal** — Ollama uses its default runner; GPU use is not toggled per request here. |
| `keep_alive: '2m'` | Keeps model **loaded in memory** longer; reduces **reload** latency; does not pick GPU vs CPU. |
| High **concurrency** (many parallel `/api/chat`) | Can **saturate** a single GPU, **queue** in Ollama, or increase **CPU** bookkeeping; **poor throughput** is consistent with GPU *or* CPU-bound bottlenecks. |
| **45s** outer abort (`inboxLlmChat`) | Cancels the **fetch**; does not change hardware path. |
| Large prompts | More **tokens** → longer **eval**; shows up in Ollama’s **`eval_count`** / durations. |

**Nothing in the traced app code sets “run this model on CPU.”** Verification must be **external** (GPU process, `nvidia-smi`, Ollama logs).

---

## 4. What Ollama returns (useful for diagnosis)

Non-stream **`/api/chat`** JSON often includes (names may vary slightly by Ollama version):

- **`total_duration`** (nanoseconds) — end-to-end server time for the response  
- **`load_duration`** — model load / preparation (large on **cold** load)  
- **`prompt_eval_count`**, **`eval_count`** — token-ish counts for prompt vs generation  

**These do not label “GPU” explicitly**, but:

- **Very large `load_duration`** once, then small on subsequent calls → typical **model load** (often GPU VRAM upload when GPU is used).  
- **`total_duration` ≈ wall time** you see in logs → correlates with **Task Manager** / **`nvidia-smi`** activity **during** that window.

---

## 5. Instrumentation added (code)

**Flag:** `DEBUG_OLLAMA_RUNTIME_TRACE` in `electron/main/llm/ollamaRuntimeDiagnostics.ts` (default **`false`**).

When **`true`**, logs **`[OLLAMA-RUNTIME]`** lines with:

- **`OllamaProvider.generateChat`** (inbox **non-stream** classify path): `start` / `done` / `error`, **`inFlight`**, **`wallMs`**, **`totalDurationMs`**, **`loadDurationMs`**, **`promptEvalCount`**, **`evalCount`**
- **`ollamaManager.chat`** (other callers, e.g. LLM IPC): same style
- **`streamOllamaChat`**: `start` / `done` / `error`, **`wallMs`**, **`inFlight`** (no NDJSON timing parse—minimal)

**In-flight counter:** shared across these paths so concurrent classifies show **`inFlight` > 1** when overlapping.

---

## 6. Practical verification procedure

### Enable logging

1. Set **`DEBUG_OLLAMA_RUNTIME_TRACE = true`** in  
   `apps/electron-vite-project/electron/main/llm/ollamaRuntimeDiagnostics.ts`
2. Rebuild/restart the Electron app (main process change).

### Commands (Windows / PowerShell)

- **GPU snapshot during a sort:**  
  `nvidia-smi dmon -s u -d 1`  
  or one-shot:  
  `nvidia-smi`
- **Ollama process:** confirm **`ollama.exe`** (or your install) is the one listening on **11434**.

### What to watch

| Signal | Suggests |
|--------|----------|
| **`nvidia-smi`** shows **GPU-Util** and **memory** rising **during** each `[OLLAMA-RUNTIME] ...:done` window | **Likely GPU inference** for those requests |
| **No** GPU utilization, **high CPU** on **`ollama`** / **`ollama_llama_server`** | **Likely CPU** path or GPU not selected (driver, WSL vs native, wrong GPU, Ollama build) |
| **`loadDurationMs` huge** on first request, then small | **Model load**; normal cold start |
| **`inFlight` 2–3** with cap, **`wallMs`** grows with queue | **Serialization / queueing** (app + Ollama), not necessarily “wrong” GPU |
| **`wallMs` ≫ `totalDurationMs`** from JSON | **Client/network/JSON parse** overhead (usually small locally) |

### Correlate with app logs

- Filter console for **`[OLLAMA-RUNTIME]`** and **`OllamaProvider.generateChat:done`** during Auto-Sort.
- Align timestamps with **`nvidia-smi`** spikes.

---

## 7. Conclusion template (fill after a run)

Pick **one** primary conclusion:

1. **Likely GPU used** — GPU util/memory correlate with each `done` log; `load_duration` drops after warm-up; throughput stable for model size.  
2. **Likely CPU fallback** — Ollama child processes show CPU load; `nvidia-smi` flat during inference; check Ollama install, CUDA driver, `OLLAMA_DEBUG` / server logs.  
3. **GPU probably used but app pipeline is the main bottleneck** — GPU busy in short bursts; wall time dominated by **IPC / batching / queue / many requests** (matches earlier autosort perf work).

**This document cannot assert GPU from code alone** — only from **runtime** evidence above.
