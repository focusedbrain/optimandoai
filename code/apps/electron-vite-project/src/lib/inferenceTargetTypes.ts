/**
 * UI-facing target for model/provider selectors (orchestrator chat, WR Chat, bulk local-only, etc.).
 *
 * ## STEP 1 — Selector inventory (classifications)
 * - `HybridSearch` (`components/HybridSearch.tsx`) — A. PROVIDER_AWARE_SELECTOR:
 *   Data: `window.handshakeView.getAvailableModels` → local + cloud; on Sandbox, main also merges
 *   Host AI rows (same as `listTargets`) into `models` + `hostInferenceTargets`. Value: `selectedModel: string` (model id, cloud id,
 *   or `host-inference:` / `host-internal:` id). onChange: `setSelectedModel`. Chat submit uses
 *   `selectedModel` to branch host IPC vs `handshake` chat.
 * - `WRChatDashboardView` + `PopupChatView` (extension) — A (dashboard): models from
 *   `window.llm.getStatus` + host targets; value is string model or host route id. onChange:
 *   `onModelSelect` + `llm.setActiveModel` for Ollama only.
 * - `BulkOllamaModelSelect` — B. LOCAL_MODEL_ONLY_SELECTOR: `llm.getStatus` / `setActiveModel`,
 *   string names only. Auto-Sort only; Host AI must not apply here.
 * - `EmailInboxBulkView` — uses `BulkOllamaModelSelect` (B).
 * - `LetterViewerPort` / status — reads `activeModel` for display only, not a selector.
 * - Extension `sidepanel` / `popup-chat` — B for local Ollama when not using dashboard host list.
 * - Extension-chromium: no separate WrChat model selector module beyond `PopupChatView`.
 */

export type HostInferenceListAvailability =
  | 'available'
  | 'host_offline'
  | 'direct_unreachable'
  | 'policy_disabled'
  | 'model_unavailable'
  | 'handshake_inactive'
  | 'not_configured'

/** Stable id: `ollama:<model>` (URL-encoded model segment). */
export type InferenceTarget =
  | {
      kind: 'local_ollama'
      id: string
      label: string
      model: string
      provider: 'ollama'
      available: boolean
    }
  | {
      kind: 'host_internal'
      id: string
      label: string
      model: string | null
      model_id: string | null
      display_label: string
      provider: 'ollama' | ''
      handshake_id: string
      host_device_id: string
      host_computer_name: string
      host_pairing_code?: string
      host_orchestrator_role: 'host'
      host_orchestrator_role_label: string
      internal_identifier_6: string
      direct_reachable?: boolean
      policy_enabled?: boolean
      available: boolean
      availability: HostInferenceListAvailability
      unavailable_reason?: string
      inference_error_code?: string
    }
  | {
      kind: 'cloud'
      id: string
      label: string
      provider: string
      model: string
      available: boolean
    }

export function ollamaInferenceTargetId(modelName: string): string {
  return `ollama:${encodeURIComponent(modelName.trim())}`
}

export function displayPairingId(pairing6: string | undefined): string {
  const s = (pairing6 ?? '').replace(/\D/g, '')
  if (s.length === 6) return `${s.slice(0, 3)}-${s.slice(3)}`
  return pairing6?.trim() || '—'
}
