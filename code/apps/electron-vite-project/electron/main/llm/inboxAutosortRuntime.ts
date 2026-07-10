/**
 * Strict, fail-closed runtime resolution for inbox Auto-Sort.
 *
 * Rules:
 *   1. Provider MUST be the local llama.cpp backend — `auto` and `cloud` are hard-blocked.
 *   2. llama-server MUST be running and reachable.
 *   3. A model preference MUST be stored in active-local-llm-model.json.
 *   4. The stored model MUST exist exactly among installed models (no silent fallback to first installed).
 *   5. GPU use MUST be positively verified — 'gpu_unconfirmed' and 'cpu_likely' both block.
 *
 * This function is the ONLY decision point for whether autosort may start.
 * It does NOT modify any state — it only reads and classifies.
 *
 * B1: reads the single {@link getLocalLlmProviderStatus} object for `serverRunning` /
 * `modelsInstalled` rather than re-deriving them from independent manager calls.
 */

import { ocrRouter } from '../ocr/router'
import { getLocalLlmProviderStatus } from './localLlmProviderStatus'
import { getStoredActiveLocalModelId } from './activeLocalModelStore'
import {
  buildLocalLlmRuntimeInfo,
  type LocalLlmRuntimeClassification,
} from './localLlmRuntimeStatus'

// ── Public types ───────────────────────────────────────────────────────────

export type AutosortBlockReason =
  | 'provider_not_local_llm'      // Backend preference is 'auto' or 'cloud'
  | 'local_llm_not_running'       // llama-server HTTP API unreachable
  | 'no_model_installed'          // no GGUF models installed
  | 'no_stored_model_preference'  // active-local-llm-model.json missing or empty
  | 'stored_model_not_installed'  // stored ID is not among installed models (exact match required)
  | 'gpu_not_verified'            // classification is not 'gpu_capable' (includes gpu_unconfirmed)

export interface ResolvedInboxRuntime {
  // Routing
  provider: string                        // 'llamacpp' when allowed, else the backend provider
  model: string | null                    // exact installed model name, or null when blocked
  endpoint: string                        // 'http://127.0.0.1:8080'

  // Model state
  storedModelId: string | null            // raw value from active-local-llm-model.json
  storedModelInstalled: boolean           // storedModelId present in installedNames (exact match)
  installedModels: string[]               // installed model names

  // Runtime state
  localLlmRunning: boolean
  gpuClassification: LocalLlmRuntimeClassification
  gpuEvidence: string | undefined

  // Gate
  autosortAllowed: boolean
  blockReason: AutosortBlockReason | null
  blockMessage: string | null             // actionable human-readable text, shown directly in UI
}

// ── Constants ──────────────────────────────────────────────────────────────

const LOCAL_LLM_ENDPOINT = 'http://127.0.0.1:8080'

// ── Internal helpers ───────────────────────────────────────────────────────

