# GPU detection and global inference gate

## Purpose

WR Desk blocks **CPU-only and partial-GPU** local Ollama inference for large chat models. Unbounded CPU inference can sustain 100% core usage and cause **thermal stress** on workstations. The gate is **operational safety**, not a cryptography or BEAP seal feature.

## Behavior

1. **`gpuStatus` module** (`electron/main/inference/gpuStatus.ts`) probes, in order:

   - **Windows / Linux:** `nvidia-smi` presence (command missing → `NVIDIA_DRIVER_MISSING`).
   - **macOS:** NVIDIA-SMI is skipped; Apple Metal is assumed available at the OS level.
   - **Ollama HTTP:** `GET /api/version` on the same origin list as runtime (`OLLAMA_HOST` + loopback), minimum version **0.4.0** when the version string parses.
   - **`GET /api/ps`:** matches the effective chat model; compares `size_vram` vs `size`:
     - `size_vram === 0` → model on CPU or no GPU path → block.
     - `0 < size_vram < size` (with tolerance) → partial offload → block.
     - Full residency → allow.
   - If the model is **not yet loaded** (`/api/ps` has no matching row), status is **optimistic allow** (same idea as the legacy inbox preload).
   - Reads a short **Ollama server log tail** when possible to refine reasons (e.g. “no compatible GPUs”).

   Results are **cached ~60s** (`clearGpuStatusCache()` for tests or forced refresh scenarios).

2. **`inferenceGate` module** (`electron/main/inference/inferenceGate.ts`):

   - `assertGpuInferenceAvailable()` — throws `InferenceUnavailableError` with a **user-facing message** when inference must not run locally.
   - `assertGpuInferenceAvailableForRemoteOllama(origin, modelBareHint)` — same check against a **LAN** Ollama (skips local `nvidia-smi`; probes that origin’s `/api` only).
   - `assertGpuInferenceAvailableForChatBase({ baseUrl, modelId })` — loopback/local vs remote branching.
   - `isGpuInferenceAvailable()` — non-throwing UI helper.

3. **Developer-only override**

   **`WRDESK_ALLOW_CPU_INFERENCE=1`**

   - Must **not** be set in hospital/production deployments.
   - Bypasses the throw; logs a **console warning on each** `assert*` call so CI/dev visibility stays high.

   Vitest default setup sets this so mocked `fetch` suites do not require real GPUs (`test/setup.ts`).

## UI

- **HybridSearch** toolbar: **GPU OK** / **GPU Issue** badge (`GpuInferenceBarBadge`), fed by **`llm:getGpuStatus`** IPC.
- Tooltip includes `userMessage` and `technicalSummary` for support.

## What we intentionally do **not** do

- No user-facing “force CPU” toggle (would defeat thermal protection).
- No silent fallback to CPU chat after a failed GPU check.

## References

Implementation touchpoints include: `ollama-manager` (`chat`), `aiProviders` / `llmStream`, inbox streaming (`inboxOllamaChatStreamSandbox`), internal host inference, sandbox LAN `ollama_direct` chat, bulk prewarm, and unified inbox dedup wiring through the global gate.
