/**
 * Maps `host_ai_target_status` + backend `canChat` flags to selector enablement — never infer from model counts.
 */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

export function hostInferenceTargetMenuSelectable(t: HostInferenceTargetRow): boolean {
  if (t.host_ai_target_status === 'untrusted' || t.host_ai_target_status === 'offline') return false
  if (t.host_ai_target_status === 'handshake_active_but_endpoint_missing') return false

  if (typeof t.canChat === 'boolean' && t.canChat) return true

  if (
    t.host_ai_target_status === 'ollama_direct_only' &&
    t.execution_transport === 'ollama_direct' &&
    t.canUseOllamaDirect === true
  ) {
    return true
  }

  return false
}

/** User-facing ribbon label — keep in sync with product copy for Host AI readiness. */
export function hostAiConnectionStatusLabel(status: HostInferenceTargetRow['host_ai_target_status']): string {
  switch (status) {
    case 'beap_ready':
      return 'Connected'
    case 'ollama_direct_only':
      return 'Ollama reachable only'
    case 'handshake_active_but_endpoint_missing':
      return 'Host paired, BEAP endpoint missing'
    case 'untrusted':
      return 'Pairing not trusted'
    case 'offline':
      return 'Offline'
    default:
      return ''
  }
}

export function hostAiConnectionStatusDetail(status: HostInferenceTargetRow['host_ai_target_status']): string | undefined {
  if (status === 'handshake_active_but_endpoint_missing') {
    return 'The host is paired and Ollama is reachable, but the host BEAP endpoint is not advertised.'
  }
  return undefined
}

/**
 * Builds multiline subtitle: status label(+ optional detail line) · then host/metadata line (`base`).
 */
export function composeHostAiConnectionSubtitle(
  status: HostInferenceTargetRow['host_ai_target_status'] | undefined,
  baseSubtitle: string,
): string {
  const label = status ? hostAiConnectionStatusLabel(status) : ''
  const detail = status ? hostAiConnectionStatusDetail(status) : undefined
  const parts: string[] = []
  if (label.trim()) parts.push(label.trim())
  if (detail?.trim()) parts.push(detail.trim())
  const tail = baseSubtitle.trim()
  if (tail) parts.push(tail)
  return parts.join('\n')
}

export function hostAiTargetDevDebugSnippet(t: HostInferenceTargetRow | null | undefined): string {
  const fc = (t?.failureCode ?? '').trim()
  const st = (t?.host_ai_target_status ?? '').trim()
  const tr = (t?.inferenceHandshakeTrustReason ?? '').trim()
  if (!fc && !st && !tr) return ''
  const bits: string[] = []
  bits.push(fc ? `failureCode=${fc}` : 'failureCode=null')
  if (st) bits.push(`host_ai_target_status=${st}`)
  if (tr) bits.push(`reason=${tr}`)
  return bits.join(' ')
}

/** Same basis as `mapHostTargetsToGavModelEntries`; main still drives probe phase when known. */
export function deriveRawHostSelectorStateFromTarget(t: HostInferenceTargetRow): 'available' | 'checking' | 'unavailable' {
  const st =
    t.hostSelectorState ??
    t.host_selector_state ??
    (t.unavailable_reason === 'CHECKING_CAPABILITIES' || t.availability === 'checking_host'
      ? 'checking'
      : t.available
        ? 'available'
        : 'unavailable')
  return st
}

/** Host row for GAV / selector merge: menu enablement + coherent `hostSelectorState` for the renderer. */
export function computeHostInferenceGavRowPresentation(t: HostInferenceTargetRow): {
  hostTargetAvailable: boolean
  hostSelectorState: 'available' | 'checking' | 'unavailable'
} {
  const raw = deriveRawHostSelectorStateFromTarget(t)
  if (raw === 'checking') {
    return {
      hostTargetAvailable: false,
      hostSelectorState: 'checking',
    }
  }

  const menuOk = hostInferenceTargetMenuSelectable(t)
  return {
    hostTargetAvailable: menuOk,
    hostSelectorState: menuOk ? 'available' : 'unavailable',
  }
}