function blocked(
  reason: AutosortBlockReason,
  message: string,
  partial: Partial<ResolvedInboxRuntime> = {},
): ResolvedInboxRuntime {
  return {
    provider: partial.provider ?? 'llamacpp',
    model: null,
    endpoint: LOCAL_LLM_ENDPOINT,
    storedModelId: partial.storedModelId ?? null,
    storedModelInstalled: false,
    installedModels: partial.installedModels ?? [],
    localLlmRunning: partial.localLlmRunning ?? false,
    gpuClassification: partial.gpuClassification ?? 'unknown',
    gpuEvidence: partial.gpuEvidence,
    autosortAllowed: false,
    blockReason: reason,
    blockMessage: message,
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Resolve the effective inbox autosort runtime.
 * Returns a fully populated `ResolvedInboxRuntime`; caller must check `autosortAllowed`.
 *
 * This function is called from:
 *   - `handleAiAutoSort` (renderer) via `llm:resolveAutosortRuntime` IPC — pre-sort gate.
 *   - `AutosortRuntimeStatus` component on mount and on model-changed events — status badge.
 */
export async function resolveInboxAutosortRuntime(): Promise<ResolvedInboxRuntime> {
  // ── 1. Provider must be explicitly 'local' ─────────────────────────────
  const cfg = ocrRouter.getCloudConfig()
  const pref = cfg?.preference ?? 'local'

  if (pref !== 'local') {
    const label = pref === 'cloud' ? 'Cloud' : 'Auto'
    console.log('[AutosortRuntime] BLOCKED provider_not_local_llm', { preference: pref })
    return blocked(
      'provider_not_local_llm',
      `Backend AI preference is set to "${label}". ` +
        'Auto-Sort requires the Local LLM (llama.cpp) only. ' +
        'Go to Backend Configuration → AI Preference → select Local.',
      { provider: pref },
    )
  }

  // ── 2. llama-server must be running ─────────────────────────────────────
  const providerStatus = await getLocalLlmProviderStatus()
  const running = providerStatus.serverRunning
  if (!running) {
    console.log('[AutosortRuntime] BLOCKED local_llm_not_running')
    return blocked(
      'local_llm_not_running',
      'The local LLM (llama.cpp) is not running. ' +
        'Start it from Backend Configuration or your system tray, then try again.',
      { localLlmRunning: false },
    )
  }

  // ── 3. At least one model must be installed ────────────────────────────
  const installedNames = providerStatus.modelsInstalled.map((m) => m.name)
  if (installedNames.length === 0) {
    console.log('[AutosortRuntime] BLOCKED no_model_installed')
    return blocked(
      'no_model_installed',
      'No local models are installed. ' +
        'Install a GGUF model in Backend Configuration, then try again.',
      { localLlmRunning: true, installedModels: [] },
    )
  }

  // ── 4. A stored model preference must exist and match exactly ─────────
  const storedIdRaw = getStoredActiveLocalModelId()
  if (!storedIdRaw) {
    console.log('[AutosortRuntime] BLOCKED no_stored_model_preference')
    return blocked(
      'no_stored_model_preference',
      'No local model is selected. ' +
        'Open the model picker in the Auto-Sort toolbar and choose a model.',
      { localLlmRunning: true, installedModels: installedNames },
    )
  }

  if (!installedNames.includes(storedIdRaw)) {
    console.log('[AutosortRuntime] BLOCKED stored_model_not_installed', { storedId: storedIdRaw, installedNames })
    return blocked(
      'stored_model_not_installed',
      `The selected model "${storedIdRaw}" is not installed. ` +
        `Install it or select a different model from the model picker.`,
      { localLlmRunning: true, installedModels: installedNames, storedModelId: storedIdRaw },
    )
  }

  // ── 5. GPU must be positively verified ────────────────────────────────
  const localRuntime = await buildLocalLlmRuntimeInfo({
    localLlmRunning: true,
    activeModel: storedIdRaw,
  })

  if (localRuntime.classification !== 'gpu_capable') {
    const classLabel: Record<LocalLlmRuntimeClassification, string> = {
      gpu_capable: 'GPU capable',
      gpu_unconfirmed: 'GPU unconfirmed',
      cpu_likely: 'CPU only',
      unknown: 'unknown',
    }
    console.log('[AutosortRuntime] BLOCKED gpu_not_verified', {
      classification: localRuntime.classification,
      evidence: localRuntime.evidence,
    })
    return blocked(
      'gpu_not_verified',
      `GPU use cannot be verified (status: ${classLabel[localRuntime.classification]}). ` +
        'Auto-Sort requires confirmed GPU acceleration to be usable. ' +
        'Check that your GPU drivers and llama.cpp CUDA build are correctly installed. ' +
        (localRuntime.evidence ? `Evidence: ${localRuntime.evidence}` : ''),
      {
        localLlmRunning: true,
        installedModels: installedNames,
        storedModelId: storedIdRaw,
        gpuClassification: localRuntime.classification,
        gpuEvidence: localRuntime.evidence,
      },
    )
  }

  // ── Allowed ────────────────────────────────────────────────────────────
  const result: ResolvedInboxRuntime = {
    provider: 'llamacpp',
    model: storedIdRaw,
    endpoint: LOCAL_LLM_ENDPOINT,
    storedModelId: storedIdRaw,
    storedModelInstalled: true,
    installedModels: installedNames,
    localLlmRunning: true,
    gpuClassification: localRuntime.classification,
    gpuEvidence: localRuntime.evidence,
    autosortAllowed: true,
    blockReason: null,
    blockMessage: null,
  }

  console.log('[AutosortRuntime] ALLOWED', {
    model: result.model,
    endpoint: result.endpoint,
    gpu: result.gpuClassification,
    evidence: result.gpuEvidence,
  })

  return result
}
