import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { hostAiRowUnavailableTooltip } from './hostAiSelectorCopy'

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

const ELL = '\u2026'

const TITLE_CONNECTING = 'Host AI · connecting…'
const TITLE_P2P_UNAVAIL = 'Host AI · P2P unavailable'
const TITLE_NO_ACTIVE_MODEL = 'Host AI · no active model'
const TITLE_DISABLED_BY_HOST = 'Host AI · disabled by Host'
const TITLE_INCOMPLETE = 'Host AI · incomplete'
const TITLE_PAIRING = 'Host AI · pairing'
const TITLE_UNAVAILABLE = 'Host AI · unavailable'

function hostDisplayName(t: HostInferenceTargetRow | null | undefined): string {
  return (t?.host_computer_name?.trim() || 'Host').trim() || 'Host'
}

export function formatHostPairingIdDigits(t: HostInferenceTargetRow | null | undefined): string {
  if (!t) return '—'
  const raw = (t.internal_identifier_6 ?? t.host_pairing_code ?? '').toString().replace(/\D/g, '')
  if (raw.length === 6) {
    return `${raw.slice(0, 3)}-${raw.slice(3)}`
  }
  return raw || '—'
}

/** Secondary: `<computer> · ID 000-000` */
function secondaryHostIdLine(t: HostInferenceTargetRow | null | undefined): string {
  return `${hostDisplayName(t)} · ID ${formatHostPairingIdDigits(t)}`
}

/** Direct P2P / capability probe path failed — not model-list discovery. */
export function isP2pTransportOrProbeFailure(t: HostInferenceTargetRow | null | undefined): boolean {
  if (!t) return false
  const av = String(t.availability ?? '')
  if (av === 'direct_unreachable' || av === 'host_offline') return true
  const ur = String(t.unavailable_reason ?? '')
  if (
    [
      'ENDPOINT_NOT_DIRECT',
      'MVP_P2P_ENDPOINT_INVALID',
      'HOST_DIRECT_P2P_UNREACHABLE',
      'HOST_DIRECT_P2P_UNAVAILABLE',
      'MISSING_P2P_ENDPOINT',
      'CAPABILITY_PROBE_FAILED',
    ].includes(ur)
  ) {
    return true
  }
  const iec = String(t.inference_error_code ?? '')
  if (iec.includes('DIRECT_P2P') || iec === 'CAPABILITY_PROBE_FAILED') return true
  return false
}

function isNoModelOnHost(t: HostInferenceTargetRow | null | undefined): boolean {
  if (!t) return false
  return (
    t.availability === 'model_unavailable' ||
    String(t.unavailable_reason ?? '') === 'HOST_NO_ACTIVE_LOCAL_LLM' ||
    String(t.inference_error_code ?? '') === 'MODEL_UNAVAILABLE'
  )
}

function isPolicyDisabled(t: HostInferenceTargetRow | null | undefined): boolean {
  if (!t) return false
  if (t.availability === 'policy_disabled' || String(t.unavailable_reason ?? '') === 'HOST_POLICY_DISABLED') {
    return true
  }
  return /disabled\s+by\s+host/i.test(String(t.display_label ?? t.label ?? ''))
}

function isIdentityIncomplete(t: HostInferenceTargetRow | null | undefined): boolean {
  if (!t) return false
  return t.availability === 'identity_incomplete' || String(t.unavailable_reason ?? '') === 'IDENTITY_INCOMPLETE'
}

function isRoleMetadata(t: HostInferenceTargetRow | null | undefined): boolean {
  if (!t) return false
  return String(t.unavailable_reason ?? '') === 'SANDBOX_HOST_ROLE_METADATA'
}

/**
 * Compact primary + secondary (STEP 6). Details belong in {@link buildHostAiSelectorTooltip}.
 */
export function hostModelSelectorRowUi(
  m: HostModelSelectorRowUiIn,
  t?: HostInferenceTargetRow | null,
): { titleLine: string; subtitleLine: string } {
  if (
    m.hostSelectorState === 'checking' ||
    t?.host_selector_state === 'checking' ||
    t?.unavailable_reason === 'CHECKING_CAPABILITIES' ||
    t?.availability === 'checking_host'
  ) {
    return { titleLine: TITLE_CONNECTING, subtitleLine: secondaryHostIdLine(t) }
  }

  const treatAsUnavailable = !m.hostTargetAvailable || t?.available === false

  if (treatAsUnavailable) {
    if (isP2pTransportOrProbeFailure(t)) {
      return { titleLine: TITLE_P2P_UNAVAIL, subtitleLine: secondaryHostIdLine(t) }
    }
    if (isNoModelOnHost(t)) {
      return { titleLine: TITLE_NO_ACTIVE_MODEL, subtitleLine: secondaryHostIdLine(t) }
    }
    if (isPolicyDisabled(t)) {
      return { titleLine: TITLE_DISABLED_BY_HOST, subtitleLine: secondaryHostIdLine(t) }
    }
    if (isIdentityIncomplete(t)) {
      return { titleLine: TITLE_INCOMPLETE, subtitleLine: secondaryHostIdLine(t) }
    }
    if (isRoleMetadata(t)) {
      return { titleLine: TITLE_PAIRING, subtitleLine: secondaryHostIdLine(t) }
    }
    return { titleLine: TITLE_UNAVAILABLE, subtitleLine: secondaryHostIdLine(t) }
  }

  const rawModel = (m.hostLocalModelName ?? t?.model ?? t?.model_id ?? '').toString()
  const cleanModel = rawModel
    .replace(/host-internal:/gi, '')
    .replace(/^[^:]+:[^:]+:(.+)$/i, '$1')
    .trim()
  const fromTitle = m.displayTitle.replace(/^\s*Host AI\s*·\s*/i, '').replace(/^\s*Host AI\s*-\s*/i, '').trim()
  const modelPart = (cleanModel && cleanModel.length > 0 ? cleanModel : fromTitle) || m.name || ELL
  return {
    titleLine: `Host AI · ${modelPart}`,
    subtitleLine: secondaryHostIdLine(t),
  }
}

/**
 * Long-form text for `title` / info — not duplicated in the row (STEP 6).
 */
export function buildHostAiSelectorTooltip(
  t: HostInferenceTargetRow | null | undefined,
  opts: {
    hostTargetAvailable: boolean
    hostSelectorState?: 'available' | 'checking' | 'unavailable'
  },
): string {
  return hostAiRowUnavailableTooltip(t, opts)
}
