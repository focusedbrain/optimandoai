import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { composeHostAiConnectionSubtitle } from './hostAiTargetConnectionPresentation'
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
  | 'probe_invalid_response'
  | 'probe_host_ollama'
  | 'probe_local_ollama'
  | 'host_endpoint_not_advertised'
  | 'host_endpoint_rejected_self'
  | 'host_endpoint_mismatch'
  | 'host_auth_rejected'
  | 'host_transport_unavailable'
  | 'host_provider_unavailable'

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
  host_ai_target_status?: HostInferenceTargetRow['host_ai_target_status']
}

const ELL = '\u2026'

const TITLE_CONNECTING = 'Host AI · connecting…'
const TITLE_RELAY_RECONNECTING = 'Host AI · reconnecting to relay…'
const TITLE_NO_ACTIVE_MODEL = 'Host AI · no active model'
const TITLE_DISABLED_BY_HOST = 'Host AI · disabled by Host'
const TITLE_INCOMPLETE = 'Host AI · incomplete'
const TITLE_PAIRING = 'Host AI · pairing'
const TITLE_LEGACY_HTTP = 'Host AI · legacy endpoint unavailable'
const TITLE_UNAVAILABLE = 'Host AI · unavailable'
const TITLE_HIDDEN = 'Host AI unavailable'
const TITLE_PROBE_RL = 'Host is throttling requests. Try again in a moment.'
const TITLE_PROBE_GW = 'Host orchestrator returned an error.'
const TITLE_PROBE_NET = "Host machine isn't reachable on the network."
const TITLE_PROBE_JSON = "Host responded but the format wasn't recognized."
const TITLE_PROBE_OLLAMA = "The host's local model provider is not available."
const TITLE_HOST_ENDPOINT_NOT_AD = 'Host has not published a direct endpoint for this pairing.'
const TITLE_HOST_ENDPOINT_SELF = "Host endpoint points to this device; use the Host computer's advertised address."
const TITLE_HOST_ENDPOINT_MISMATCH = 'The stored host address does not match the paired host.'
const TITLE_HOST_AUTH = 'Host authentication was rejected. Re-pair to refresh access.'
const TITLE_HOST_TRANSPORT = 'Host transport is unavailable. Check network, relay, and P2P settings.'

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
 * True when the Host row would be shown as unavailable/disabled in the model menu — **not** during
 * `isChecking` (connecting / capability probe). Matches `hostModelSelectorRowUi` gating so the chat-level
 * connection strip does not contradict the selector when IPC `directReachability` lags or mis-fires.
 */
export function hostModelSelectorShowsDefinitiveHostFailure(
  m: HostModelSelectorRowUiIn,
  t: HostInferenceTargetRow | null | undefined,
): boolean {
  const phase = projectPhase(m, t)
  if (isChecking(m, t, phase)) {
    return false
  }
  const selUnavailable = (m.hostSelectorState ?? t?.hostSelectorState ?? t?.host_selector_state) === 'unavailable'
  return !m.hostTargetAvailable || selUnavailable
}

/**
 * Subtitle: prefer main `displaySubtitle` / `secondary_label`, else computed host · ID.
 */
function projectionSubtitle(
  m: HostModelSelectorRowUiIn,
  t: HostInferenceTargetRow | null | undefined,
): string {
  const fromRow = (t?.displaySubtitle ?? t?.secondary_label ?? m.displaySubtitle ?? '').trim()
  const base = fromRow ? fromRow : secondaryHostIdLine(t)
  const status = m.host_ai_target_status ?? t?.host_ai_target_status
  return composeHostAiConnectionSubtitle(status, base)
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
      return 'Host transport is unavailable'
    case 'host_transport_unavailable':
      return TITLE_HOST_TRANSPORT
    case 'legacy_http_invalid':
      return TITLE_LEGACY_HTTP
    case 'policy_disabled':
      return TITLE_DISABLED_BY_HOST
    case 'no_model':
      return TITLE_NO_ACTIVE_MODEL
    case 'hidden':
      return TITLE_HIDDEN
    case 'probe_access_denied':
    case 'host_auth_rejected':
      return TITLE_HOST_AUTH
    case 'probe_rate_limited':
      return TITLE_PROBE_RL
    case 'probe_gateway_error':
      return TITLE_PROBE_GW
    case 'probe_unreachable':
      return TITLE_PROBE_NET
    case 'probe_invalid_response':
      return TITLE_PROBE_JSON
    case 'probe_host_ollama':
    case 'probe_local_ollama':
    case 'host_provider_unavailable':
      return TITLE_PROBE_OLLAMA
    case 'host_endpoint_not_advertised':
      return TITLE_HOST_ENDPOINT_NOT_AD
    case 'host_endpoint_rejected_self':
      return TITLE_HOST_ENDPOINT_SELF
    case 'host_endpoint_mismatch':
      return TITLE_HOST_ENDPOINT_MISMATCH
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
  const selUnavailable = (m.hostSelectorState ?? t?.hostSelectorState ?? t?.host_selector_state) === 'unavailable'
  const treatAsUnavailable = !m.hostTargetAvailable || selUnavailable

  /** During capability probe WeRTC phase, skip connection-status ribbon (may still mismatch `host_ai_target_status`). */
  const sub =
    isChecking(m, t, phase) ?
      (() => {
        const fromRow = (t?.displaySubtitle ?? t?.secondary_label ?? m.displaySubtitle ?? '').trim()
        const base = fromRow ? fromRow : secondaryHostIdLine(t)
        return base
      })()
    : projectionSubtitle(m, t)

  if (isChecking(m, t, phase)) {
    return { titleLine: TITLE_CONNECTING, subtitleLine: sub }
  }

  const primaryFromMain = (t?.displayTitle?.trim() || m.displayTitle?.trim() || '').trim()

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
