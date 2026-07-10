/**
 * Inference capability resolution — tier-ranked backend selection.
 *
 * Priority:  remote-host > local-gpu > local-cpu > unavailable
 *
 * The pure-function core (`resolveInferenceCapabilityFromInput`) is sync and
 * fully unit-testable without mocking any async dependencies.
 *
 * The async main-process wrapper (`resolveInferenceCapability`) lives alongside
 * its IPC handler in llm/ipc.ts to avoid circular module imports.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InferenceBackend = 'remote-host' | 'local-gpu' | 'local-cpu' | 'unavailable'

/**
 * Hardware classification for the *active* execution backend.
 * Set on both local and remote paths so the badge always shows
 * "GPU" or "CPU" rather than a topology label like "Remote".
 */
export type InferenceHardware = 'gpu' | 'cpu' | 'unknown'

export interface InferenceCapabilityResult {
  backend: InferenceBackend
  /** Active model for the resolved backend. */
  modelName?: string
  /** Set for `remote-host`: the peer host base URL. */
  remoteBaseUrl?: string
  /** Set for `remote-host`: the handshake pairing identifier. */
  handshakeId?: string
  /** Set for `remote-host`: peer device ID. */
  peerDeviceId?: string
  /**
   * Hardware the backend actually uses.
   * `'gpu'`     — model is offloaded to GPU VRAM.
   * `'cpu'`     — the local LLM is running but using CPU only (CPU-safe model).
   * `'unknown'` — could not determine hardware (e.g. model not yet loaded,
   *               or host probed but PS endpoint returned no data).
   */
  hostHardware: InferenceHardware
  /** Machine-readable reason when `backend === 'unavailable'`. */
  unavailableReason?: string
  /** Human-readable tooltip / title text for the badge. */
  userMessage?: string
}

export interface InferenceCapabilityInput {
  /** Device is in sandbox role and should prefer the paired host if available. */
  isSandbox: boolean
  /**
   * Non-null when a healthy remote host is reachable (sandbox only).
   * Pass `null` when the device is a host or no remote target exists.
   */
  remoteContext?: {
    modelName?: string | null
    baseUrl?: string | null
    handshakeId?: string | null
    peerDeviceId?: string | null
  } | null
  /**
   * `true` when the local GPU can fully offload the selected model.
   * For the remote path this reflects the *host* GPU status
   * (derived from a remote host probe, not local nvidia-smi).
   */
  gpuAvailable: boolean
  /** `true` when the local llama-server port is reachable. */
  localLlmRunning: boolean
  /** Currently selected / effective model name (`null` = nothing configured). */
  modelName: string | null
  /** Dev escape hatch — mirrors `WRDESK_ALLOW_CPU_INFERENCE=1`. */
  allowCpuOverride?: boolean
}

// ─── CPU-safe model catalogue ─────────────────────────────────────────────────

/**
 * Models small enough to run on a commodity CPU without thermal risk.
 *
 * The colon before the size tag (`:`) is intentional: it anchors the pattern
 * so `/gemma\d*:[12]b/` matches `gemma2:2b` but NOT `gemma3:12b`
 * (`:12b` → `[12]` matches `1`, then `b` needs to match `2` — FAIL).
 */
export const CPU_SAFE_MODEL_PATTERNS: readonly RegExp[] = [
  /\bgemma\d*:[12]b\b/i,        // gemma:1b, gemma2:2b, gemma3:2b — NOT gemma3:12b
  /\bqwen\d*:0\.5b\b/i,         // qwen2:0.5b
  /\bqwen\d*:1\.5b\b/i,         // qwen2:1.5b
  /\bphi(?:\d+[-_])?mini\b/i,   // phi4-mini, phi3-mini
  /\bsmollm/i,                   // smollm, smollm2:135m, smollm2:360m
  /\btinyllama\b/i,
]

/**
 * Returns `true` only for models confirmed CPU-safe (≤ ~2 B params).
 *
 * Hard rule: `gemma3:12b` is **not** CPU-safe.
 */
