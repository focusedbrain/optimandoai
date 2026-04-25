import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import type { FetchSelectorModelListResult } from './selectorModelListFromHostDiscovery'
import { isP2pTransportOrProbeFailure } from './hostModelSelectorRowUi'

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

const MSG_REFRESH_OFFLINE = 'Host AI offline · direct P2P failed'
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
  return dl || 'Host model'
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
    return { variant: 'warning', message: MSG_REFRESH_OFFLINE, display: 'compact' }
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
  if (isP2pTransportOrProbeFailure(t)) {
    return { variant: 'warning', message: MSG_REFRESH_OFFLINE, display: 'compact' }
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
  if (ur === 'SANDBOX_HOST_ROLE_METADATA') {
    return { variant: 'warning', message: COPY.roleMetadata, display: 'default' }
  }
  if (
    av === 'direct_unreachable' ||
    notConfiguredMissingEndpoint(ur, av) ||
    ur === 'HOST_DIRECT_P2P_UNAVAILABLE' ||
    ur === 'HOST_DIRECT_P2P_UNREACHABLE' ||
    ur === 'ENDPOINT_NOT_DIRECT' ||
    ur === 'MVP_P2P_ENDPOINT_INVALID' ||
    ur === 'MISSING_P2P_ENDPOINT'
  ) {
    return { variant: 'warning', message: MSG_REFRESH_OFFLINE, display: 'compact' }
  }
  return { variant: 'warning', message: 'Host AI unavailable.', display: 'default' }
}

function notConfiguredMissingEndpoint(ur: string, av: string): boolean {
  return (
    av === 'not_configured' &&
    (ur === 'HOST_DIRECT_P2P_UNAVAILABLE' ||
      ur === 'HOST_DIRECT_P2P_UNREACHABLE' ||
      ur === 'MISSING_P2P_ENDPOINT' ||
      ur.includes('DIRECT_P2P'))
  )
}
