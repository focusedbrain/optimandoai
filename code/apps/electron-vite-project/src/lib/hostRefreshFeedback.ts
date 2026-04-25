import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import type { FetchSelectorModelListResult } from './selectorModelListFromHostDiscovery'

export type HostRefreshFeedback = {
  variant: 'success' | 'warning' | 'error'
  /** One line; no console-only phrasing. */
  message: string
  /** STEP 7: post-refresh toast weight (small inline badge, not a modal). */
  display?: 'default' | 'premium' | 'compact'
}

const COPY = {
  noModel: 'Host has no active local model.',
  policy: 'Host AI is disabled on the Host.',
  identity: 'Internal handshake is active but identity is incomplete.',
  roleMetadata: 'Check device roles in Settings or re-pair.',
  checking: 'Host AI still checking — try again shortly.',
  noPairing: 'No Host pairing — open the handshake ledger.',
} as const

const MSG_REFRESH_P2P_DOWN = 'Host AI · P2P unavailable'
const MSG_REFRESH_LEGACY = 'Host AI · legacy endpoint unavailable'
const CONNECTED_PREFIX = 'Host AI connected · '

function hostTargetDisplayModel(t: HostInferenceTargetRow): string {
  const raw = (t.model_id ?? t.model ?? '').toString().trim()
  if (raw) {
    return raw
      .replace(/host-internal:/gi, '')
      .replace(/^[^:]+:[^:]+:(.+)$/i, '$1')
      .trim() || raw
  }
  const dl = (t.display_label ?? t.label ?? '')
    .replace(/^\s*Host AI\s*·\s*/i, '')
    .replace(/^\s*Host AI\s*-\s*/i, '')
    .trim()
  return dl || 'Host AI'
}

/**
 * After a manual Host refresh, derive readable inline copy from merged `hostInferenceTargets` (same
 * rows as the selector), not from console codes alone.
 */
export function getHostRefreshFeedbackFromTargets(
  gav: HostInferenceTargetRow[],
  opts: {
    path: FetchSelectorModelListResult['path']
    error?: unknown
  },
): HostRefreshFeedback {
  if (opts.error != null) {
    return { variant: 'warning', message: MSG_REFRESH_P2P_DOWN, display: 'compact' }
  }
  if (!Array.isArray(gav) || gav.length === 0) {
    return { variant: 'warning', message: COPY.noPairing, display: 'default' }
  }
  const t = gav[0]!
  if (t.available === true) {
    return {
      variant: 'success',
      message: `${CONNECTED_PREFIX}${hostTargetDisplayModel(t)}`,
      display: 'premium',
    }
  }
  const st = t.host_selector_state
  if (st === 'checking' || t.availability === 'checking_host' || t.unavailable_reason === 'CHECKING_CAPABILITIES') {
    return { variant: 'warning', message: COPY.checking, display: 'default' }
  }
  if (t.p2pUiPhase === 'legacy_http_invalid') {
    return { variant: 'warning', message: MSG_REFRESH_LEGACY, display: 'compact' }
  }
  if (isHostPathOfflineByProjection(t)) {
    return { variant: 'warning', message: MSG_REFRESH_P2P_DOWN, display: 'compact' }
  }
  const ur = (t.unavailable_reason ?? '') as string
  const av = t.availability ?? ''

  if (ur === 'IDENTITY_INCOMPLETE' || ur === 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE' || av === 'identity_incomplete') {
    return { variant: 'warning', message: COPY.identity, display: 'default' }
  }
  if (ur === 'HOST_NO_ACTIVE_LOCAL_LLM' || av === 'model_unavailable') {
    return { variant: 'warning', message: COPY.noModel, display: 'default' }
  }
  if (ur === 'HOST_POLICY_DISABLED' || av === 'policy_disabled') {
    return { variant: 'warning', message: COPY.policy, display: 'default' }
  }
  if (/\bdisabled\s+by\s+host\b/i.test(String(t.display_label ?? t.label ?? ''))) {
    return { variant: 'warning', message: COPY.policy, display: 'default' }
  }
  if (ur === 'SANDBOX_HOST_ROLE_METADATA') {
    return { variant: 'warning', message: COPY.roleMetadata, display: 'default' }
  }
  return { variant: 'warning', message: 'Host AI is not available right now.', display: 'default' }
}

/** After refresh, use `p2pUiPhase` from main; no renderer inference from p2p_endpoint. */
function isHostPathOfflineByProjection(t: HostInferenceTargetRow): boolean {
  const p = t.p2pUiPhase
  if (p === 'legacy_http_invalid') {
    return false
  }
  if (p === 'p2p_unavailable') {
    return true
  }
  if (p) {
    return false
  }
  return t.availability === 'direct_unreachable' || t.availability === 'host_offline'
}
