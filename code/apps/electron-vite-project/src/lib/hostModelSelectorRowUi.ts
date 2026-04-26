import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { hostAiRowUnavailableTooltip } from './hostAiSelectorCopy'

/** Aligned with main `listInferenceTargets` / `HostP2pUiPhase` — renderer uses only for fallback when `displayTitle` is missing. */
type HostP2pUiPhase =
  | 'connecting'
  | 'relay_reconnecting'
  | 'ready'
  | 'p2p_unavailable'
  | 'legacy_http_invalid'
  | 'policy_disabled'
  | 'no_model'
  | 'hidden'
  | 'probe_access_denied'
  | 'probe_rate_limited'
  | 'probe_gateway_error'
  | 'probe_unreachable'

/** Top chat + WR Chat: one Host row in the model menu (or collapsed label). */
export type HostModelSelectorRowUiIn = {
  hostSelectorState?: 'available' | 'checking' | 'unavailable'
  hostTargetAvailable: boolean
  displayTitle: string
  displaySubtitle: string
  name?: string
  /** Ollama / local model name on the Host (when known). */
  hostLocalModelName?: string | null
  p2pUiPhase?: string
}

const ELL = '\u2026'

const TITLE_CONNECTING = 'Host AI · connecting…'
const TITLE_RELAY_RECONNECTING = 'Host AI · reconnecting to relay…'
const TITLE_P2P_UNAVAIL = 'Host AI · P2P unavailable'
const TITLE_NO_ACTIVE_MODEL = 'Host AI · no active model'
const TITLE_DISABLED_BY_HOST = 'Host AI · disabled by Host'
const TITLE_INCOMPLETE = 'Host AI · incomplete'
const TITLE_PAIRING = 'Host AI · pairing'
const TITLE_LEGACY_HTTP = 'Host AI · legacy endpoint unavailable'
const TITLE_UNAVAILABLE = 'Host AI · unavailable'
const TITLE_HIDDEN = 'Host AI unavailable'
const TITLE_PROBE_AUTH = 'Host AI · access denied (check pairing / token)'
const TITLE_PROBE_RL = 'Host AI · rate limited — retry shortly'
const TITLE_PROBE_GW = 'Host AI · gateway or Host server error'
const TITLE_PROBE_NET = 'Host AI · cannot reach Host (network or timeout)'

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

function projectPhase(
  m: HostModelSelectorRowUiIn,
  t: HostInferenceTargetRow | null | undefined,
): HostP2pUiPhase | undefined {
  const p = m.p2pUiPhase ?? t?.p2pUiPhase
  if (!p) return undefined
  return p as HostP2pUiPhase
}

function isChecking(
  m: HostModelSelectorRowUiIn,
  t: HostInferenceTargetRow | null | undefined,
  phase: HostP2pUiPhase | undefined,
): boolean {
  if (m.hostSelectorState === 'checking' || t?.hostSelectorState === 'checking' || t?.host_selector_state === 'checking') {
    return true
  }
  if (t?.unavailable_reason === 'CHECKING_CAPABILITIES' || t?.availability === 'checking_host') {
    return true
  }
  return phase === 'connecting' || phase === 'relay_reconnecting'
}

/**
 * Subtitle: prefer main `displaySubtitle` / `secondary_label`, else computed host · ID.
 */
function projectionSubtitle(
  m: HostModelSelectorRowUiIn,
  t: HostInferenceTargetRow | null | undefined,
): string {
  const fromRow = (t?.displaySubtitle ?? t?.secondary_label ?? m.displaySubtitle ?? '').trim()
  if (fromRow) return fromRow
  return secondaryHostIdLine(t)
}

/** When main did not set `displayTitle` (stale path), map phase only — do not walk availability / endpoint codes. */
function fallbackTitleForPhase(phase: HostP2pUiPhase | undefined, t: HostInferenceTargetRow | null | undefined): string | null {
  if (!phase) return null
  switch (phase) {
    case 'connecting':
      return TITLE_CONNECTING
    case 'relay_reconnecting':
      return TITLE_RELAY_RECONNECTING
    case 'ready': {
      const rawModel = (t?.model ?? t?.model_id ?? '').toString()
      const cleanModel = rawModel
        .replace(/host-internal:/gi, '')
        .replace(/^[^:]+:[^:]+:(.+)$/i, '$1')
        .trim()
      if (cleanModel) {
        return `Host AI · ${cleanModel}`
      }
      return 'Host AI · ready'
    }
    case 'p2p_unavailable':
      return TITLE_P2P_UNAVAIL
    case 'legacy_http_invalid':
      return TITLE_LEGACY_HTTP
    case 'policy_disabled':
      return TITLE_DISABLED_BY_HOST
    case 'no_model':
      return TITLE_NO_ACTIVE_MODEL
    case 'hidden':
      return TITLE_HIDDEN
    case 'probe_access_denied':
      return TITLE_PROBE_AUTH
    case 'probe_rate_limited':
      return TITLE_PROBE_RL
    case 'probe_gateway_error':
      return TITLE_PROBE_GW
    case 'probe_unreachable':
      return TITLE_PROBE_NET
    default:
      return null
  }
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
 * Compact primary + secondary (STEP 6–7). Copy comes from main (`displayTitle` / `p2pUiPhase` / `hostSelectorState`), not
 * from `p2p_endpoint_kind` or availability heuristics in the renderer.
 */
export function hostModelSelectorRowUi(
  m: HostModelSelectorRowUiIn,
  t?: HostInferenceTargetRow | null,
): { titleLine: string; subtitleLine: string } {
  const phase = projectPhase(m, t)
  const sub = projectionSubtitle(m, t)

  if (isChecking(m, t, phase)) {
    return { titleLine: TITLE_CONNECTING, subtitleLine: sub }
  }

  const primaryFromMain = (t?.displayTitle?.trim() || m.displayTitle?.trim() || '').trim()
  const treatAsUnavailable = !m.hostTargetAvailable || t?.available === false || m.hostSelectorState === 'unavailable'

  if (treatAsUnavailable) {
    if (primaryFromMain) {
      return { titleLine: primaryFromMain, subtitleLine: sub }
    }
    const fromPhase = fallbackTitleForPhase(phase, t)
    if (fromPhase) {
      return { titleLine: fromPhase, subtitleLine: sub }
    }
    if (isPolicyDisabled(t)) {
      return { titleLine: TITLE_DISABLED_BY_HOST, subtitleLine: sub }
    }
    if (isIdentityIncomplete(t)) {
      return { titleLine: TITLE_INCOMPLETE, subtitleLine: sub }
    }
    if (isRoleMetadata(t)) {
      return { titleLine: TITLE_PAIRING, subtitleLine: sub }
    }
    return { titleLine: TITLE_UNAVAILABLE, subtitleLine: sub }
  }

  if (primaryFromMain) {
    return { titleLine: primaryFromMain, subtitleLine: sub }
  }
  const fromPhaseWhenReady = fallbackTitleForPhase(phase ?? 'ready', t)
  if (fromPhaseWhenReady && (phase === 'ready' || phase == null)) {
    return { titleLine: fromPhaseWhenReady, subtitleLine: sub }
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
    subtitleLine: sub,
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
