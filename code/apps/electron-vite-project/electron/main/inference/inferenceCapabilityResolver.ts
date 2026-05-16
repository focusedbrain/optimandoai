/**
 * Inference capability resolution — tier-ranked backend selection.
 *
 * Priority order: remote-host > local-gpu > local-cpu > unavailable
 *
 * Pure-function core (`resolveInferenceCapabilityFromInput`) holds no async deps
 * and is fully unit-testable.  The async main-process wrapper
 * `resolveInferenceCapability` lives alongside the IPC handler in llm/ipc.ts
 * to avoid circular module dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InferenceBackend = 'remote-host' | 'local-gpu' | 'local-cpu' | 'unavailable'

export interface InferenceCapabilityResult {
  backend: InferenceBackend
  /** Active model for the resolved backend. */
  modelName?: string
  /** Set for `remote-host`: the peer Ollama base URL. */
  remoteBaseUrl?: string
  /** Set for `remote-host`: the handshake pairing identifier. */
  handshakeId?: string
  /** Set for `remote-host`: peer device ID. */
  peerDeviceId?: string
  /** Set when `backend === 'unavailable'`. Machine-readable reason code. */
  unavailableReason?: string
  /** Human-readable message for UI display. */
  userMessage?: string
}

export interface InferenceCapabilityInput {
  /** Device is in sandbox role (should prefer remote host if available). */
  isSandbox: boolean
  /**
   * Non-null when a healthy remote host is available (sandbox only).
   * Pass `null` if no remote host exists or the device is a host.
   */
  remoteContext?: {
    modelName?: string | null
    baseUrl?: string | null
    handshakeId?: string | null
    peerDeviceId?: string | null
  } | null
  /** True when the local GPU is healthy and Ollama can fully offload the model. */
  gpuAvailable: boolean
  /** True when the local Ollama process responds on its HTTP port. */
  ollamaRunning: boolean
  /** Currently selected / effective model name (null = nothing configured). */
  modelName: string | null
  /**
   * When true, large models are also allowed on CPU.
   * Mirror of `WRDESK_ALLOW_CPU_INFERENCE=1` — dev override only.
   */
  allowCpuOverride?: boolean
}

// ─── CPU-safe model catalogue ─────────────────────────────────────────────────

/**
 * Models confirmed CPU-safe (≤ ~2 B parameters).
 *
 * The colon separator before the size tag (`:`) is intentional: it prevents
 * `/gemma\d*:[12]b/` from matching `gemma3:12b` because `:12b` != `:1b`/`:2b`.
 */
export const CPU_SAFE_MODEL_PATTERNS: readonly RegExp[] = [
  /\bgemma\d*:[12]b\b/i,       // gemma:1b, gemma2:2b, gemma3:2b — NOT gemma3:12b
  /\bqwen\d*:0\.5b\b/i,        // qwen2:0.5b
  /\bqwen\d*:1\.5b\b/i,        // qwen2:1.5b
  /\bphi(?:\d+[-_])?mini\b/i,  // phi4-mini, phi3-mini
  /\bsmollm/i,                  // smollm, smollm2:135m, smollm2:360m
  /\btinyllama\b/i,
]

/**
 * Returns `true` only when the model is small enough to run safely on a
 * commodity CPU without thermal risk.
 *
 * Hard rule: `gemma3:12b` is **not** CPU-safe even though it contains "gemma".
 * The colon-anchored pattern ensures it does not match.
 */
export function isCpuSafeModel(modelName: string): boolean {
  const n = (modelName ?? '').trim()
  if (!n) return false
  return CPU_SAFE_MODEL_PATTERNS.some((p) => p.test(n))
}

// ─── Pure capability resolver ─────────────────────────────────────────────────

/**
 * Tier-ranked inference capability decision — pure, sync, no I/O.
 *
 * Tier 1  remote-host  Sandbox + healthy paired host
 * Tier 2  local-gpu    Local GPU ready (Ollama with full VRAM offload)
 * Tier 3  local-cpu    Ollama running + CPU-safe model (or dev override)
 * Tier 4  unavailable  None of the above
 */
export function resolveInferenceCapabilityFromInput(
  input: InferenceCapabilityInput,
): InferenceCapabilityResult {
  const { isSandbox, remoteContext, gpuAvailable, ollamaRunning, modelName, allowCpuOverride } = input

  // ── Tier 1: sandbox + healthy remote host ────────────────────────────────
  if (isSandbox && remoteContext != null) {
    return {
      backend: 'remote-host',
      modelName: remoteContext.modelName ?? undefined,
      remoteBaseUrl: remoteContext.baseUrl ?? undefined,
      handshakeId: remoteContext.handshakeId ?? undefined,
      peerDeviceId: remoteContext.peerDeviceId ?? undefined,
      userMessage: 'Inference is routed to paired host.',
    }
  }

  // ── Tier 2: local GPU ────────────────────────────────────────────────────
  if (gpuAvailable) {
    return {
      backend: 'local-gpu',
      modelName: modelName ?? undefined,
      userMessage: 'GPU inference is available.',
    }
  }

  // ── Tier 3: local CPU (CPU-safe models or dev override) ─────────────────
  if (ollamaRunning) {
    if (!modelName) {
      return {
        backend: 'unavailable',
        unavailableReason: 'no_model_selected',
        userMessage: 'No AI model selected. Configure an Ollama model in Settings.',
      }
    }
    if (allowCpuOverride === true) {
      return {
        backend: 'local-cpu',
        modelName,
        userMessage:
          `CPU inference allowed by WRDESK_ALLOW_CPU_INFERENCE override (model: ${modelName}).`,
      }
    }
    if (isCpuSafeModel(modelName)) {
      return {
        backend: 'local-cpu',
        modelName,
        userMessage: 'CPU inference is available for this model.',
      }
    }
    return {
      backend: 'unavailable',
      unavailableReason: 'model_requires_gpu_or_remote',
      modelName,
      userMessage:
        `CPU inference is available, but the selected model (${modelName}) requires GPU or remote host inference.`,
    }
  }

  // ── Tier 4: unavailable ───────────────────────────────────────────────────
  if (!modelName) {
    return {
      backend: 'unavailable',
      unavailableReason: 'no_model_selected',
      userMessage: 'No AI model selected. Configure an Ollama model in Settings.',
    }
  }
  return {
    backend: 'unavailable',
    unavailableReason: 'ollama_not_running',
    modelName,
    userMessage: 'Ollama is not running. Start Ollama to use local AI inference.',
  }
}
