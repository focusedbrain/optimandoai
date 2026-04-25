/** Tooltips and labels for Host AI in model selectors (orchestrator + WR Chat). */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

export const HOST_AI_OPTION_TOOLTIP =
  'Uses the model on your Host — the same idea as choosing a local model, but the model runs on the machine you paired with.'

export const HOST_AI_UNREACHABLE_TOOLTIP =
  'Host not directly reachable. Check that the Host is online, on a reachable network path, and that firewalls or VPN allow the connection.'

/**
 * Selector / native `title` (STEP 6–7) — not shown inline; use newlines for tooltip layout in Chromium.
 */
export const HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP = [
  'Host handshake detected',
  'direct P2P failed',
  'possible causes:',
  '• Host app not running',
  '• Host P2P server disabled',
  '• firewall blocks port',
  '• endpoint stale',
  '• not on same LAN',
].join('\n')

/** Active internal Host handshake, but `p2p_endpoint` is not a valid direct-LAN URL (STEP 2). */
export const HOST_AI_MVP_P2P_ENDPOINT_INVALID_TOOLTIP =
  'The Host handshake is active, but the stored direct P2P endpoint is not reachable.'

/** Placeholder while the internal Host handshake is recognized but capabilities are not ready yet. */
export const HOST_AI_CHECKING_TOOLTIP =
  'Resolving the Host’s model and network path. No action required — this updates automatically.'

export const HOST_AI_STALE_INLINE =
  'That Host model is no longer in the list. Choose another model to continue.'

/** Persisted Host selection can no longer be used (handshake missing, inactive, or after account change). */
export const HOST_INFERENCE_UNAVAILABLE =
  'Your saved Host model is no longer available. Pick another model from the menu.'

/** Visual for Host AI rows in merged selectors (not technical transport text). */
export const HOST_AI_SELECTOR_ICON_CLASS = 'host-ai-model-icon'

export const GROUP_LOCAL_MODELS = 'Local models'
export const GROUP_HOST_MODELS = 'Host models'
/** @deprecated Use GROUP_HOST_MODELS — kept for any stale imports. */
export const GROUP_INTERNAL_HOST = GROUP_HOST_MODELS
export const GROUP_CLOUD = 'Cloud'

const NL = '\n\n'

const ACT_SANDBOX_REFRESH =
  'Action: use Refresh (↻) next to the model menu to re-check the Host, or ensure the Host app is online on your network.'

const TOOLTIP_DISABLED = [
  'The Host has turned off Sandbox inference in policy.',
  'Action: on the Host machine, open settings for internal / Host AI inference and allow this Sandbox, or ask the person who manages the Host.',
].join(NL)

const TOOLTIP_NO_MODEL = [
  'The Host has no active local Ollama model selected.',
  'Action: on the Host, pick or pull a model in Ollama and set it as the active chat model.',
].join(NL)

const TOOLTIP_ROLE = [
  'Device roles in the handshake do not show Sandbox→Host the way the app expects.',
  'Action: open Settings, verify internal handshake device roles, or re-pair the devices.',
].join(NL)

const TOOLTIP_IDENTITY = [
  'Pairing metadata for this internal handshake is incomplete.',
  'Action: open the handshake in Settings, complete device identity, or re-pair.',
].join(NL)

/**
 * Phase 8: one tooltip string (reason + suggested action). No duplicate long text on the second row.
 */
export function hostAiRowUnavailableTooltip(
  t: HostInferenceTargetRow | null | undefined,
  opts: {
    hostTargetAvailable: boolean
    hostSelectorState?: 'available' | 'checking' | 'unavailable'
  },
): string {
  if (
    opts.hostSelectorState === 'checking' ||
    t?.host_selector_state === 'checking' ||
    t?.unavailable_reason === 'CHECKING_CAPABILITIES' ||
    t?.availability === 'checking_host'
  ) {
    return HOST_AI_CHECKING_TOOLTIP
  }
  if (opts.hostTargetAvailable && t?.available !== false) {
    return HOST_AI_OPTION_TOOLTIP
  }
  const ur = String(t?.unavailable_reason ?? '')
  const av = String(t?.availability ?? '')
  if (ur === 'SANDBOX_HOST_ROLE_METADATA') {
    return TOOLTIP_ROLE
  }
  if (t?.availability === 'identity_incomplete' || ur === 'IDENTITY_INCOMPLETE' || av === 'identity_incomplete') {
    return TOOLTIP_IDENTITY
  }
  if (t?.availability === 'policy_disabled' || ur === 'HOST_POLICY_DISABLED' || /disabled\s+by\s+host/i.test(String(t?.display_label ?? t?.label ?? ''))) {
    return TOOLTIP_DISABLED
  }
  if (t?.availability === 'model_unavailable' || ur === 'HOST_NO_ACTIVE_LOCAL_LLM') {
    return TOOLTIP_NO_MODEL
  }
  if (t?.inference_error_code === 'MVP_P2P_ENDPOINT_INVALID' || ur === 'MVP_P2P_ENDPOINT_INVALID') {
    return `${HOST_AI_MVP_P2P_ENDPOINT_INVALID_TOOLTIP}${NL}Action: update the direct LAN URL for the Host in the handshake, or re-pair.`
  }
  if (
    av === 'direct_unreachable' ||
    av === 'host_offline' ||
    ur === 'ENDPOINT_NOT_DIRECT' ||
    ur === 'HOST_DIRECT_P2P_UNREACHABLE' ||
    ur === 'HOST_DIRECT_P2P_UNAVAILABLE' ||
    ur === 'MISSING_P2P_ENDPOINT' ||
    ur === 'CAPABILITY_PROBE_FAILED' ||
    String(t?.inference_error_code ?? '').includes('DIRECT_P2P')
  ) {
    return `${HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP}${NL}${ACT_SANDBOX_REFRESH}`
  }
  const d = t?.secondary_label?.trim() || t?.host_computer_name?.trim()
  if (d) {
    return `${HOST_AI_UNREACHABLE_TOOLTIP}${NL}Details: ${d}${NL}Action: confirm the Host is reachable and the handshake is active.`
  }
  return `${HOST_AI_UNREACHABLE_TOOLTIP}${NL}${ACT_SANDBOX_REFRESH}`
}