export function isCpuSafeModel(modelName: string): boolean {
  const n = (modelName ?? '').trim()
  if (!n) return false
  return CPU_SAFE_MODEL_PATTERNS.some((p) => p.test(n))
}

// ─── Pure capability resolver ─────────────────────────────────────────────────

/**
 * Tier-ranked inference backend decision — pure, sync, no I/O.
 *
 * | Tier | Backend      | Condition                                          |
 * |------|--------------|---------------------------------------------------|
 * |  1   | remote-host  | Sandbox device + healthy paired host               |
 * |  2   | local-gpu    | GPU probe returned `available: true`               |
 * |  3   | local-cpu    | Local LLM running + CPU-safe model (or dev override) |
 * |  4   | unavailable  | None of the above                                  |
 *
 * The caller is responsible for supplying the already-resolved `gpuAvailable`
 * and `localLlmRunning` flags — this function does no async I/O itself.
 */
export function resolveInferenceCapabilityFromInput(
  input: InferenceCapabilityInput,
): InferenceCapabilityResult {
  const { isSandbox, remoteContext, gpuAvailable, localLlmRunning, modelName, allowCpuOverride } = input

  // ── Tier 1: sandbox + healthy remote host ────────────────────────────────
  if (isSandbox && remoteContext != null) {
    // gpuAvailable here reflects the *host* GPU probe result (see IPC handler).
    const hw: InferenceHardware = gpuAvailable
      ? 'gpu'
      : (modelName && (allowCpuOverride || isCpuSafeModel(modelName)))
        ? 'cpu'
        : 'unknown'
    return {
      backend: 'remote-host',
      hostHardware: hw,
      modelName: remoteContext.modelName ?? undefined,
      remoteBaseUrl: remoteContext.baseUrl ?? undefined,
      handshakeId: remoteContext.handshakeId ?? undefined,
      peerDeviceId: remoteContext.peerDeviceId ?? undefined,
      userMessage:
        hw === 'gpu'
          ? 'Host GPU inference is available.'
          : hw === 'cpu'
            ? 'Host CPU inference is available (CPU-safe model).'
            : 'Paired host is reachable. Hardware status unknown.',
    }
  }

  // ── Tier 2: local GPU ────────────────────────────────────────────────────
  if (gpuAvailable) {
    return {
      backend: 'local-gpu',
      hostHardware: 'gpu',
      modelName: modelName ?? undefined,
      userMessage: 'GPU inference is available.',
    }
  }

  // ── Tier 3: local CPU (CPU-safe models or dev override) ──────────────────
  if (localLlmRunning) {
    if (!modelName) {
      return {
        backend: 'unavailable',
        hostHardware: 'unknown',
        unavailableReason: 'no_model_selected',
        userMessage: 'No AI model selected. Configure a local llama.cpp model in Settings.',
      }
    }
    if (allowCpuOverride === true) {
      return {
        backend: 'local-cpu',
        hostHardware: 'cpu',
        modelName,
        userMessage: `CPU inference allowed by WRDESK_ALLOW_CPU_INFERENCE override (model: ${modelName}).`,
      }
    }
    if (isCpuSafeModel(modelName)) {
      return {
        backend: 'local-cpu',
        hostHardware: 'cpu',
        modelName,
        userMessage: 'CPU inference is available for this model.',
      }
    }
    // Model is too large for CPU — give a clear actionable message.
    return {
      backend: 'unavailable',
      hostHardware: 'unknown',
      unavailableReason: 'model_requires_gpu_or_remote',
      modelName,
      userMessage: `CPU inference is available, but the selected model (${modelName}) requires GPU or remote host inference.`,
    }
  }

  // ── Tier 4: unavailable ───────────────────────────────────────────────────
  if (!modelName) {
    return {
      backend: 'unavailable',
      hostHardware: 'unknown',
      unavailableReason: 'no_model_selected',
      userMessage: 'No AI model selected. Configure a local llama.cpp model in Settings.',
    }
  }
  return {
    backend: 'unavailable',
    hostHardware: 'unknown',
    unavailableReason: 'local_llm_not_running',
    modelName,
    userMessage: 'The local LLM (llama.cpp) is not running. Start it to use local AI inference.',
  }
}
