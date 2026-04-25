import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import type { FetchSelectorModelListResult } from './selectorModelListFromHostDiscovery'

export type HostRefreshFeedback = {
  variant: 'success' | 'warning' | 'error'
  /** One line; no console-only phrasing. */
  message: string
}

const SUCCESS_OK = 'Host AI refreshed.'

const COPY = {
  p2p: 'Host AI is paired but direct P2P is not reachable.',
  noModel: 'Host has no active local model.',
  policy: 'Host AI is disabled on the Host.',
  identity: 'Internal handshake is active but identity is incomplete.',
  capabilities: 'Host capabilities could not be fetched. Check the Host and network, then try again.',
  roleMetadata: 'This pairing is not a valid Sandbox–Host row. Check device roles in Settings, or re-pair.',
  checking: 'Host AI is still checking. Keep the Host online, then try refresh again in a few seconds.',
  noPairing: 'No active Host–Sandbox pairing found. Open the handshake ledger to pair a Host.',
  errorGeneric: 'Could not refresh Host AI. Check the network and try again.',
} as const

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
    return { variant: 'error', message: COPY.errorGeneric }
  }
  if (!Array.isArray(gav) || gav.length === 0) {
    if (opts.path === 'empty') {
      return { variant: 'warning', message: COPY.noPairing }
    }
    return { variant: 'warning', message: COPY.noPairing }
  }
  const t = gav[0]!
  if (t.available === true) {
    return { variant: 'success', message: SUCCESS_OK }
  }
  const st = t.host_selector_state
  if (st === 'checking' || t.availability === 'checking_host' || t.unavailable_reason === 'CHECKING_CAPABILITIES') {
    return { variant: 'warning', message: COPY.checking }
  }
  const ur = (t.unavailable_reason ?? '') as string
  const av = t.availability ?? ''

  if (ur === 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE' || av === 'identity_incomplete') {
    return { variant: 'warning', message: COPY.identity }
  }
  if (ur === 'HOST_NO_ACTIVE_LOCAL_LLM' || av === 'model_unavailable') {
    return { variant: 'warning', message: COPY.noModel }
  }
  if (ur === 'HOST_POLICY_DISABLED' || av === 'policy_disabled') {
    return { variant: 'warning', message: COPY.policy }
  }
  if (ur === 'CAPABILITY_PROBE_FAILED' || t.inference_error_code === 'CAPABILITY_PROBE_FAILED') {
    return { variant: 'warning', message: COPY.capabilities }
  }
  if (ur === 'SANDBOX_HOST_ROLE_METADATA') {
    return { variant: 'warning', message: COPY.roleMetadata }
  }
  if (av === 'direct_unreachable' || notConfiguredMissingEndpoint(ur, av) || ur === 'HOST_DIRECT_P2P_UNAVAILABLE') {
    if (t.inference_error_code === 'ENDPOINT_NOT_DIRECT') {
      return {
        variant: 'warning',
        message:
          'A direct (non-relay) P2P endpoint to the Host is required. Set a local Host address in the ledger.',
      }
    }
    return { variant: 'warning', message: COPY.p2p }
  }
  const sub = (t.secondary_label || '').trim()
  if (sub.length > 0) {
    return { variant: 'warning', message: sub }
  }
  return { variant: 'warning', message: 'Host AI is not available. Check the model menu and Settings.' }
}

function notConfiguredMissingEndpoint(ur: string, av: string): boolean {
  return av === 'not_configured' && (ur === 'HOST_DIRECT_P2P_UNAVAILABLE' || ur.includes('DIRECT_P2P'))
}
