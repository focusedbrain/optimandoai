import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

/** Top chat + WR Chat: one Host row in the model menu (or collapsed label). */
export type HostModelSelectorRowUiIn = {
  hostSelectorState?: 'available' | 'checking' | 'unavailable'
  hostTargetAvailable: boolean
  displayTitle: string
  displaySubtitle: string
  name?: string
  /** Ollama / local model name on the Host (when known). */
  hostLocalModelName?: string | null
}

/**
 * Consistent first/second line for Host model rows: available, checking, or unavailable
 * (disabled rows still return visible copy; callers keep rows enabled/disabled for click).
 */
export function hostModelSelectorRowUi(
  m: HostModelSelectorRowUiIn,
  t?: HostInferenceTargetRow | null,
): { titleLine: string; subtitleLine: string } {
  const st =
    m.hostSelectorState ??
    t?.host_selector_state ??
    (t?.unavailable_reason === 'CHECKING_CAPABILITIES' || t?.availability === 'checking_host'
      ? 'checking'
      : t
        ? t.available
          ? 'available'
          : 'unavailable'
        : m.hostTargetAvailable
          ? 'available'
          : 'unavailable')
  if (st === 'checking') {
    return {
      titleLine: 'Host AI · checking Host…',
      subtitleLine: 'Active internal Host handshake found',
    }
  }
  if (st === 'unavailable' || !m.hostTargetAvailable) {
    const av = t?.availability
    const fromAvail =
      av && av !== 'available' && av !== 'checking_host' ? String(av) : ''
    const reason = (t?.unavailable_reason && String(t.unavailable_reason)) || fromAvail || m.displaySubtitle?.trim() || ''
    return {
      titleLine: 'Host AI unavailable',
      subtitleLine: reason || m.displaySubtitle || 'Host is not available for this Sandbox',
    }
  }
  const rawModel = (
    m.hostLocalModelName ??
    t?.model ??
    t?.model_id ??
    ''
  ).toString()
  const cleanModel = rawModel
    .replace(/host-internal:/gi, '')
    .replace(/^[^:]+:[^:]+:(.+)$/i, '$1')
    .trim()
  const fromTitle = m.displayTitle.replace(/^\s*Host AI\s*·\s*/i, '').replace(/^\s*Host AI\s*-\s*/i, '').trim()
  const modelPart = (cleanModel && cleanModel.length > 0 ? cleanModel : fromTitle) || m.name || '…'
  const sub =
    t?.secondary_label?.trim() ||
    m.displaySubtitle?.trim() ||
    ''
  return {
    titleLine: `Host AI · ${modelPart}`,
    subtitleLine: sub,
  }
}
