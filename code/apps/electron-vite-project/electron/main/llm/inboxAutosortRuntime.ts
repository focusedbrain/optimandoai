/**
 * Strict, fail-closed runtime resolution for inbox Auto-Sort.
 *
 * Rules:
 *   1. Provider MUST be local Ollama — `auto` and `cloud` are hard-blocked.
 *   2. Ollama MUST be running and reachable.
 *   3. A model preference MUST be stored in active-ollama-model.json.
 *   4. The stored model MUST exist exactly in /api/tags (no silent fallback to first installed).
 *   5. GPU use MUST be positively verified — 'gpu_unconfirmed' and 'cpu_likely' both block.
 *
 * This function is the ONLY decision point for whether autosort may start.
 * It does NOT modify any state — it only reads and classifies.
 */

import { ocrRouter } from '../ocr/router'
import { ollamaManager } from './ollama-manager'
import { getStoredActiveOllamaModelId } from './activeOllamaModelStore'
import {
  buildLocalLlmRuntimeInfo,
  type LocalLlmRuntimeClassification,
} from './localLlmRuntimeStatus'

// ── Public types ───────────────────────────────────────────────────────────

export type AutosortBlockReason =
  | 'provider_not_ollama'         // Backend preference is 'auto' or 'cloud'
  | 'ollama_not_running'          // Ollama HTTP API unreachable
  | 'no_model_installed'          // /api/tags returned empty list
  | 'no_stored_model_preference'  // active-ollama-model.json missing or empty
  | 'stored_model_not_installed'  // stored ID is not in /api/tags (exact match required)
  | 'gpu_not_verified'            // classification is not 'gpu_capable' (includes gpu_unconfirmed)

export interface ResolvedInboxRuntime {
  // Routing
  provider: string                        // 'ollama' when allowed, else the backend provider
  model: string | null                    // exact name from /api/tags, or null when blocked
  endpoint: string                        // 'http://127.0.0.1:11434'

  // Model state
  storedModelId: string | null            // raw value from active-ollama-model.json
  storedModelInstalled: boolean           // storedModelId present in installedNames (exact match)
  installedModels: string[]               // names from /api/tags

  // Runtime state
  ollamaRunning: boolean
  gpuClassification: LocalLlmRuntimeClassification
  gpuEvidence: string | undefined

  // Gate
  autosortAllowed: boolean
  blockReason: AutosortBlockReason | null
  blockMessage: string | null             // actionable human-readable text, shown directly in UI
}

// ── Constants ──────────────────────────────────────────────────────────────

const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'

// ── Internal helpers ───────────────────────────────────────────────────────

function blocked(
  reason: AutosortBlockReason,
  message: string,
  partial: Partial<ResolvedInboxRuntime> = {},
): ResolvedInboxRuntime {
  return {
    provider: partial.provider ?? 'ollama',
    model: null,
    endpoint: OLLAMA_ENDPOINT,
    storedModelId: partial.storedModelId ?? null,
    storedModelInstalled: false,
    installedModels: partial.installedModels ?? [],
    ollamaRunning: partial.ollamaRunning ?? false,
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
    console.log('[AutosortRuntime] BLOCKED provider_not_ollama', { preference: pref })
    return blocked(
      'provider_not_ollama',
      `Backend AI preference is set to "${label}". ` +
        'Auto-Sort requires Local Ollama only. ' +
        'Go to Backend Configuration → AI Preference → select Local.',
      { provider: pref },
    )
  }

  // ── 2. Ollama must be running ──────────────────────────────────────────
  const running = await ollamaManager.isRunning()
  if (!running) {
    console.log('[AutosortRuntime] BLOCKED ollama_not_running')
    return blocked(
      'ollama_not_running',
      'Ollama is not running. ' +
        'Start it from Backend Configuration or your system tray, then try again.',
      { ollamaRunning: false },
    )
  }

  // ── 3. At least one model must be installed ────────────────────────────
  const models = await ollamaManager.listModels()
  const installedNames = models.map((m) => m.name)
  if (installedNames.length === 0) {
    console.log('[AutosortRuntime] BLOCKED no_model_installed')
    return blocked(
      'no_model_installed',
      'No local models are installed. ' +
        'Pull a model (e.g. llama3.1:8b) in Backend Configuration, then try again.',
      { ollamaRunning: true, installedModels: [] },
    )
  }

  // ── 4. A stored model preference must exist and match exactly ─────────
  const storedId = getStoredActiveOllamaModelId()
  if (!storedId) {
    console.log('[AutosortRuntime] BLOCKED no_stored_model_preference')
    return blocked(
      'no_stored_model_preference',
      'No Ollama model is selected. ' +
        'Open the model picker in the Auto-Sort toolbar and choose a model.',
      { ollamaRunning: true, installedModels: installedNames },
    )
  }

  if (!installedNames.includes(storedId)) {
    console.log('[AutosortRuntime] BLOCKED stored_model_not_installed', { storedId, installedNames })
    return blocked(
      'stored_model_not_installed',
      `The selected model "${storedId}" is not installed. ` +
        `Install it or select a different model from the model picker.`,
      { ollamaRunning: true, installedModels: installedNames, storedModelId: storedId },
    )
  }

  // ── 5. GPU must be positively verified ────────────────────────────────
  const localRuntime = await buildLocalLlmRuntimeInfo({
    ollamaRunning: true,
    activeModel: storedId,
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
        'Check that your GPU drivers and Ollama CUDA support are correctly installed. ' +
        (localRuntime.evidence ? `Evidence: ${localRuntime.evidence}` : ''),
      {
        ollamaRunning: true,
        installedModels: installedNames,
        storedModelId: storedId,
        gpuClassification: localRuntime.classification,
        gpuEvidence: localRuntime.evidence,
      },
    )
  }

  // ── Allowed ────────────────────────────────────────────────────────────
  const result: ResolvedInboxRuntime = {
    provider: 'ollama',
    model: storedId,
    endpoint: OLLAMA_ENDPOINT,
    storedModelId: storedId,
    storedModelInstalled: true,
    installedModels: installedNames,
    ollamaRunning: true,
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
